import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
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

    def run_factory(self, *args, cwd=None):
        return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=cwd or self.repo,
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)

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
        (self.repo / 'link').symlink_to('source.txt')
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

    def test_shared_lock_timeout(self):
        import fcntl
        state = self.repo / '.git/agent-factory'
        state.mkdir()
        with (state / 'suite.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.config([self.entry('ok', 'pass')], lock=.1)
            result = self.run_factory('check', '--config', '.agent-factory.json')
            self.assertEqual(result.returncode, 2)
            self.assertIn('suite.lock', result.stderr)
        self.assertFalse((state / 'runs').exists())


if __name__ == '__main__':
    unittest.main()
