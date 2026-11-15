import assert from 'node:assert/strict'
import process from 'node:process'

/** Test-only adapter over a disposable Firefox's real WebDriver/native extension boundary. */
export interface FirefoxAssistantDriver {
  execute: (_script: string, _args?: unknown[]) => Promise<unknown>
  executeAsync: (_script: string, _args?: unknown[]) => Promise<unknown>
  switchWindow: (_handle: string) => Promise<void>
  newTab: (_url: string) => Promise<string>
  wait: (_predicate: string, _label: string) => Promise<void>
  clickSurface: (_label: string) => Promise<void>
  click: (_selector: string) => Promise<void>
  grant: (_pattern: string) => Promise<void>
  revoke: (_pattern: string) => Promise<void>
}

export interface FirefoxAssistantRequests {
  text: number
  translation: number
  aborted: number
}

export async function runFirefoxAssistantScenario(
  driver: FirefoxAssistantDriver,
  panelHandle: string,
  origin: string,
  requests: FirefoxAssistantRequests,
) {
  const site = await driver.newTab(`${origin}/assistant/article`)
  await driver.wait('document.querySelector("#assistant-source")', 'Firefox assistant fixture')
  await driver.grant(`${origin}/*`)
  await driver.switchWindow(panelHandle)
  const protectedBefore = await driver.executeAsync(`
    const done=arguments[arguments.length-1];
    browser.storage.local.get(null).then(storage=>done({
      records:storage["oneweb.modules.v1"],
      states:Object.fromEntries(Object.entries(storage).filter(([key])=>key.startsWith("oneweb.module-state.v1:"))),
    }));
  `)
  await driver.execute('document.querySelector("[data-destination=settings]").click();return true')
  await driver.wait('document.querySelector("[data-testid=assistant-save-provider]")', 'Firefox assistant provider form')
  await driver.execute(`
    const fields={"服务地址":arguments[0]+"/assistant/v1/","模型（每行一个）":"firefox-assistant-fixture","API key":"FIREFOX-LOCAL-ONLY"};
    for(const [label,value] of Object.entries(fields)){
      const input=document.querySelector('[aria-label="'+label+'"]');
      if(!input)throw new Error("assistant field missing: "+label);
      input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));
    }
    return true;
  `, [origin])
  await driver.click('[data-testid=assistant-save-provider]')
  await driver.wait('document.querySelector("[data-testid=assistant-status]")?.textContent.includes("已保存")', 'Firefox assistant saved configuration')
  const activateSite = async () => {
    await driver.switchWindow(panelHandle)
    const result = await driver.executeAsync(`
      const origin=arguments[0],done=arguments[arguments.length-1];
      (async()=>{
        const tab=(await browser.tabs.query({})).find(tab=>tab.url===origin+"/assistant/article");
        if(!tab)throw new Error("assistant fixture tab missing");
        await browser.tabs.update(tab.id,{active:true});
        const result=await browser.runtime.sendMessage({channel:"oneweb.page-action.v1",command:"enable-site"});
        if(!result?.ok)throw new Error(result?.error||"enable failed");
        return true;
      })().then(done,error=>done({error:String(error)}));
    `, [origin])
    assert.equal(result, true)
    await driver.switchWindow(site)
    await driver.wait('document.querySelector("[data-oneweb-assistant]")?.shadowRoot', 'Firefox authorized assistant surface')
  }
  await activateSite()
  await driver.execute(`
    const p=document.querySelector("#assistant-source"),range=document.createRange();
    range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));return true;
  `)
  await driver.wait('!document.querySelector("[data-oneweb-assistant]").shadowRoot.querySelector(".toolbar").hidden', 'Firefox selection toolbar')
  await driver.clickSurface('翻译选文')
  await driver.wait('document.querySelector("[data-oneweb-assistant]").shadowRoot.querySelector(".output")?.textContent.includes("Firefox <b>safe</b>")', 'Firefox text-only streamed selection result')
  assert.equal(await driver.execute('return document.querySelector("[data-oneweb-assistant]").shadowRoot.querySelector(".output b")===null'), true)
  await driver.clickSurface('关闭结果')

  // A real native click executes the content action; preview must precede plain-text writeback.
  await driver.click('textarea')
  await driver.execute('const input=document.querySelector("textarea");input.focus();input.setSelectionRange(6,11);document.dispatchEvent(new Event("selectionchange"));return true')
  await driver.wait('!document.querySelector("[data-oneweb-assistant]").shadowRoot.querySelector(".toolbar").hidden', 'Firefox editor selection')
  await driver.clickSurface('改写选文')
  await driver.wait('document.querySelector("[data-oneweb-assistant]").shadowRoot.querySelector(".output")?.textContent.includes("Firefox <b>safe</b>")', 'Firefox editor preview')
  assert.equal(await driver.execute('return document.querySelector("textarea").value'), 'Hello world!')
  await driver.clickSurface('替换原选文')
  await driver.wait('document.querySelector("textarea").value==="Hello Firefox <b>safe</b>!"', 'Firefox explicit editor writeback')
  await driver.clickSurface('关闭结果')
  await driver.execute('document.querySelector("textarea").blur();getSelection().removeAllRanges();return true')
  await driver.clickSurface('打开 OneWeb')
  await driver.clickSurface('网页阅读')
  await driver.clickSurface('总结当前网页')
  await driver.wait('document.querySelector("[data-oneweb-assistant]").shadowRoot.querySelector(".output")?.textContent.includes("Firefox <b>safe</b>")', 'Firefox reading result')
  await driver.clickSurface('关闭结果')

  await driver.switchWindow(panelHandle)
  await driver.execute('document.querySelector("[data-destination=translation]").click();return true')
  await driver.wait('document.querySelector("[data-testid=assistant-translate-page]")', 'Firefox translation UI')
  await driver.executeAsync(`
    const done=arguments[arguments.length-1],origin=arguments[0];
    (async()=>{const tab=(await browser.tabs.query({})).find(tab=>tab.url===origin+"/assistant/article");
      await browser.tabs.update(tab.id,{active:true});return true;
    })().then(done,error=>done({error:String(error)}));
  `, [origin])
  await driver.click('[data-testid=assistant-translate-page]')
  await driver.switchWindow(site)
  await driver.wait('document.querySelectorAll("[data-oneweb-translation]").length>=3', 'Firefox bilingual page translation')
  await driver.execute('document.querySelector("#assistant-source").textContent="Website edited its own content";return true')
  await driver.switchWindow(panelHandle)
  await driver.execute('document.querySelector("[data-testid=assistant-restore-page]").click();return true')
  await driver.switchWindow(site)
  await driver.wait('document.querySelectorAll("[data-oneweb-translation]").length===0', 'Firefox translation restoration')
  assert.equal(await driver.execute('return document.querySelector("#assistant-source").textContent'), 'Website edited its own content')

  await driver.click('#assistant-source')
  await driver.execute('document.querySelector("#assistant-source").textContent="HOLD-FIREFOX-STREAM";const r=document.createRange();r.selectNodeContents(document.querySelector("#assistant-source"));getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event("selectionchange"));return true')
  await driver.wait('!document.querySelector("[data-oneweb-assistant]").shadowRoot.querySelector(".toolbar").hidden', 'Firefox cancellable selection')
  await driver.clickSurface('翻译选文')
  await driver.wait('document.querySelector("[data-oneweb-assistant]").shadowRoot.querySelector(".output")?.textContent.includes("Firefox pending")', 'Firefox open stream before revocation')
  await driver.revoke(`${origin}/*`)
  await driver.switchWindow(site)
  await driver.wait('!document.querySelector("[data-oneweb-assistant]")', 'Firefox revocation removes assistant resources')
  assert.equal(await driver.execute('return document.querySelector("textarea").value'), 'Hello Firefox <b>safe</b>!')
  await driver.switchWindow(panelHandle)
  const protectedAfter = await driver.executeAsync(`
    const done=arguments[arguments.length-1];
    browser.storage.local.get(null).then(storage=>done({
      records:storage["oneweb.modules.v1"],
      states:Object.fromEntries(Object.entries(storage).filter(([key])=>key.startsWith("oneweb.module-state.v1:"))),
    }));
  `)
  assert.deepEqual(protectedAfter, protectedBefore, 'Firefox assistant modified unrelated module records/state')
  assert.ok(requests.text >= 4 && requests.translation >= 1, 'Firefox assistant did not use the real local provider')
  // Completion is recorded by the server only after the actual streaming HTTP connection closes.
  const deadline = Date.now() + 5000
  while (requests.aborted === 0 && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(requests.aborted >= 1, 'Firefox revocation retained an open provider stream')
  process.stdout.write(`Firefox assistant gates: 4/4 passed (selection/text safety, preview/writeback, reading/translation recovery, revocation/HTTP abort/peer isolation) ${JSON.stringify(requests)}\n`)
}
