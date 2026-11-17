# OneWeb experimental GitHub publication

Date: 2026-11-17. The user explicitly authorized marking README as experimental, committing/pushing
related source and workflows, publishing artifacts and verifying that the public flow works.

The complete integration snapshot from the accepted smart-apps/RepoLens, real-model test and
userscript/release tasks is committed coherently before the experimental/public-install documentation.
The source ownership audit covers106 explicit paths. Two synthetic fixtures use shared constants to
avoid false generic-credential findings while preserving the active pre-commit secret check.
No real credential, generated build output or user browser profile is included in the commits.

README prominently identifies an experimental project. User and release documentation share that
status. The canonical vX.Y.Z channel supports manager updates and GitHub Latest; it does not promise
production maturity. This publication targets GitHub Releases and Actions artifacts. Store uploads
remain on the separate deploy branch flow.

Publication acceptance requires exact-source hosted CI and Deploy builds, a version tag resolving to
the tested commit, the Release workflow's complete draft roundtrip verification, unauthenticated public
asset hashes/metadata and an actual Tampermonkey install/update check from the official public URL.
The earlier local synthetic-version manager upgrade is separate evidence, not a public smoke test.

Actual source SHAs, workflow runs, downloaded asset checks, independent review, public-manager
results and remaining limits are recorded in Git common-dir agent-factory/tasks/github-release-20261117\*.
Remote evidence is available through this repository's Actions and Releases pages. Historical local
counts do not establish hosted or public-download success.

The first hosted CI at910aaad exposed a browser-install mismatch: Actions installs full Chromium
with --no-shell, but the userscript configuration defaulted to the absent headless-shell executable.
The userscript suite now explicitly selects channel chromium. A local cache containing only the full
Chromium binary reproduced the old failure and verifies the unchanged six-case suite after the fix.
No browser/test gate or retries setting is removed. Exact failing and repaired hosted run IDs belong
to the task record; Deploy's successful artifact build does not replace CI acceptance.
