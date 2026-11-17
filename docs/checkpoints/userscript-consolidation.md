# OneWeb userscript consolidation

Date: 2026-11-17, CachyOS Linux. User authorized clean-room generic-tool rewrites, a standalone
userscript output from OneWeb and deletion of the old local/GitHub OneTampermonkey project only
after acceptance. The existing dirty smart-apps/RepoLens/live-model baseline is preserved.

## Delivered design

The seven static Page Toolbox tools share catalog/validation/DOM lifecycle across extension and
userscript. Four new local implementations add spacing measurement, a reading dimmer, bounded
loaded-hidden-DOM reveal and explicitly clicked npm/GitHub selection search. GM adapter state and
permissions remain separate from the extension. Metadata is preserved after build transforms.
CI verifies the built userscript and release artifact upload includes it; no publication occurs.
See [spec](../specs/userscript-distribution.md) and [ADR-0025](../adr/0025-oneweb-userscript-distribution.md).

## Verification and review record

Source-bound final commands, results, hashes, independent reviews and actual cleanup outcomes are
stored in the Git common-dir `agent-factory/tasks/tampermonkey-consolidation-20261117*` task record.
Required configurations: `.agent-factory.json` (core), `.agent-factory.userscript.json`,
`.agent-factory.chromium.json` and `.agent-factory.firefox-toolbox.json`. The Firefox target includes
production build, strict manifest lint, real temporary installation, seven-tool lifecycle/keyboard,
two-origin isolation and cleanup; it does not stand for every unrelated Firefox product scenario.

Independent real-manager QA loads the existing Tampermonkey5.5.1 package files into a disposable
Chromium profile, installs the actual shipped script through its Install page and exercises GM
menus/storage without GM replacements. The user's browser profile and installed scripts are not
used for this test. The separate deterministic browser suite replaces only the finite GM boundary
and observes the shipped artifact in an isolated world. Neither is evidence for every script manager,
Windows/macOS UI or every website. No LLM call is introduced or needed by these page tools.

The first real-manager probe found stripped metadata and insecure-HTTP randomUUID usage; both were
fixed. Independent review reproduced late persistence after pagehide, menu-failure cancellation,
page-owned UI deletion, excluded-container reveal and stale geometry during non-DOM layout changes.
The repair adds public regressions, durable queued revocation, owned UI cleanup, ancestor exclusions
and a ledgered measurement frame loop active only while elements are selected. Final verdict and
counts must be read from the final task result rather than inferred from these intermediate notes.

## Legacy boundary

Old private report/cookie code, automatic agreement/click replay, analytics-global nulling, remote
execution and demo assets are retired. The historical audit remains evidence, with no old build or
runtime dependency. No user-installed OneMonkey data is silently imported. Manager-level removal
may require reloading already-open pages; OneWeb's own disable/forget acts immediately.
