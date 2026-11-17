# OneWeb release and user flow

Date: 2026-11-17, CachyOS Linux. This task completes the local publishing implementation,
installation/use/update/rollback documentation and meaningful release tests. Existing uncommitted
integration work is retained. No public release, commit, push or store upload has been performed.

The source of truth is [ADR-0026](../adr/0026-unified-stable-release.md), the
[maintainer runbook](../releases/README.md) and the [user guide](../userscript-guide.md).
Stable releases contain all targets; user/meta headers share canonical manager-owned update URLs.
The former version literal freeze is replaced with supported stable version validation and package /
manifest agreement. GitHub Latest advances only after exact-tag/source CI and complete draft
roundtrip verification. CI explicitly enables isolated default-port HTTP fixtures, fixing a known
remote Firefox bind failure without widening the product's exact-origin behavior.

Task records, current-tree factory evidence, independent review and final real-manager results are
stored under Git common-dir `agent-factory/tasks/userscript-release-20261117*`.
The initial regression reproduces both missing update metadata and the failure of a coordinated
future version1.2.3. Final results must be read from this task's result, not the earlier consolidation.

The opt-in repository command `pnpm test:userscript:manager` requires an explicit unpacked manager
package path and fails rather than silently skipping when it is absent. Its evidence is written to
ignored test output, and its disposable browser profile is cleaned up. The real-manager fixture installs a synthetic older version of the shipped runtime, saves settings,
checks for updates through actual Tampermonkey UI, and verifies the current version, retained
settings, second-origin default-off and update-endpoint failure safety. It only substitutes metadata
version and local update/download URLs, records hashes, and leaves runtime/name/namespace/grants
unchanged. This does not establish public GitHub connectivity or Windows/macOS/other-manager support.

The final complete Firefox gate exposed a pre-existing fixture navigation race: the settings selector
matched the assistant's old mounted provider form before asynchronous settings open completed. Filling
that form was lost on replacement and its native click reference became stale. The fixture now waits
for the newly rendered settings form before filling. Native WebDriver clicks, scenario coverage and
zero whole-test retries remain unchanged. The old implementation fails the new public-driver DOM
regression; instrumented failure and a successful full-fixture diagnostic are retained in the task.
