/* eslint-disable no-template-curly-in-string -- Prompt placeholders are literal user template data. */
import type { FirefoxAssistantDriver } from './firefox-assistant-scenario'
import assert from 'node:assert/strict'
import process from 'node:process'

export interface FirefoxSmartAppsDriver extends FirefoxAssistantDriver {
  /** null returns to the top-level document; numbers address child frames by index. */
  switchFrame: (_id: number | null) => Promise<void>
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), label)
  return value as Record<string, unknown>
}

/** Run after the assistant scenario configured its synthetic local provider. */
export async function runFirefoxSmartAppsScenario(
  driver: FirefoxSmartAppsDriver,
  panelHandle: string,
  origin: string,
) {
  const siteUrl = `${origin}/assistant/article?oneweb-smart-apps=fixture`
  const siteHandle = await driver.newTab(siteUrl)
  await driver.wait('document.querySelector("#assistant-source")', 'Firefox smart app source page')
  await driver.grant(`${origin}/*`)
  await driver.switchWindow(panelHandle)
  const baseline = await driver.executeAsync(`
    const done=arguments[arguments.length-1];
    browser.storage.local.get(null).then(storage=>done({
      records:storage["oneweb.modules.v1"],
      states:Object.fromEntries(Object.entries(storage).filter(([key])=>key.startsWith("oneweb.module-state.v1:"))),
    }));
  `)
  const command = async (name: string, data: object = {}) => {
    const response = record(await driver.executeAsync(`
      const command=arguments[0],data=arguments[1],done=arguments[arguments.length-1];
      browser.runtime.sendMessage({channel:"oneweb.smart-apps.v1",command,data})
        .then(done,error=>done({ok:false,error:String(error)}));
    `, [name, data]), `Firefox smart app ${name} response`)
    assert.equal(response.ok, true, `Firefox smart app ${name} failed: ${String(response.error)}`)
    return response.value
  }
  const initialApps = await command('list')
  const ownedIds: string[] = []
  const openTools = async () => {
    await driver.execute('document.querySelector("[data-destination=tools]").click();return true')
    await driver.wait('document.querySelector("[data-testid=smart-app-create]")', 'Firefox smart app library')
  }
  const appRow = (id: string) => `[data-app-id="${id}"]`
  try {
    const web = record(await command('create', { input: {
      kind: 'web-tool',
      name: 'Firefox 网页工具验收',
      description: 'Explicit current-page fixture',
      matches: [`${origin}/*`],
      prompt: 'Summarize the current page: ${title}\n${text}',
    } }), 'Firefox web tool definition')
    assert.equal(typeof web.id, 'string')
    ownedIds.push(web.id as string)
    await openTools()
    await driver.wait(`document.querySelector(${JSON.stringify(`${appRow(web.id as string)} .smart-app-open`)})`, 'Firefox web tool row')
    await driver.click(`${appRow(web.id as string)} .smart-app-open`)
    await driver.wait('document.querySelector(".smart-app-answer")', 'Firefox page tool run view')
    const activated = await driver.executeAsync(`
      const target=arguments[0],done=arguments[arguments.length-1];
      (async()=>{const tab=(await browser.tabs.query({})).find(tab=>tab.url===target);
        if(!tab)throw new Error("smart-app source tab missing");
        await browser.tabs.update(tab.id,{active:true});return true;
      })().then(done,error=>done({error:String(error)}));
    `, [siteUrl])
    assert.equal(activated, true)
    await driver.execute(`
      const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='运行当前网页');
      if(!button)throw new Error('page tool run button missing');
      button.id='firefox-smart-app-run';return true;
    `)
    await driver.click('#firefox-smart-app-run')
    await driver.wait('document.querySelector(".smart-app-answer")?.textContent.includes("Firefox <b>safe</b>")', 'Firefox page tool explicit model result')
    assert.equal(await driver.execute('return document.querySelector(".smart-app-answer b")===null'), true, 'Firefox page tool interpreted model HTML')
    await driver.execute(`
      [...document.querySelectorAll('button')].find(button=>button.textContent==='返回应用列表').click();return true;
    `)
    await driver.wait('document.querySelector("[data-testid=smart-app-create]")', 'Firefox library after page tool')

    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Firefox 隔离计数器</title><body>
      <button id="increment" type="button">增加</button><output id="count">0</output>
      <p id="runtime"></p><p id="parent-access"></p><p id="network"></p><p id="network-policy"></p><p id="rtc"></p>
      <script>
      let count=0;
      document.querySelector('#increment').addEventListener('click',()=>{document.querySelector('#count').textContent=String(++count)});
      document.querySelector('#runtime').textContent=String(Boolean(globalThis.browser&&browser.runtime||globalThis.chrome&&chrome.runtime));
      try{parent.parent.document.body.dataset.smartAppEscaped='yes';document.querySelector('#parent-access').textContent='escaped'}catch{document.querySelector('#parent-access').textContent='blocked'}
      document.querySelector('#rtc').textContent=typeof RTCPeerConnection;
      document.addEventListener('securitypolicyviolation',event=>{if(event.effectiveDirective==='connect-src')document.querySelector('#network-policy').textContent='connect-src'});
      fetch('https://example.invalid/oneweb-firefox-mini-app-probe').then(()=>{document.querySelector('#network').textContent='escaped'},()=>{document.querySelector('#network').textContent='blocked'});
      </script></body></html>`
    const mini = record(await command('create', { input: { kind: 'mini-app', name: 'Firefox 隔离小应用验收', html } }), 'Firefox mini app definition')
    assert.equal(typeof mini.id, 'string')
    ownedIds.push(mini.id as string)
    // Page capture activated the source tab. Native frame clicks must target the visible
    // workspace tab, not only Marionette's retained execution context.
    await driver.switchWindow(panelHandle)
    await driver.wait(`document.querySelector(${JSON.stringify(`${appRow(mini.id as string)} .smart-app-open`)})`, 'Firefox mini app row')
    await driver.click(`${appRow(mini.id as string)} .smart-app-open`)
    await driver.wait('document.querySelector("iframe.smart-app-preview")', 'Firefox packaged mini app loader')
    await driver.execute('document.querySelector("iframe.smart-app-preview").scrollIntoView({block:"start",inline:"nearest"});return true')
    await driver.switchFrame(0)
    await driver.wait('document.querySelector("iframe")', 'Firefox nested opaque app frame')
    await driver.switchFrame(0)
    await driver.wait('document.querySelector("#increment")&&document.querySelector("#network-policy")?.textContent==="connect-src"', 'Firefox interactive mini app and enforced network CSP')
    await driver.click('#increment')
    await driver.click('#increment')
    const state = await driver.execute(`
      return {count:document.querySelector('#count').textContent,
        runtime:document.querySelector('#runtime').textContent,
        parent:document.querySelector('#parent-access').textContent,
        network:document.querySelector('#network').textContent,
        networkPolicy:document.querySelector('#network-policy').textContent,
        rtc:document.querySelector('#rtc').textContent};
    `)
    assert.deepEqual(state, { count: '2', runtime: 'false', parent: 'blocked', network: 'blocked', networkPolicy: 'connect-src', rtc: 'undefined' })
    await driver.switchFrame(null)
    assert.equal(await driver.execute('return Boolean(document.body.dataset.smartAppEscaped)'), false, 'Firefox mini app changed parent DOM')
    await driver.execute(`
      [...document.querySelectorAll('button')].find(button=>button.textContent==='返回应用列表').click();return true;
    `)
    await driver.wait('!document.querySelector("iframe.smart-app-preview")&&document.querySelector("[data-testid=smart-app-create]")', 'Firefox mini app cleanup')
    await command('set-enabled', { id: mini.id, enabled: false })
    await driver.wait(`document.querySelector(${JSON.stringify(`${appRow(mini.id as string)} [role=switch]`)})?.getAttribute('aria-checked')==='false'`, 'Firefox mini app disabled state')
  }
  finally {
    await driver.switchFrame(null).catch(() => {})
    await driver.switchWindow(panelHandle)
    for (const id of ownedIds)
      await command('remove', { id })
  }
  assert.deepEqual(await command('list'), initialApps, 'Firefox smart app gate changed unrelated app definitions')
  const after = await driver.executeAsync(`
    const done=arguments[arguments.length-1];
    browser.storage.local.get(null).then(storage=>done({
      records:storage["oneweb.modules.v1"],
      states:Object.fromEntries(Object.entries(storage).filter(([key])=>key.startsWith("oneweb.module-state.v1:"))),
    }));
  `)
  assert.deepEqual(after, baseline, 'Firefox smart apps modified unrelated module records/state')
  await driver.revoke(`${origin}/*`)
  await driver.switchWindow(siteHandle)
  process.stdout.write('Firefox smart applications: 2/2 passed (explicit page tool/text safety, interactive HTML sandbox/network/parent/runtime/RTC denial and cleanup/peer isolation)\n')
}
