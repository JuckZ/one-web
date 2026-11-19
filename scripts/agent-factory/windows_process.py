"""Start a Windows check in a job that owns its whole process tree."""

import contextlib
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import re
import subprocess
import sys


class BasicLimits(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_longlong),
        ("PerJobUserTimeLimit", ctypes.c_longlong),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", BasicLimits),
        ("IoInfo", ctypes.c_ulonglong * 6),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


def find_executable(root, command):
    path = Path(command)
    if path.parent != Path(".") or command.startswith(("./", ".\\")):
        candidates = [root / path]
    else:
        # Resolve the same way from any subdirectory of the worktree.
        directories = [] if "NoDefaultCurrentDirectoryInExePath" in os.environ else [root]
        directories.extend(root / entry.strip('"') for entry in os.get_exec_path())
        candidates = [directory / path for directory in directories]
    extensions = os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").lower().split(os.pathsep)
    for candidate in candidates:
        if candidate.suffix and candidate.is_file():
            return candidate.resolve()
        for extension in extensions:
            executable = Path(str(candidate) + extension)
            if extension and executable.is_file():
                return executable.resolve()
    raise FileNotFoundError("executable not found: " + command)


def resolve_command(root, argv):
    command, *args = argv
    # The repository uses python3 on POSIX; the Windows alias can open the Store.
    if command == "python3":
        return [sys.executable, *args]
    executable = find_executable(root, command)
    suffix = executable.suffix.lower()
    if suffix in {".exe", ".com"}:
        return [str(executable), *args]
    if suffix not in {".cmd", ".bat"}:
        raise OSError("unsupported Windows executable: " + str(executable))
    # Batch shims use cmd.exe. Accept only arguments the shell cannot interpret.
    if any(c in str(executable) for c in '%!^&|<>"\r\n') or any(
        not re.fullmatch(r"[a-zA-Z0-9_./:@=+~-]+", arg) for arg in args
    ):
        raise OSError("unsafe Windows batch path or argument; use a native executable instead")
    return [str(executable), *args]


def job_api():
    library = ctypes.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateJobObjectW": (wintypes.HANDLE, [ctypes.c_void_p, wintypes.LPCWSTR]),
        "SetInformationJobObject": (wintypes.BOOL, [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]),
        "OpenProcess": (wintypes.HANDLE, [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]),
        "AssignProcessToJobObject": (wintypes.BOOL, [wintypes.HANDLE, wintypes.HANDLE]),
        "CloseHandle": (wintypes.BOOL, [wintypes.HANDLE]),
    }
    for name, (result, args) in signatures.items():
        function = getattr(library, name)
        function.restype = result
        function.argtypes = args
    return library


@contextlib.contextmanager
def start(root, argv, output):
    command = resolve_command(root, argv)
    api = job_api()
    job = api.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    worker = None
    try:
        limits = ExtendedLimits()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not api.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        # The pipe keeps the worker from spawning a check before job membership.
        worker = subprocess.Popen(
            [sys.executable, "-I", "-S", "-B", str(Path(__file__).resolve()), *command],
            cwd=root, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        process = api.OpenProcess(0x0101, False, worker.pid)  # PROCESS_SET_QUOTA | PROCESS_TERMINATE
        if not process:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            if not api.AssignProcessToJobObject(job, process):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            api.CloseHandle(process)
        with worker.stdin as gate:
            gate.write(b"1")
        yield worker
    finally:
        # EOF stops a worker that was never admitted. Closing the job reaps admitted children.
        try:
            if worker is not None:
                worker.stdin.close()
        finally:
            api.CloseHandle(job)
            if worker is not None:
                worker.wait()


def run_worker(argv):
    if sys.stdin.buffer.read(1) != b"1":
        return 2
    executable, *args = argv
    if Path(executable).suffix.lower() in {".cmd", ".bat"}:
        shell = Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe"
        # cmd treats unquoted equals signs as batch argument separators.
        arguments = " ".join(f'"{arg}"' if "=" in arg else arg for arg in args)
        invocation = f'"{shell}" /d /v:off /s /c ""{executable}" {arguments}"'
        return subprocess.call(invocation, executable=shell, stdin=subprocess.DEVNULL)
    return subprocess.call(argv, stdin=subprocess.DEVNULL)


if __name__ == "__main__":
    sys.exit(run_worker(sys.argv[1:]))
