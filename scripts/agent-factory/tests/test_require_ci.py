import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('require_ci', Path(__file__).resolve().parents[1] / 'require_ci.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = 'a' * 40
REPO = 'JuckZ/one-web'


def run(id=10, status='completed', conclusion='success', sha=SHA):
    return {'id': id, 'run_attempt': 1, 'head_sha': sha, 'status': status,
            'conclusion': conclusion, 'event': 'push', 'repository': {'full_name': REPO},
            'head_repository': {'full_name': REPO}, 'path': '.github/workflows/ci.yml'}


class RequireCITests(unittest.TestCase):
    def require(self, runs, **kwargs):
        return gate.require(REPO, SHA, 'ci.yml', kwargs.pop('wait', 0), 1,
                            fetcher=lambda *_: {'workflow_runs': runs}, **kwargs)

    def test_green_exact_sha(self):
        self.assertEqual(self.require([run()])['id'], 10)

    def test_other_sha_is_not_green(self):
        with self.assertRaisesRegex(gate.GateError, 'no same-repository'):
            self.require([run(sha='b' * 40)])

    def test_fork_does_not_authorize_publication(self):
        r = run()
        r['head_repository']['full_name'] = 'someone/one-web'
        with self.assertRaises(gate.GateError):
            self.require([r])

    def test_new_failure_overrules_older_green(self):
        with self.assertRaisesRegex(gate.GateError, 'failure'):
            self.require([run(10), run(11, conclusion='failure')])

    def test_cancelled_and_skipped_are_not_green(self):
        for conclusion in ('cancelled', 'skipped', 'neutral', 'timed_out', None):
            with self.subTest(conclusion=conclusion), self.assertRaises(gate.GateError):
                self.require([run(conclusion=conclusion)])

    def test_pending_is_not_green(self):
        with self.assertRaisesRegex(gate.GateError, 'no green'):
            self.require([run(status='in_progress', conclusion=None)])

    def test_latest_attempt_is_checked(self):
        old = run()
        newer = copy.deepcopy(old)
        newer.update(run_attempt=2, status='in_progress', conclusion=None)
        with self.assertRaisesRegex(gate.GateError, 'no green'):
            self.require([old, newer])

    def test_pr_merge_tree_green_cannot_override_source_failure(self):
        source_failure = run(10, conclusion='failure')
        merge_success = run(11)
        merge_success['event'] = 'pull_request'
        with self.assertRaisesRegex(gate.GateError, 'failure'):
            self.require([merge_success, source_failure])

    def test_only_push_or_manual_runs_authorize_publication(self):
        for event in ('pull_request', 'pull_request_target', 'workflow_run', 'schedule', None):
            with self.subTest(event=event):
                r = run()
                r['event'] = event
                with self.assertRaises(gate.GateError):
                    self.require([r])
        manual = run()
        manual['event'] = 'workflow_dispatch'
        self.assertEqual(self.require([manual])['id'], 10)

    def test_wrong_workflow_is_rejected(self):
        r = run()
        r['path'] = '.github/workflows/other.yml'
        with self.assertRaises(gate.GateError):
            self.require([r])

    def test_malformed_response_fails_closed(self):
        for response in (None, {}, {'workflow_runs': None}, {'workflow_runs': [None]}):
            with self.subTest(response=response), self.assertRaises(gate.GateError):
                gate.latest_run(response, REPO, SHA, 'ci.yml')

    def test_poll_can_observe_completion(self):
        responses = iter([{'workflow_runs': [run(status='queued', conclusion=None)]},
                          {'workflow_runs': [run()]}])
        pauses = []
        result = gate.require(REPO, SHA, 'ci.yml', 2, 1,
                              fetcher=lambda *_: next(responses), clock=lambda: 0,
                              pause=pauses.append)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(pauses, [1])

    def test_unknown_status_fails_closed(self):
        with self.assertRaises(gate.GateError):
            self.require([run(status='mystery')])

    def test_poll_can_wait_for_run_creation(self):
        responses = iter([{'workflow_runs': []}, {'workflow_runs': [run()]}])
        result = gate.require(REPO, SHA, 'ci.yml', 2, 1,
                              fetcher=lambda *_: next(responses), clock=lambda: 0,
                              pause=lambda _: None)
        self.assertEqual(result['status'], 'completed')

    def test_null_head_repository_is_not_authorized(self):
        r = run()
        r['head_repository'] = None
        with self.assertRaises(gate.GateError):
            self.require([r])

    def test_missing_identity_fails_closed(self):
        r = run()
        del r['run_attempt']
        with self.assertRaises(gate.GateError):
            self.require([r])


if __name__ == '__main__':
    unittest.main()
