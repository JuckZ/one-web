# ADR-0026: Unified stable GitHub Releases and manager-owned updates

- Status: Accepted for local implementation
- Date: 2026-11-17

The user requested a complete release/use flow and tests for the newly consolidated userscript.
OneWeb uses one stable `vX.Y.Z` GitHub release with a complete asset inventory, rather than moving
GitHub's repository-wide Latest pointer independently for extensions and the userscript. Root package
version drives all targets. This supersedes ADR-0021's phase-specific literal0.1.0 version freeze;
canonical product/package/Firefox identities and rejected-runtime guards remain unchanged.

A shared post-transform metadata generator emits byte-identical user/meta headers with fixed canonical
Latest download/update URLs. The script manager performs update checks/downloads, not OneWeb runtime.
Name/namespace and GM key format remain stable. MIT notices accompany standalone and archive outputs.

The release workflow rebuilds from an exact clean stable tag and requires current exact-source CI.
One global publish concurrency group, numeric comparison against all published stable releases,
rejection of existing releases including drafts, draft asset upload/download verification, and final
source/CI/remote-tag rechecks precede Latest promotion. Errors fail closed. Checksums cover primary
assets and the source manifest, excluding themselves. They establish integrity, not an independent
signature. Administrator/manual edits outside this workflow cannot be serialized by its lock.

Local rehearsal explicitly supports the existing uncommitted integration tree and records dirty
source. Published packages reject dirty provenance. Production CLI always rebuilds three targets;
the internal pack/verify helpers do not establish a build/source relationship on their own.

Users install the user.js, opt in per exact origin, and rely on manager update settings. Manual
rollback requires a backup and paused updates; schema downgrade compatibility is not assumed.
Unsigned Firefox XPI and unpacked Chromium ZIP are labelled development/testing artifacts. Store
publishing remains separate and has no new authorization. No release, push or user-browser install
is performed merely by implementing this workflow.

Tests cover artifact corruption/identity/version boundaries, publisher guards and ordering with
stubbed GitHub APIs, deterministic shipped-script lifecycle, and actual Tampermonkey install/update
with only fixture version/update URLs changed. Public GitHub reachability requires the first real
release and is recorded separately from local protocol evidence.
