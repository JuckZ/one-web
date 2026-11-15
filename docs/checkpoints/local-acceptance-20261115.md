# Integrated local acceptance checkpoint

Date: 2026-11-15. Status: Local checkpoint; manual/environment acceptance remains open.

Scope and acceptance IDs: [local acceptance specification](../specs/local-acceptance-20261115.md).

## Protected starting state

- OneWeb: `codex/phase-9a-openlist-contract`, HEAD `7b5c9d9988c61ee012d85188770f93507b4f2b54`.
- Existing tree: 519 inputs, 38 tracked changes and 122 untracked files. They match the latest page-assistant-capabilities validation tree before this checkpoint is added.
- Latest evidence: 878 unit tests / 116 files, Chromium 76 tests with zero retries, and five existing Firefox builtin gates. These were re-attested before task entry.
- RepoLens: protected dirty main tree; 34 tests and offline 20-file vendor verified; the cross-repo SDK and locks are identical.
- RC1 and the archived userscript repository remain protected.

## Acceptance and evidence

Evidence root: `artifacts/local-acceptance/20261115/`. Final whole-tree check results, review,
source/artifact hashes and restoration validation are recorded in `final-validation.json` there.
The evidence is local and unsigned. An archive containing the dirty source tree is not a Git tag.

| Slice                        | Observed result                                                                                                                                                                                                                                              | Remaining boundary                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LA-01 Chrome installation    | Read-only registered extension metadata identifies the expected loading directory. All 17 installed files match the latest accepted candidate.                                                                                                               | Latest user-profile reload and business-page interaction remain unverified: Playwright extension exposes only its connection page and detaches on internal-page navigation; desktop accessibility does not expose Chrome. File hashes are not reload evidence. |
| LA-02 Firefox assistant      | Four added real-Firefox scenarios passed: streamed selection with safe text, editor preview then native-click writeback, page reading and bilingual restoration preserving website edits, revocation with HTTP abort and unrelated Registry/state unchanged. | The five existing builtin gates remain separate. A fixture does not prove every real website/editor or a paid model's quality.                                                                                                                                 |
| LA-03 Dubbing                | Added a natural full 20-second fixture video with six complete real WAV clips, no manual pause/seek/acceleration, one native video end, automatic cleanup, and actual request/media timing evidence.                                                         | Both previously used LAN health endpoints are currently unreachable. Real-provider startup/batch latency, human listening and extended uninterrupted real-video playback are not closed by generated audio.                                                    |
| LA-04 Real local services    | OpenList v4.2.6 / `2bdf16d` and AList v3.64.0 / `3e49fa4` passed the same fixed connector: limited user, dynamic tools, real 16 KiB download, unfinished/done lists, cancellation and invalid-token rejection.                                               | HTTP loopback fixtures with a local relay are not a deployment TLS/proxy or every-provider acceptance. Browser authority/lifecycle remains covered by the production extension E2E.                                                                            |
| LA-05 Recoverable checkpoint | Source capture and final verification use the current uncommitted tree, fixed browser outputs and SDK. Instructions below reproduce the tree without changing its original Git branch/index.                                                                 | Whole-integration independent review and its actual verdict are recorded in the final evidence, not inferred from earlier feature reviews.                                                                                                                     |

The actual service images are fixed by digest in `scripts/verify-openlist-services.ts`; both server
binaries reported the audited commits. Download servers run on an internal Docker network without
external egress. Two test-only loopback relays expose only the owned services to the harness.
Ordinary accounts are rooted at `/inbox`, with offline-download/upload permission bits `12`;
AList uses an explicit path-scoped role. Bootstrap admin authority is confined to fixture setup,
captured only in process memory and ephemeral server data. Output contains bounded shapes/counts,
not credentials or upstream task text. All owned containers, tmpfs data and the network were removed.

## Reproduced fixes

1. The real OpenList downloader returned a successful task with progress `100.51533742331289`.
   The former validator rejected the whole completed list. `18-openlist-progress-red.log`
   preserves the failing regression. Normalization now clamps finite nonnegative display progress
   to 100 while preserving state/identity and rejecting negative/NaN/infinite inputs. The targeted
   contract/connector checks and real-service acceptance pass after the fix.
2. A direct typecheck in the main checkout scanned ignored historical source backups in
   `artifacts/`, producing 104 unrelated errors. `01-typecheck-red.log` preserves the failure.
   `tsconfig.json` now excludes generated acceptance artifacts; backups remain intact and the
   actual source checks pass. The prior isolated-worktree gate did not contain those backups.
3. Independent product review reproduced a Cookie Manager refresh/close race: closing the old
   snapshot while a native read was pending could publish a late replacement and retain origin
   authority. `46-cookie-refresh-close-red.log` preserves three failing public-controller cases.
   Refresh now retains a bounded predecessor close handle for its own preparation through result
   delivery; close revokes the pending preparation/replacement/previews, while peer sessions remain
   usable. Expiry/invalidation clear those handles, and the next acknowledged refresh replaces its
   predecessor handle. Independent re-review also found the same gap at initial-open delivery:
   `51-cookie-open-handoff-red.log` retains the failing public regression. The preparation token
   now retains the same bounded close handle until the first acknowledged refresh; closing it
   revokes the published snapshot and previews without revoking a peer session. Repair-round
   checks and independent re-review are in the final evidence.
4. The round-2 whole Chromium gate exposed an existing editor-preview race: a delayed selection
   event could hide a completed result before the native writeback click. The focused diagnostic
   `66-chromium-diagnostic.log` reproduced it. Starting work now clears the old selection timer,
   and selection events during active work do not schedule post-completion toolbar refreshes.
   The lifecycle test also observes the targeted `ServiceWorker.stopWorker` stopped event rather
   than equating `Target.closeTarget` acknowledgement with actual worker shutdown. Native clicks,
   original-text/selection checks and post-restart product assertions remain intact. Final repair
   and browser evidence are recorded separately from the earlier failed runs.

Firefox setup failures are preserved separately: synthetic script quoting, missing native user
activation, an older pre-PC Firefox artifact, and re-selection after an explicit dismiss were test
harness issues. The final scenario uses the current production artifact and real WebDriver clicks;
it retains the product's user-gesture, dismissed-toolbar and explicit-writeback guarantees.

## Desktop tool change requested during acceptance

The user requested agent-desktop in place of cua-driver as the default native GUI tool.
Official `agent-desktop@1.3.1` is installed under Magpie's local support directory, pinned with its
npm lock and integrity. Magpie owns the local stdio MCP entry; its shared default instructions were
updated through `magpie library instructions set`, and the Codex instructions reflect the change.
Browser-page preference remains Playwright CLI extension mode. The launcher restores the actual
signed-in user's DBus/display environment for remote agent processes.

The native tool can inspect Magpie and other registered desktop apps. Chrome is not registered on
AT-SPI; the official Linux guide requires renderer accessibility. An attempted attachment did not
yield a Chrome window. No user Chrome restart, profile rewrite or security-setting change was
performed. The prior cua-driver installation is retained for other clients.

## Reproduce the local checkpoint

1. Read `checkpoint/source-and-artifacts.json` and verify `source-inputs.tar.gz` SHA-256.
2. Clone the recorded base HEAD into a new, owned directory; overlay that archive and remove only
   paths explicitly marked `deleted`. Verify every source file hash before dependency installation.
   This reconstructs the accepted uncommitted tree; checking out HEAD alone omits its new features.
3. Install from the frozen lockfile. Run current core/coverage, SDK, Chromium and Firefox gates;
   the browser test targets use separate output directories. A fresh source restoration/install
   and its actual check results are included in the final evidence.
4. Browser install archives live in this evidence root's `packages/`, with their file inventories
   and checksums. They are local, unsigned candidates. The loaded user Chrome directory is kept
   distinct from these packages.

RepoLens's current 20-file vendor is verified without synchronization. RC1's tag/source/ZIP/XPI
and the archived userscript repository are protected. No stage, commit, push, merge, tag, Release
or store upload is part of this task.
