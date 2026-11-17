# Standalone userscript target

`pnpm build:userscript` produces `artifacts/build/userscript/one-web.user.js` for installation in
Tampermonkey. It is standalone: it needs neither the OneWeb extension nor the retired project.

Open the script manager's **OneWeb → 启用当前站点工具** menu, then select tools from its menu or
the page-local control. Every origin and tool starts disabled. Disable drains the current page
immediately and keeps preferences; forget revokes the origin before deleting its finite settings.
The script stores booleans in manager-owned keys per exact origin and per packaged tool. It never
uses page localStorage, reads password values, imports the former OneMonkey settings, or automatically
sends page content. Selection search sends up to 200 selected characters only after an explicit
npm/GitHub link click, without a referrer. New installation identity means the old script should be disabled
before enabling the same tools in this target. The extension and script also have separate settings.

The DOM runtime, schemas, defaults, resource ownership and tool catalog are shared with the extension.
The GM adapter is a separate host; it does not emulate browser permissions, ports, native side panels,
or the other OneWeb extension modules. Tools use the packaged defaults. The manager grants HTTP(S)
injection; per-origin approval is a further application setting, not a browser security boundary.
Managers may choose a different script world despite `@sandbox DOM`; the script requests no
`unsafeWindow`, network or arbitrary code authority. A closed ShadowRoot reduces accidental page
interference and is not a security sandbox against a malicious browser or script manager.

`pnpm verify:userscript` builds and exercises the shipped file in a disposable Chromium isolated
world using test-owned GM storage/menu boundaries. This proves the bundle and browser DOM behavior;
it does not substitute for an actual Tampermonkey installation smoke. BFCache page transitions are
also covered at the controller boundary. GM offers no cross-tab CAS: changes to different tools use
different keys, while simultaneous writes to the same boolean follow the manager's last write.
