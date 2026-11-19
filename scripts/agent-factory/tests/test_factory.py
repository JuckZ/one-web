import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'factory.py'


class FactoryIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name)
        self.repo = self.parent / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Factory Test')
        self.git('config', 'user.email', 'factory@example.invalid')
        (self.repo / '.gitignore').write_text('ignored/\n')
        (self.repo / 'source.txt').write_text('original\n')
        self.config([self.entry('ok', 'pass')])
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout

    def entry(self, name, code, timeout=5):
        return {'name': name, 'argv': [sys.executable, '-c', code], 'timeout_seconds': timeout}

    def config(self, checks, lock=5):
        (self.repo / '.agent-factory.json').write_text(json.dumps(
            {'version': 1, 'checks': checks, 'lock_timeout_seconds': lock}))

    def run_factory(self, *args, cwd=None, env=None):
        return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=cwd or self.repo, env=env,
                              encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)

    def check(self):
        result = self.run_factory('check', '--config', '.agent-factory.json')
        candidates = list((self.repo / '.git' / 'agent-factory' / 'runs').glob('*/evidence.json'))
        evidence = max(candidates, key=lambda p: p.stat().st_mtime_ns) if candidates else None
        return result, evidence

    def attest(self, path):
        return self.run_factory('attest', '--evidence', str(path))

    def test_pass_attest_dirty_and_untracked_inputs(self):
        (self.repo / 'source.txt').write_text('dirty\n')
        (self.repo / 'new.txt').write_text('untracked\n')
        result, path = self.check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.attest(path).returncode, 0)
        evidence = json.loads(path.read_text())
        self.assertEqual(evidence['status'], 'passed')
        self.assertEqual(evidence['checks'][0]['exit_code'], 0)
        self.assertEqual(self.git('status', '--porcelain').decode().count('agent-factory/runs'), 0)
        self.assertEqual(evidence['snapshot_before'], evidence['snapshot_after'])

    def test_config_is_relative_to_root_even_from_subdirectory(self):
        nested = self.repo / 'ignored'
        nested.mkdir()
        result = self.run_factory('check', '--config', '.agent-factory.json', cwd=nested)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_argv_preserves_literal_shell_characters_and_empty_arguments(self):
        entry = {'name': 'literal', 'argv': [sys.executable, '-c',
                 'import sys; assert sys.argv[1:] == ["", "$(touch escaped)", "a b"]',
                 '', '$(touch escaped)', 'a b'], 'timeout_seconds': 5}
        self.config([entry])
        result, _ = self.check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.repo / 'escaped').exists())

    def test_failed_check_does_not_skip_later_check(self):
        marker = self.parent / 'last-ran'
        self.config([self.entry('bad', 'raise SystemExit(7)'),
                     self.entry('later', 'from pathlib import Path; Path(%r).write_text("yes")' % str(marker))])
        result, path = self.check()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertTrue(marker.exists())
        evidence = json.loads(path.read_text())
        self.assertEqual([c['exit_code'] for c in evidence['checks']], [7, 0])
        self.assertNotEqual(self.attest(path).returncode, 0)

    def test_missing_executable_does_not_skip_later_check(self):
        self.config([{'name': 'missing', 'argv': ['/not/a/factory-command'], 'timeout_seconds': 1},
                     self.entry('later', 'print("later")')])
        result, path = self.check()
        self.assertEqual(result.returncode, 1)
        checks = json.loads(path.read_text())['checks']
        self.assertIsNone(checks[0]['exit_code'])
        self.assertEqual(checks[1]['status'], 'passed')

    def test_timeout_fails_and_later_check_runs(self):
        self.config([self.entry('timeout', 'import time; time.sleep(10)', .1),
                     self.entry('later', 'print("later")')])
        result, path = self.check()
        self.assertEqual(result.returncode, 1)
        checks = json.loads(path.read_text())['checks']
        self.assertTrue(checks[0]['timed_out'])
        self.assertEqual(checks[1]['status'], 'passed')

    def test_changes_during_checks_invalidate_successful_commands(self):
        self.config([self.entry('mutates', 'from pathlib import Path; Path("source.txt").write_text("changed")')])
        result, path = self.check()
        self.assertEqual(result.returncode, 1)
        evidence = json.loads(path.read_text())
        self.assertEqual(evidence['checks'][0]['status'], 'passed')
        self.assertIn('inputs changed', evidence['errors'][0])

    def test_same_dirty_status_different_bytes_rejected(self):
        (self.repo / 'source.txt').write_text('one')
        result, path = self.check()
        self.assertEqual(result.returncode, 0)
        before = self.git('status', '--porcelain')
        (self.repo / 'source.txt').write_text('two')
        self.assertEqual(self.git('status', '--porcelain'), before)
        self.assertNotEqual(self.attest(path).returncode, 0)

    def test_untracked_addition_rejected(self):
        result, path = self.check()
        self.assertEqual(result.returncode, 0)
        (self.repo / 'new.txt').write_text('new')
        self.assertNotEqual(self.attest(path).returncode, 0)

    def test_head_change_rejected(self):
        result, path = self.check()
        self.assertEqual(result.returncode, 0)
        self.git('commit', '--allow-empty', '-qm', 'new head')
        self.assertNotEqual(self.attest(path).returncode, 0)

    def test_ignored_files_excluded_but_ignored_config_checked(self):
        self.git('rm', '--cached', '.agent-factory.json')
        with (self.repo / '.gitignore').open('a') as stream:
            stream.write('.agent-factory.json\n')
        self.git('add', '.gitignore')
        self.git('commit', '-qm', 'ignore config')
        result, path = self.check()
        self.assertEqual(result.returncode, 0)
        ignored = self.repo / 'ignored'
        ignored.mkdir()
        (ignored / 'cache').write_text('not an input')
        self.assertEqual(self.attest(path).returncode, 0)
        self.config([self.entry('different', 'pass')])
        result = self.attest(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('configuration hash', result.stderr)

    def test_symlink_target_change_rejected(self):
        try:
            (self.repo / 'link').symlink_to('source.txt')
        except OSError as exc:
            if os.name == 'nt' and exc.winerror == 1314:
                self.skipTest('symlink creation requires Windows Developer Mode or permission')
            raise
        result, path = self.check()
        self.assertEqual(result.returncode, 0)
        (self.repo / 'link').unlink()
        (self.repo / 'link').symlink_to('other')
        self.assertNotEqual(self.attest(path).returncode, 0)

    def test_empty_or_malformed_checks_rejected_before_running(self):
        for checks in ([], [self.entry('x', 'pass'), {'name': 'broken', 'argv': 'echo no', 'timeout_seconds': 2}],
                       [self.entry('x', 'pass', True)], [self.entry('x', 'pass', 0)],
                       [self.entry('same', 'pass'), self.entry('same', 'pass')]):
            with self.subTest(checks=checks):
                self.config(checks)
                result = self.run_factory('check', '--config', '.agent-factory.json')
                self.assertEqual(result.returncode, 2)
                self.assertFalse((self.repo / '.git/agent-factory/runs').exists())

    def test_existing_destination_and_invalid_task_leave_files_untouched(self):
        destination = self.parent / 'existing'
        destination.mkdir()
        (destination / 'keep').write_text('keep')
        result = self.run_factory('worktree', 'task', '--base', 'HEAD', '--directory', str(destination))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((destination / 'keep').read_text(), 'keep')
        for task in ('../evil', '-bad', 'with space', 'a..b', 'end.lock'):
            result = self.run_factory('worktree', task, '--base', 'HEAD', '--directory', str(self.parent / 'new'))
            self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.parent / 'new').exists())

    def test_new_worktree_has_requested_branch_and_shared_common_directory(self):
        destination = self.parent / 'new'
        result = self.run_factory('worktree', 'safe-task', '--base', 'HEAD', '--directory', str(destination))
        self.assertEqual(result.returncode, 0, result.stderr)
        branch = subprocess.check_output(['git', '-C', str(destination), 'branch', '--show-current'], text=True).strip()
        self.assertEqual(branch, 'agent/safe-task')
        result = self.run_factory('doctor', '--config', '.agent-factory.json', cwd=destination)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(str(self.repo / '.git'), result.stdout)

    def wait_for_path(self, path, process):
        deadline = time.monotonic() + 10
        while not path.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(path.exists(), f"missing process marker: {path}")

    def test_shared_lock_timeout(self):
        destination = self.parent / 'linked'
        self.git('worktree', 'add', '--detach', str(destination))
        ready = self.parent / 'ready'
        release = self.parent / 'release'
        hold_lock = chr(10).join([
            'import time',
            'from pathlib import Path',
            f'Path({str(ready)!r}).touch()',
            f'while not Path({str(release)!r}).exists():',
            '    time.sleep(.02)',
        ])
        self.config([self.entry('holder', hold_lock, 15)])
        (destination / '.agent-factory.json').write_text(json.dumps({
            'version': 1, 'checks': [self.entry('ok', 'pass')], 'lock_timeout_seconds': .2,
        }))
        with subprocess.Popen([sys.executable, str(SCRIPT), 'check', '--config', '.agent-factory.json'],
                              cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8") as holder:
            try:
                self.wait_for_path(ready, holder)
                result = self.run_factory('check', '--config', '.agent-factory.json', cwd=destination)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn('suite.lock', result.stderr)
            finally:
                release.touch()
                out, err = holder.communicate(timeout=20)
            self.assertEqual(holder.returncode, 0, out + err)
        result = self.run_factory('check', '--config', '.agent-factory.json', cwd=destination)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_timeout_stops_a_child_and_allows_next_check(self):
        ready = self.parent / 'grandchild-started'
        late = self.parent / 'grandchild-survived'
        child = ('import time; from pathlib import Path; '
                 f'Path({str(ready)!r}).touch(); time.sleep(4); Path({str(late)!r}).touch()')
        parent = f'import subprocess, sys, time; subprocess.Popen([sys.executable, "-c", {child!r}]); time.sleep(20)'
        self.config([self.entry('watchdog', parent, 2), self.entry('following', 'print("still runs")')])
        result, evidence = self.check()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertTrue(ready.exists(), 'child did not start before the timeout')
        results = json.loads(evidence.read_text())['checks']
        self.assertTrue(results[0]['timed_out'])
        self.assertEqual(results[1]['status'], 'passed')
        time.sleep(4)
        self.assertFalse(late.exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows executable lookup')
    def test_windows_relative_path_entries_use_worktree_root(self):
        nested = self.repo / 'ignored'
        for base, code in ((self.repo, 0), (nested, 22)):
            tools = base / 'tools'
            tools.mkdir(parents=True)
            (tools / 'factory-fixture.cmd').write_text(f'@exit /b {code}' + chr(10))
        self.config([{'name': 'relative-path', 'argv': ['factory-fixture'], 'timeout_seconds': 5}])
        env = {**os.environ, 'PATH': 'tools' + os.pathsep + os.environ['PATH']}
        result = self.run_factory('check', '--config', '.agent-factory.json', cwd=nested, env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    @unittest.skipUnless(os.name == 'nt', 'Windows redirected stream encoding')
    def test_windows_redirected_unicode_check_name_and_evidence_path(self):
        localized = self.repo.with_name('OneWeb 测试')
        self.repo.rename(localized)
        self.repo = localized
        self.config([self.entry('验证', 'pass')])
        env = {**os.environ, 'PYTHONIOENCODING': 'cp1252'}
        result = self.run_factory('check', '--config', '.agent-factory.json', env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PASSED 验证', result.stdout)
        evidence_path = next(line.removeprefix('Evidence: ') for line in result.stdout.splitlines() if line.startswith('Evidence: '))
        self.assertIn('OneWeb 测试', evidence_path)
        self.assertEqual(self.attest(evidence_path).returncode, 0)

    @unittest.skipUnless(os.name == 'nt', 'Windows batch shims')
    def test_windows_batch_shim_and_python_alias(self):
        batch = self.repo / 'test shim.cmd'
        batch.write_text(chr(10).join([
            '@echo off',
            'if not "%~1"=="verify:chromium" exit /b 21',
            'if not "%~2"=="key=value" exit /b 22',
            'if not "%~3"=="" exit /b 23',
            'exit /b 0',
            '',
        ]))
        native = self.entry('python-alias', 'import sys; assert sys.platform == "win32"')
        native['argv'][0] = 'python3'
        shim = {'name': 'batch', 'argv': ['./test shim.cmd', 'verify:chromium', 'key=value'], 'timeout_seconds': 5}
        self.config([shim, native])
        doctor = self.run_factory('doctor', '--config', '.agent-factory.json')
        self.assertEqual(doctor.returncode, 0, doctor.stderr)
        result, evidence = self.check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.attest(evidence).returncode, 0)
        shim['argv'][1] = 'verify:chromium & exit 0'
        self.config([shim, native])
        result, evidence = self.check()
        self.assertEqual(result.returncode, 1, result.stdout)
        checks = json.loads(evidence.read_text())['checks']
        self.assertIn('unsafe Windows batch path or argument', checks[0]['error'])
        self.assertEqual(checks[1]['status'], 'passed')


if __name__ == '__main__':
    unittest.main()
