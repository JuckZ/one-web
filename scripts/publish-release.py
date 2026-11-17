#!/usr/bin/env python3
"""Publish only a complete, verified stable release. No overwrite/recovery shortcuts."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
REPO = 'JuckZ/one-web'
ASSETS = sorted(['LICENSE', 'one-web-chromium.zip', 'one-web-firefox-unsigned.xpi',
                 'one-web.user.js', 'one-web.meta.js', 'release-manifest.json', 'SHA256SUMS'])


def run(*args, **kwargs):
    return subprocess.check_output(args, cwd=ROOT, text=True, **kwargs).strip()


def api(endpoint, payload=None):
    args = ['gh', 'api', endpoint]
    if payload is not None:
        args += ['--method', 'POST', '--input', '-']
    return json.loads(run(*args, **({'input': json.dumps(payload)} if payload is not None else {})))


def version(tag):
    if not isinstance(tag, str) or not re.fullmatch(r'v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', tag):
        raise ValueError('Expected stable tag vX.Y.Z')
    parts = tuple(map(int, tag[1:].split('.')))
    if max(parts) > 65535 or parts == (0, 0, 0):
        raise ValueError('Version components must be 0..65535 and nonzero')
    return parts


def guard_releases(tag, releases, own_draft=None):
    candidate = version(tag)
    for release in releases:
        if release['tag_name'] == tag:
            if not (own_draft and release['id'] == own_draft and release['draft']):
                raise ValueError('Release already exists for this tag; never overwrite assets')
        if not release['draft'] and not release['prerelease']:
            if candidate <= version(release['tag_name']):
                raise ValueError('Stable versions must increase beyond every published stable release')


def remote_guard(tag, sha, own_draft=None):
    # Failure/auth/rate-limit responses propagate, never masquerade as an empty first release.
    pages = json.loads(run('gh', 'api', f'repos/{REPO}/releases?per_page=100', '--paginate', '--slurp'))
    guard_releases(tag, [item for page in pages for item in page], own_draft)
    obj = api(f'repos/{REPO}/git/ref/tags/{tag}')['object']
    for _ in range(8):
        if obj['type'] == 'commit':
            break
        if obj['type'] != 'tag':
            raise ValueError('Release tag does not point to a commit')
        obj = api(f'repos/{REPO}/git/tags/{obj["sha"]}')['object']
    if obj['type'] != 'commit' or obj['sha'] != sha:
        raise ValueError('Remote tag must still resolve to the tested source SHA')


def local_guard(tag, sha, directory):
    version(tag)
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Expected full source SHA')
    if run('git', 'rev-parse', 'HEAD') != sha or run('git', 'rev-parse', f'{tag}^{{commit}}') != sha:
        raise ValueError('Tag/checkout/source SHA mismatch')
    if run('git', 'status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Publishing requires a clean checkout')
    if f'v{json.loads((ROOT / "package.json").read_text())["version"]}' != tag:
        raise ValueError('Package/tag mismatch')
    run('pnpm', 'release:verify', str(directory), '--published')
    manifest = json.loads((directory / 'release-manifest.json').read_text())
    if manifest['tag'] != tag or manifest['source']['commit'] != sha or manifest['source']['dirty']:
        raise ValueError('Release source manifest mismatch')


def require_ci(sha):
    subprocess.run(['python3', 'scripts/agent-factory/require_ci.py', '--repo', REPO,
                    '--sha', sha, '--wait-seconds', '900'], cwd=ROOT, check=True)


def publish(tag, sha, directory):
    local_guard(tag, sha, directory)
    remote_guard(tag, sha)
    require_ci(sha)
    # Token is carried by gh's environment, never passed as an argument or logged.
    release = api(f'repos/{REPO}/releases', {
        'tag_name': tag, 'target_commitish': sha, 'name': f'OneWeb {tag}',
        'draft': True, 'prerelease': False, 'body': (ROOT / 'docs/releases/template.md').read_text(),
    })
    release_id = release['id']
    print(f'Created draft release {release_id}; a failed run leaves it for inspection.', flush=True)
    subprocess.run(['gh', 'release', 'upload', tag, '--repo', REPO,
                    *[str(directory / name) for name in ASSETS]], cwd=ROOT, check=True)
    # Verify server-side bytes and exact inventory before making anything Latest.
    uploaded = api(f'repos/{REPO}/releases/{release_id}')
    if sorted(asset['name'] for asset in uploaded['assets']) != ASSETS:
        raise ValueError('Uploaded release inventory mismatch')
    with tempfile.TemporaryDirectory(prefix='oneweb-release-verify-') as temp:
        subprocess.run(['gh', 'release', 'download', tag, '--repo', REPO, '--dir', temp], cwd=ROOT, check=True)
        run('pnpm', 'release:verify', temp, '--published')
        if (Path(temp) / 'SHA256SUMS').read_bytes() != (directory / 'SHA256SUMS').read_bytes():
            raise ValueError('Uploaded bytes differ from the verified local candidate')
    local_guard(tag, sha, directory)
    require_ci(sha)
    remote_guard(tag, sha, own_draft=release_id)
    # Workflow has one global stable-publishing concurrency lock across all tags.
    subprocess.run(['gh', 'release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest'], cwd=ROOT, check=True)
    print(f'Published https://github.com/{REPO}/releases/tag/{tag}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['check', 'publish'])
    parser.add_argument('--tag', required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    if os.environ.get('GITHUB_REPOSITORY', REPO) != REPO:
        raise ValueError('This publisher is bound to the canonical OneWeb repository')
    directory = args.directory.resolve()
    if args.command == 'check':
        local_guard(args.tag, args.sha, directory)
        remote_guard(args.tag, args.sha)
        require_ci(args.sha)
        print('Release preflight passed; nothing published.')
    else:
        if os.environ.get('GITHUB_ACTIONS') != 'true':
            raise ValueError('Use the serialized GitHub release workflow to publish')
        publish(args.tag, args.sha, directory)


if __name__ == '__main__':
    main()
