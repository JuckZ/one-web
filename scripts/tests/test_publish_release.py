import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).parents[1] / 'publish-release.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def release(tag='v0.1.0', **kwargs):
    return dict(id=1, tag_name=tag, draft=False, prerelease=False, **kwargs)


class PublisherTests(unittest.TestCase):
    def test_first_release_and_numeric_increase(self):
        publisher.guard_releases('v0.1.0', [])
        publisher.guard_releases('v0.1.10', [release('v0.1.9')])

    def test_rejects_all_noncanonical_versions(self):
        for tag in ['v0.0.0', 'v01.1.0', 'v1.2', 'v1.2.3.4', 'v65536.0.1', 'v1.0.0-rc.1', 'v1.0.0+dev', '1.0.0', 'v1.0.0\n']:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                publisher.version(tag)

    def test_never_overwrites_published_or_draft(self):
        for draft in [False, True]:
            item = release()
            item['draft'] = draft
            with self.assertRaisesRegex(ValueError, 'already exists'):
                publisher.guard_releases('v0.1.0', [item])
        publisher.guard_releases('v0.1.0', [dict(release(), draft=True)], own_draft=1)
        with self.assertRaises(ValueError):
            publisher.guard_releases('v0.1.0', [dict(release(), draft=True)], own_draft=2)

    def test_compares_all_stable_releases_and_rejects_unknown_stable_scheme(self):
        with self.assertRaisesRegex(ValueError, 'increase'):
            publisher.guard_releases('v1.0.0', [release('v0.1.0'), release('v2.0.0')])
        with self.assertRaises(ValueError):
            publisher.guard_releases('v1.0.0', [release('userscript-0.1.0')])
        publisher.guard_releases('v1.0.0', [dict(release('v2.0.0-rc.1'), prerelease=True)])

    def test_network_auth_or_rate_limit_failure_is_not_first_release(self):
        with patch.object(publisher, 'run', side_effect=RuntimeError('403')):
            with self.assertRaises(RuntimeError):
                publisher.remote_guard('v1.0.0', 'a' * 40)

    def test_remote_annotated_tag_peels_to_tested_commit(self):
        with patch.object(publisher, 'run', return_value='[[]]'), patch.object(publisher, 'api', side_effect=[
            {'object': {'type': 'tag', 'sha': 'b' * 40}},
            {'object': {'type': 'commit', 'sha': 'a' * 40}},
        ]):
            publisher.remote_guard('v1.0.0', 'a' * 40)

    def test_moved_remote_tag_rejected(self):
        with patch.object(publisher, 'run', return_value='[[]]'), patch.object(publisher, 'api', return_value={
            'object': {'type': 'commit', 'sha': 'b' * 40},
        }):
            with self.assertRaisesRegex(ValueError, 'tested source SHA'):
                publisher.remote_guard('v1.0.0', 'a' * 40)

    def test_dirty_or_mismatched_local_source_stops_before_verification(self):
        for outputs in [ ['a' * 40, 'b' * 40], ['a' * 40, 'a' * 40, ' M runtime.ts'] ]:
            with self.subTest(outputs=outputs), patch.object(publisher, 'run', side_effect=outputs):
                with self.assertRaises(ValueError):
                    publisher.local_guard('v1.0.0', 'a' * 40, Path('/unused'))

    def test_package_and_candidate_provenance_must_match_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'package.json').write_text(json.dumps({'version': '1.0.0'}))
            for manifest in [
                {'tag': 'v1.0.1', 'source': {'commit': 'a' * 40, 'dirty': False}},
                {'tag': 'v1.0.0', 'source': {'commit': 'b' * 40, 'dirty': False}},
                {'tag': 'v1.0.0', 'source': {'commit': 'a' * 40, 'dirty': True}},
            ]:
                (root / 'release-manifest.json').write_text(json.dumps(manifest))
                with self.subTest(manifest=manifest), patch.object(publisher, 'ROOT', root), patch.object(publisher, 'run', side_effect=['a' * 40, 'a' * 40, '', 'verified']):
                    with self.assertRaisesRegex(ValueError, 'source manifest mismatch'):
                        publisher.local_guard('v1.0.0', 'a' * 40, root)
            with patch.object(publisher, 'ROOT', root), patch.object(publisher, 'run', side_effect=['a' * 40, 'a' * 40, '']):
                with self.assertRaisesRegex(ValueError, 'Package/tag'):
                    publisher.local_guard('v1.0.1', 'a' * 40, root)

    def test_failed_ci_prevents_draft_creation(self):
        with patch.object(publisher, 'local_guard'), patch.object(publisher, 'remote_guard'), patch.object(publisher, 'require_ci', side_effect=RuntimeError('CI red')), patch.object(publisher, 'api') as api:
            with self.assertRaises(RuntimeError):
                publisher.publish('v1.0.0', 'a' * 40, Path('/unused'))
            api.assert_not_called()

    def test_missing_uploaded_asset_never_promotes(self):
        with patch.object(publisher, 'local_guard'), patch.object(publisher, 'remote_guard'), patch.object(publisher, 'require_ci'), patch.object(publisher.subprocess, 'run') as command, patch.object(publisher, 'api', side_effect=[{'id': 5}, {'assets': []}]):
            with self.assertRaisesRegex(ValueError, 'inventory'):
                publisher.publish('v1.0.0', 'a' * 40, Path('/unused'))
            self.assertTrue(all('edit' not in call.args[0] for call in command.call_args_list))

    def test_complete_roundtrip_rechecks_ci_and_remote_before_promotion(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / 'SHA256SUMS').write_text('test checksums')
            def command(args, **_kwargs):
                if 'download' in args:
                    (Path(args[args.index('--dir') + 1]) / 'SHA256SUMS').write_text('test checksums')
                events.append(args[2])
            with patch.object(publisher, 'local_guard', side_effect=lambda *_: events.append('local')), patch.object(publisher, 'remote_guard', side_effect=lambda *_, **_kw: events.append('remote')), patch.object(publisher, 'require_ci', side_effect=lambda *_: events.append('CI')), patch.object(publisher, 'run'), patch.object(publisher.subprocess, 'run', side_effect=command), patch.object(publisher, 'api', side_effect=[{'id': 5}, {'assets': [{'name': name} for name in publisher.ASSETS]}]):
                publisher.publish('v1.0.0', 'a' * 40, source)
            self.assertEqual(events, ['local', 'remote', 'CI', 'upload', 'download', 'local', 'CI', 'remote', 'edit'])


if __name__ == '__main__':
    unittest.main()
