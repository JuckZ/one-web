# ADR-0025: One repository for extension and userscript page tools

- Status: Accepted for local implementation
- Date: 2026-11-17

The user requested consolidation of OneTampermonkey into OneWeb, a directly installable userscript build, clean-room rewrites of the remaining generic tools, and removal of the legacy local and GitHub repository after acceptance.

Use the existing finite Page Toolbox catalog and pure DOM runtime for both targets. The extension retains its authenticated host-derived per-origin lifecycle; the userscript has its own GM storage/menu adapter and application-level per-origin opt-in. Do not emulate chrome/browser APIs or send script settings through extension RPC. The standalone IIFE bundles all code locally, declares HTTP(S) top documents, DOM sandbox and only the GM grants it needs. Build metadata is added after JS transforms and checked on the shipped file.

Expand the catalog from three to seven finite, default-off tools with local element geometry, a reversible reading dimmer, bounded existing hidden-DOM reveal and explicit selection search. This new authorization supersedes ADR-0019's phase-specific no-go for the two generic concepts; its rejection of downloaded execution, broad mutation and private-site logic remains in force. The dimmer has a deliberately smaller visual promise than automatic dark theming. No arbitrary selector, script, CSS or event language is exposed.

Only explicit fixed search links send selected text to npm/GitHub. Selection text is transient and input values are excluded; no automatic request, telemetry, model call or remote code is added. Data inventory and Firefox searchTerms disclosure change together. Page-owned subsequent mutations must not be overwritten by cleanup. Navigation, disable, forget, failed storage and delayed writes cannot resurrect local authority.

Old GM identity/data and extension settings are independent. No silent default-on migration or shared manager/extension credential store. The userscript covers page tools, while browser-privileged modules continue in the extension. Legacy analytics-null stubs, intranet/report code, cookie bypass, automatic agreement/click replay and demo assets are retired rather than kept as a second product.

See the userscript distribution spec and the existing immutable legacy audit. Final source-bound evidence and cleanup results live in the consolidation task record. User authorization covers deleting the verified legacy repository after migration acceptance; it does not publish OneWeb or alter the user's installed extensions/scripts.
