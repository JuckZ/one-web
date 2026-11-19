#!/usr/bin/env python3
"""Run serialized repository checks and verify local evidence. Python 3.9+.

Commands run with the caller's environment, from the Git worktree root. This is
ordinary command execution, not an OS sandbox. Evidence is local and unsigned;
it cannot defend against somebody who can alter the evidence or this program.
"""

import argparse
import contextlib
import datetime
import errno
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid


SCHEMA_VERSION = 1
SNAPSHOT_VERSION = 1
SCOPE = {
    "execution": "ordinary commands in the worktree root with inherited environment; no OS sandbox or HOME rewriting",
    "inputs": "HEAD, porcelain status, index entries, tracked and nonignored untracked file bytes, symlink targets and permission bits",
    "excluded": "ignored files, external files, environment values, toolchain contents and remote services; config is hashed separately",
    "change_detection": "before/after snapshots; changes reverted between snapshots may escape detection",
    "assurance": "local unsigned evidence; not proof against evidence tampering or malicious checks",
    "submodules": "unsupported; a populated tracked directory causes a closed failure",
}


BINARY = getattr(os, "O_BINARY", 0)


class FactoryError(Exception):
    pass


def git(root, *args):
    result = subprocess.run(
        ["git", "-C", str(root), *args], stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=False,
    )
    if result.returncode:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise FactoryError("git {} failed: {}".format(" ".join(args), message))
    return result.stdout


def repository():
    root = Path(os.fsdecode(git(Path.cwd(), "rev-parse", "--show-toplevel")).strip()).resolve()
    common = Path(os.fsdecode(git(root, "rev-parse", "--git-common-dir")).strip())
    if not common.is_absolute():
        common = root / common
    return root, common.resolve()


def positive_number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FactoryError(name + " must be a positive finite number")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite or value <= 0:
        raise FactoryError(name + " must be a positive finite number")
    return value


def config_file(root, name):
    path = Path(name)
    if not path.is_absolute():
        path = root / path
    path = path.resolve()
    try:
        relative = path.relative_to(root)
    except ValueError:
        raise FactoryError("configuration must resolve inside the worktree")
    return path, relative.as_posix()


def read_config(root, name):
    path, relative = config_file(root, name)
    try:
        raw = path.read_bytes()
        config = json.loads(raw)
    except (OSError, ValueError) as exc:
        raise FactoryError("cannot read configuration: " + str(exc))
    if not isinstance(config, dict) or type(config.get("version")) is not int or config["version"] != 1:
        raise FactoryError("configuration must be an object with version: 1")
    if set(config) - {"version", "checks", "lock_timeout_seconds"}:
        raise FactoryError("unknown top-level configuration field")
    checks = config.get("checks")
    if not isinstance(checks, list) or not checks:
        raise FactoryError("checks must be a nonempty array")
    names = set()
    for entry in checks:
        if not isinstance(entry, dict) or set(entry) != {"name", "argv", "timeout_seconds"}:
            raise FactoryError("each check needs exactly name, argv and timeout_seconds")
        name = entry["name"]
        if not isinstance(name, str) or not name.strip() or any(ord(c) < 32 for c in name):
            raise FactoryError("check name must be a nonempty string without control characters")
        if name in names:
            raise FactoryError("check names must be unique: " + name)
        names.add(name)
        argv = entry["argv"]
        if (not isinstance(argv, list) or not argv or any(
                not isinstance(arg, str) or "\0" in arg for arg in argv)
                or not argv[0]):
            raise FactoryError("argv must be a nonempty string array without NUL and with a nonempty executable")
        positive_number(entry["timeout_seconds"], "timeout_seconds")
    config["lock_timeout_seconds"] = positive_number(
        config.get("lock_timeout_seconds", 600), "lock_timeout_seconds"
    )
    return config, hashlib.sha256(raw).hexdigest(), relative


def try_suite_lock(fd):
    if os.name == "nt":
        import msvcrt
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            return True
        except OSError as exc:
            if exc.errno != errno.EACCES:
                raise
            return False
    if os.name != "posix":
        raise FactoryError("suite locking requires Windows or POSIX")
    import fcntl
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        return False


@contextlib.contextmanager
def suite_lock(common, timeout):
    state = common / "agent-factory"
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(str(state / "suite.lock"), os.O_RDWR | os.O_CREAT | BINARY, 0o600)
    try:
        deadline = time.monotonic() + timeout
        while not try_suite_lock(fd):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise FactoryError("timed out waiting for common-directory suite.lock")
            time.sleep(min(0.1, remaining))
        yield state
    finally:
        os.close(fd)


def framed(digest, value):
    digest.update(len(value).to_bytes(8, "big"))
    digest.update(value)


def file_digest(path):
    """Do not follow symlinks or open special files, including during races."""
    try:
        before = path.lstat()
    except FileNotFoundError:
        return b"missing"
    mode = stat.S_IMODE(before.st_mode)
    if stat.S_ISLNK(before.st_mode):
        target = os.fsencode(os.readlink(path))
        after = path.lstat()
        if (before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_ino, after.st_mtime_ns, after.st_ctime_ns
        ):
            raise FactoryError("input changed while reading a symlink: " + str(path))
        return b"symlink:" + str(mode).encode() + b":" + target
    if stat.S_ISDIR(before.st_mode):
        raise FactoryError("tracked directories/submodules are unsupported: " + str(path))
    if not stat.S_ISREG(before.st_mode):
        raise FactoryError("special input files are unsupported: " + str(path))
    flags = os.O_RDONLY | BINARY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(str(path), flags)
    with os.fdopen(fd, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if not stat.S_ISREG(opened.st_mode) or (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise FactoryError("input changed while opening: " + str(path))
        digest = hashlib.sha256()
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
        after = os.fstat(stream.fileno())
    current = path.lstat()
    # Windows supplies different ctime and mode fields for handles and paths.
    # Compare those fields within each API and file identity across both APIs.
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, stat.S_IFMT(s.st_mode))
    metadata = lambda s: (s.st_ctime_ns, s.st_mode)
    if (identity(before) != identity(opened) or identity(opened) != identity(after)
            or identity(after) != identity(current) or metadata(opened) != metadata(after)
            or metadata(before) != metadata(current)):
        raise FactoryError("input changed while hashing: " + str(path))
    return b"file:" + str(mode).encode() + b":" + digest.hexdigest().encode()


def snapshot(root):
    head = git(root, "rev-parse", "--verify", "HEAD").strip().decode("ascii")
    status = git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none")
    index = git(root, "ls-files", "--stage", "-z")
    tracked = git(root, "ls-files", "-z")
    untracked = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    paths = sorted(set(tracked.split(b"\0") + untracked.split(b"\0")) - {b""})
    digest = hashlib.sha256()
    for value in (b"agent-factory-snapshot-v1", head.encode(), status, index):
        framed(digest, value)
    for name in paths:
        framed(digest, name)
        framed(digest, file_digest(root / os.fsdecode(name)))
    # Detect metadata/enumeration changes during a snapshot rather than accepting
    # a mixture of two repository states as a stable input.
    if (git(root, "rev-parse", "--verify", "HEAD").strip().decode("ascii") != head
            or git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none") != status
            or git(root, "ls-files", "--stage", "-z") != index
            or git(root, "ls-files", "-z") != tracked
            or git(root, "ls-files", "--others", "--exclude-standard", "-z") != untracked):
        raise FactoryError("repository inputs changed during snapshot")
    return {
        "snapshot_version": SNAPSHOT_VERSION, "head": head,
        "tree_digest": digest.hexdigest(), "status_sha256": hashlib.sha256(status).hexdigest(),
        "index_sha256": hashlib.sha256(index).hexdigest(), "input_path_count": len(paths),
    }


def end_process_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    # The parent may have exited while a descendant ignored SIGTERM.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


@contextlib.contextmanager
def start_check(root, argv, output):
    if os.name == "nt":
        from windows_process import start
        with start(root, argv, output) as process:
            yield process
        return
    process = subprocess.Popen(
        argv, cwd=root, stdin=subprocess.DEVNULL,
        stdout=output, stderr=subprocess.STDOUT, start_new_session=True,
    )
    try:
        yield process
    except BaseException:
        end_process_group(process)
        raise


def run_check(root, entry, log):
    start = time.monotonic()
    record = {
        "name": entry["name"], "argv": entry["argv"],
        "timeout_seconds": entry["timeout_seconds"], "exit_code": None,
        "timed_out": False, "status": "failed", "log_path": str(log),
    }
    fd = os.open(str(log), os.O_WRONLY | os.O_CREAT | os.O_EXCL | BINARY, 0o600)
    with os.fdopen(fd, "wb") as output:
        try:
            with start_check(root, entry["argv"], output) as process:
                record["exit_code"] = process.wait(timeout=entry["timeout_seconds"])
        except subprocess.TimeoutExpired:
            record["timed_out"] = True
            record["exit_code"] = process.returncode
            output.write(b"\n[agent-factory] check timed out; check process tree terminated\n")
        except OSError as exc:
            record["error"] = str(exc)
            output.write((str(exc) + "\n").encode("utf-8", "replace"))
    record["duration_seconds"] = round(time.monotonic() - start, 6)
    if record["exit_code"] == 0 and not record["timed_out"]:
        record["status"] = "passed"
    return record


def write_evidence(path, evidence):
    temporary = path.with_suffix(".tmp")
    fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL | BINARY, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(evidence, stream, indent=2, sort_keys=True, ensure_ascii=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def check(args):
    root, common = repository()
    config, _, _ = read_config(root, args.config)
    with suite_lock(common, config["lock_timeout_seconds"]) as state:
        config, config_hash, relative = read_config(root, args.config)
        initial = snapshot(root)
        timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        run = state / "runs" / (timestamp + "-" + uuid.uuid4().hex[:12])
        run.mkdir(mode=0o700, parents=True)
        results = []
        for number, entry in enumerate(config["checks"], 1):
            result = run_check(root, entry, run / ("{:03d}.log".format(number)))
            results.append(result)
            print("{} {}".format(result["status"].upper(), entry["name"]), flush=True)
        errors = []
        final = None
        try:
            final = snapshot(root)
            if final != initial:
                errors.append("repository inputs changed during checks")
            _, final_hash, _ = read_config(root, relative)
            if final_hash != config_hash:
                errors.append("configuration changed during checks")
        except (FactoryError, OSError) as exc:
            errors.append("final snapshot/configuration failed: " + str(exc))
        passed = not errors and all(result["status"] == "passed" for result in results)
        evidence = {
            "schema_version": SCHEMA_VERSION, "status": "passed" if passed else "failed",
            "head": initial["head"], "tree_digest": initial["tree_digest"],
            "repository_root": str(root), "git_common_dir": str(common),
            "config_path": relative, "config_sha256": config_hash,
            "snapshot_before": initial, "snapshot_after": final,
            "checks": results, "errors": errors,
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "runtime": {"python": sys.version.split()[0], "platform": sys.platform, "scope": SCOPE},
        }
        path = run / "evidence.json"
        write_evidence(path, evidence)
        print("Evidence: " + str(path))
        for error in errors:
            print("FAILED: " + error, file=sys.stderr)
        return 0 if passed else 1


def attest(args):
    root, common = repository()
    try:
        evidence = json.loads(Path(args.evidence).read_bytes())
    except (OSError, ValueError) as exc:
        raise FactoryError("cannot read evidence: " + str(exc))
    if (not isinstance(evidence, dict) or type(evidence.get("schema_version")) is not int
            or evidence["schema_version"] != SCHEMA_VERSION):
        raise FactoryError("unsupported evidence schema")
    if evidence.get("status") != "passed":
        raise FactoryError("evidence did not pass")
    if evidence.get("repository_root") != str(root) or evidence.get("git_common_dir") != str(common):
        raise FactoryError("evidence belongs to a different worktree or repository")
    config_path = evidence.get("config_path")
    if not isinstance(config_path, str) or not config_path:
        raise FactoryError("evidence has no configuration path")
    config, config_hash, _ = read_config(root, config_path)
    with suite_lock(common, config["lock_timeout_seconds"]):
        config, config_hash, _ = read_config(root, config_path)
        if config_hash != evidence.get("config_sha256"):
            raise FactoryError("configuration hash differs from evidence")
        results = evidence.get("checks")
        if not isinstance(results, list) or len(results) != len(config["checks"]):
            raise FactoryError("evidence does not contain every configured check")
        for entry, result in zip(config["checks"], results):
            if (not isinstance(result, dict) or result.get("name") != entry["name"]
                    or result.get("argv") != entry["argv"]
                    or result.get("timeout_seconds") != entry["timeout_seconds"]
                    or result.get("status") != "passed" or type(result.get("exit_code")) is not int
                    or result["exit_code"] != 0 or result.get("timed_out") is not False):
                raise FactoryError("evidence check is incomplete, failed or differs from configuration")
        current = snapshot(root)
        if (current != evidence.get("snapshot_before") or current != evidence.get("snapshot_after")
                or current["head"] != evidence.get("head")
                or current["tree_digest"] != evidence.get("tree_digest")):
            raise FactoryError("current HEAD or input snapshot differs from evidence")
        # Configuration may be ignored by Git, so recheck it separately too.
        if read_config(root, config_path)[1] != config_hash:
            raise FactoryError("configuration changed during attestation")
    print("PASSED: evidence matches this worktree's current HEAD, inputs and configuration")
    return 0


def worktree(args):
    root, common = repository()
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,63}", args.task):
        raise FactoryError("TASK must be a 1-64 character lowercase slug: a-z, 0-9, dot, underscore or hyphen")
    branch = "agent/" + args.task
    git(root, "check-ref-format", "--branch", branch)
    destination = Path(args.directory).expanduser().absolute()
    if os.path.lexists(destination):
        raise FactoryError("destination already exists; nothing was overwritten")
    commit = git(root, "rev-parse", "--verify", "--end-of-options", args.base + "^{commit}").strip().decode("ascii")
    with suite_lock(common, 600):
        if os.path.lexists(destination):
            raise FactoryError("destination already exists; nothing was overwritten")
        output = git(root, "worktree", "add", "-b", branch, str(destination), commit)
    print(output.decode("utf-8", "replace").strip())
    print("Worktree: " + str(destination))
    print("Branch: " + branch)
    return 0


def doctor(args):
    root, common = repository()
    config, _, relative = read_config(root, args.config)
    missing = []
    for entry in config["checks"]:
        command = entry["argv"][0]
        if os.name == "nt":
            from windows_process import resolve_command
            try:
                resolve_command(root, entry["argv"])
            except OSError as exc:
                missing.append(str(exc))
        else:
            executable = (root / command).resolve() if "/" in command else shutil.which(command)
            if not executable or not os.path.isfile(executable) or not os.access(executable, os.X_OK):
                missing.append(command)
    snapshot(root)
    print("Repository: " + str(root))
    print("Common directory: " + str(common))
    print("Configuration: {} ({} checks)".format(relative, len(config["checks"])))
    print("Scope: " + SCOPE["execution"])
    if missing:
        raise FactoryError("missing executables: " + ", ".join(missing))
    print("PASSED: prerequisites found; checks were not executed")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("check", help="run every configured check under the shared suite lock")
    p.add_argument("--config", required=True, help="configuration path relative to the Git worktree root")
    p.set_defaults(handler=check)
    p = commands.add_parser("attest", help="verify passed local evidence against the current checkout")
    p.add_argument("--evidence", required=True, help="evidence JSON path, relative to cwd or absolute")
    p.set_defaults(handler=attest)
    p = commands.add_parser("worktree", help="create a new agent/TASK branch and worktree without overwriting")
    p.add_argument("task", metavar="TASK")
    p.add_argument("--base", required=True, metavar="BASE")
    p.add_argument("--directory", required=True, metavar="DIR")
    p.set_defaults(handler=worktree)
    p = commands.add_parser("doctor", help="validate configuration, snapshot support and executable availability")
    p.add_argument("--config", required=True)
    p.set_defaults(handler=doctor)
    args = parser.parse_args(argv)
    try:
        return args.handler(args)
    except (FactoryError, OSError) as exc:
        print("FAILED: " + str(exc), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("FAILED: interrupted; no passed evidence was issued", file=sys.stderr)
        return 130


if __name__ == "__main__":
    if os.name == "nt":
        # Redirected output includes paths that may exceed the active code page.
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
