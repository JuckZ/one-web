# Integrated local acceptance

Date: 2026-11-15. This task closes local acceptance gaps in the current integrated OneWeb tree.
It introduces no new module, provider capability or release authorization.

## Acceptance slices

| ID    | Observable acceptance                                                                                                                                                                           | Evidence boundary                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LA-01 | Confirm the existing Chrome installation path and loaded generation; exercise current selection/page/editor/translation/capture entry points without exposing existing keys or private content. | Use Playwright CLI extension against the user's Chrome. Keep user tabs and logins. A file copy alone is not a browser reload.                                               |
| LA-02 | Exercise assistant/browser-task UI on real Firefox: explicit configuration, selection/read actions, editor preview/writeback, translation restoration and lifecycle rejection.                  | Use a disposable Firefox profile and deterministic local HTTP/SSE fixtures. Existing five builtin gates do not replace these scenarios.                                     |
| LA-03 | Record dubbing startup/subsequent-batch latency and uninterrupted playback over a bounded complete video; verify pause/seek/stop/late work.                                                     | Separate generated-media, real website/LAN-provider, and subjective listening conclusions. No paid call is inferred as authorized.                                          |
| LA-04 | Start isolated pinned real OpenList and AList instances; validate identity, dynamic tools, one-URL add, task read/cancel and error/lifecycle isolation.                                         | Use generated local credentials and disposable storage, never a user's existing service or files. Distinguish real server compatibility from the existing protocol fixture. |
| LA-05 | Freeze a reproducible local source/artifact checkpoint; review the integrated changes and retain checksums, exact tests, limits and recovery instructions.                                      | Preserve existing uncommitted work, RC1 and archived repositories. No commit, push, tag, merge or publication.                                                              |

## Invariants

- Existing module/session/generation, exact-origin, quota, cancellation and secret boundaries remain in force.
- Test services use loopback binding and temporary data. Real server egress is limited to test-controlled resources.
- No browser cookie/key export, generic fetch/script bridge, persistent queue, automatic retry or new business feature.
- Production fixes need an observable failure before a correction. Test-environment failures stay distinct from product failures.
- Human listening, untested OSes and inaccessible browser surfaces remain explicit open acceptance items.

## Completion

Each slice records passed checks or its concrete blocker and completed independent work. The final
checkpoint binds source inputs and browser artifacts and includes an independent review. Missing
required manual or environment acceptance is retained as incomplete rather than reported as passed.
