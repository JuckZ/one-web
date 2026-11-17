import type { FirefoxAssistantDriver } from '../../../scripts/firefox-assistant-scenario'
import { compileFunction, createContext, runInContext } from 'node:vm'
import { expect, it } from 'vitest'
import { runFirefoxAssistantScenario } from '../../../scripts/firefox-assistant-scenario'

it('fills the newly loaded settings form before issuing a single native save gesture', async () => {
  const renderForm = () => {
    document.querySelector('[data-testid=assistant-workspace]')!.innerHTML = `
      <h1>模型与偏好</h1>
      <input aria-label="服务地址" value="https://api.openai.com/v1/">
      <textarea aria-label="模型（每行一个）"></textarea><input aria-label="API key">
      <button data-testid="assistant-save-provider">授权并保存</button>`
  }
  document.body.innerHTML = '<p id="assistant-source">Fixture</p><button data-destination="settings">设置</button><section data-testid="assistant-workspace"></section>'
  renderForm()
  let navigationPending = false
  let freshForm = false
  document.querySelector('button')!.addEventListener('click', () => {
    navigationPending = true
  })
  const completeNavigation = () => {
    expect(navigationPending).toBe(true)
    renderForm()
    freshForm = true
  }
  const context = createContext({ document, Event })
  const stop = new Error('Stop after observing the native save boundary')
  const saved: Record<string, string>[] = []
  const driver: FirefoxAssistantDriver = {
    execute: async (script, args = []) => compileFunction(script, [], { parsingContext: context })(...args),
    executeAsync: async () => ({}),
    newTab: async () => 'fixture',
    switchWindow: async () => {},
    grant: async () => {},
    revoke: async () => {},
    clickSurface: async () => {},
    wait: async (predicate) => {
      if (!runInContext(`Boolean(${predicate})`, context))
        completeNavigation()
      expect(runInContext(`Boolean(${predicate})`, context)).toBe(true)
    },
    click: async () => {
      // The async settings load replaces any old form before WebDriver can dispatch its click.
      if (!freshForm)
        completeNavigation()
      saved.push(Object.fromEntries([...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].map(input => [input.getAttribute('aria-label')!, input.value])))
      throw stop
    },
  }
  try {
    await expect(runFirefoxAssistantScenario(driver, 'panel', 'http://127.0.0.1', { text: 0, translation: 0, aborted: 0 })).rejects.toBe(stop)
    expect(saved).toEqual([{
      '服务地址': 'http://127.0.0.1/assistant/v1/',
      '模型（每行一个）': 'firefox-assistant-fixture',
      'API key': 'FIREFOX-LOCAL-ONLY',
    }])
  }
  finally {
    document.body.replaceChildren()
  }
})
