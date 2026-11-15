#!/usr/bin/env python3
"""Require the latest same-repository CI run at exactly SHA to finish green.

Uses the installed authenticated gh CLI. Performs read-only API requests.
A successful result is a point-in-time observation, not branch protection or a
signed artifact attestation. Python 3.9+, no third-party dependencies.
"""
import argparse
import json
import re
import subprocess
import sys
import time


class GateError(Exception):
    pass


class NoRun(GateError):
    pass


def latest_run(payload, repo, sha, workflow):
    if not isinstance(payload, dict) or not isinstance(payload.get('workflow_runs'), list):
        raise GateError('GitHub response has no workflow_runs array')
    candidates = []
    for run in payload['workflow_runs']:
        if not isinstance(run, dict):
            raise GateError('invalid workflow run')
        if run.get('head_sha') != sha:
            continue
        # PR metadata names its head SHA while checkout may test a merge tree.
        # Only direct-source push/manual runs authorize this source artifact.
        if run.get('event') not in ('push', 'workflow_dispatch'):
            continue
        if str((run.get('repository') or {}).get('full_name', '')).lower() != repo.lower():
            continue
        if str((run.get('head_repository') or {}).get('full_name', '')).lower() != repo.lower():
            continue
        if str(run.get('path', '')).split('@', 1)[0] != '.github/workflows/' + workflow:
            continue
        if type(run.get('id')) is not int or type(run.get('run_attempt')) is not int:
            raise GateError('workflow run identity is incomplete')
        candidates.append(run)
    if not candidates:
        raise NoRun('no same-repository {} run for exact SHA {}; trigger CI on this commit first'.format(workflow, sha))
    return max(candidates, key=lambda run: (run['id'], run['run_attempt']))


def fetch(repo, sha, workflow):
    endpoint = 'repos/{}/actions/workflows/{}/runs?head_sha={}&per_page=100'.format(repo, workflow, sha)
    try:
        result = subprocess.run(['gh', 'api', endpoint], text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GateError('cannot query GitHub Actions: ' + str(exc))
    if result.returncode:
        # gh's stderr can include request details; report the exit without copying
        # potentially private environment or credential-bearing diagnostics.
        raise GateError('gh api failed (exit {}); verify repository access and actions:read'.format(result.returncode))
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise GateError('GitHub returned invalid JSON')


def require(repo, sha, workflow, wait_seconds, poll_seconds, fetcher=fetch, clock=time.monotonic, pause=time.sleep):
    deadline = clock() + wait_seconds
    while True:
        try:
            run = latest_run(fetcher(repo, sha, workflow), repo, sha, workflow)
        except NoRun:
            remaining = deadline - clock()
            if remaining <= 0:
                raise
            print('Waiting for an exact-SHA CI run to appear', flush=True)
            pause(min(poll_seconds, remaining))
            continue
        status, conclusion = run.get('status'), run.get('conclusion')
        if status == 'completed':
            if conclusion != 'success':
                raise GateError('latest exact-SHA CI run {} concluded {}; release stopped'.format(run['id'], conclusion))
            return run
        if status not in ('queued', 'in_progress', 'waiting', 'pending', 'requested'):
            raise GateError('unrecognized CI status {}; release stopped'.format(status))
        remaining = deadline - clock()
        if remaining <= 0:
            raise GateError('latest exact-SHA CI run {} is {}; no green result'.format(run['id'], status))
        print('Waiting for CI {} ({})'.format(run['id'], status), flush=True)
        pause(min(poll_seconds, remaining))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, help='OWNER/REPO, explicit to avoid accidental repository selection')
    parser.add_argument('--sha', required=True, help='full 40-character commit SHA')
    parser.add_argument('--workflow', default='ci.yml', help='workflow filename, default ci.yml')
    parser.add_argument('--wait-seconds', type=int, default=0)
    parser.add_argument('--poll-seconds', type=int, default=15)
    args = parser.parse_args(argv)
    try:
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repo):
            raise GateError('repo must be OWNER/REPO')
        if not re.fullmatch(r'[0-9a-fA-F]{40}', args.sha):
            raise GateError('sha must be a full 40-character hexadecimal commit')
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.ya?ml', args.workflow):
            raise GateError('workflow must be a YAML filename')
        if args.wait_seconds < 0 or not 1 <= args.poll_seconds <= 30:
            raise GateError('wait must be nonnegative and poll must be between 1 and 30 seconds')
        run = require(args.repo, args.sha.lower(), args.workflow, args.wait_seconds, args.poll_seconds)
        print('PASSED: {} succeeded for {} (run {}, attempt {})'.format(
            args.workflow, args.sha.lower(), run['id'], run['run_attempt']))
        print('Run: ' + str(run.get('html_url', '')))
        return 0
    except GateError as exc:
        print('FAILED: ' + str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
