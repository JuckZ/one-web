import { RepoLensController } from '~/modules/builtin/repolens/controller'
import { handleRepoLensMessage, RepoLensClient } from '~/modules/builtin/repolens/protocol'
import { RepoLensView } from '../repolens-view'

function storage() {
  const values: Record<string, unknown> = {}
  return {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (entries: Record<string, unknown>) => { Object.assign(values, structuredClone(entries)) },
  }
}

function fixture(fetcher?: typeof fetch) {
  const requests: string[] = []
  const clipboard: string[] = []
  const controller = new RepoLensController({
    storage: storage(),
    secrets: storage(),
    permissions: { contains: async () => true },
    fetch: fetcher ?? (async (input) => {
      const url = new URL(String(input))
      requests.push(url.href)
      if (url.pathname === '/repos/vuejs/core') {
        return new Response(JSON.stringify({ full_name: 'vuejs/core', description: '<img src=x onerror=alert(1)>', topics: ['ui'], language: 'TypeScript', stargazers_count: 1000, pushed_at: '2026-11-15T00:00:00Z' }))
      }
      if (url.pathname.endsWith('/readme'))
        return new Response('Reactive web interface library.')
      if (url.pathname.endsWith('/releases'))
        return new Response('[]')
      if (url.pathname === '/search/repositories')
        return new Response('{"items":[]}')
      return new Response('{"total_count":2}')
    }) as typeof fetch,
  })
  const client = new RepoLensClient({ sendMessage: async message => handleRepoLensMessage(controller, message, {
    id: 'test',
    url: 'chrome-extension://test/dist/sidebar/index.html',
    documentId: 'view',
  }, 'test', 'chrome-extension://test/') })
  const root = document.createElement('section')
  document.body.append(root)
  const view = new RepoLensView(root, { client, permissions: { request: async () => true }, clipboard: { writeText: async (text) => {
    clipboard.push(text)
  } } })
  return { root, view, requests, clipboard, client }
}

afterEach(() => document.body.replaceChildren())

it('uses current GitHub context only on explicit analysis and copies a safe text report', async () => {
  const { root, view, requests, clipboard } = fixture()
  await view.open()
  view.updateContext('vuejs/core')
  expect(root.querySelector<HTMLInputElement>('[data-testid="repolens-repository"]')!.value).toBe('vuejs/core')
  expect(requests).toEqual([])
  root.querySelector<HTMLFormElement>('form')!.requestSubmit()
  await vi.waitFor(() => expect(root.querySelector('[data-testid="repolens-result"]')).not.toBeNull())
  expect(root.querySelector('[data-testid="repolens-status"]')!.textContent).toContain('分析完成')
  expect(root.textContent).toContain('<img src=x onerror=alert(1)>')
  expect(root.querySelector('img')).toBeNull()
  expect(requests.length).toBeGreaterThan(1)
  const copy = [...root.querySelectorAll('button')].find(button => button.textContent === '复制 Markdown 报告')!
  copy.click()
  await vi.waitFor(() => expect(clipboard).toHaveLength(1))
  expect(clipboard[0]).toContain('vuejs/core')
  view.dispose()
})

it('drops late analysis after navigation and leaves a usable input for the next repository', async () => {
  let release: ((_response: Response) => void) | undefined
  const { root, view } = fixture((async () => new Promise<Response>((resolve) => {
    release = resolve
  })) as typeof fetch)
  await view.open()
  view.updateContext('vuejs/core')
  root.querySelector<HTMLFormElement>('form')!.requestSubmit()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  view.updateContext('example/next')
  release!(new Response(JSON.stringify({ full_name: 'vuejs/core', topics: [] })))
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('[data-testid="repolens-analyze"]')!.disabled).toBe(false))
  expect(root.querySelector('[data-testid="repolens-result"]')).toBeNull()
  expect(root.querySelector<HTMLInputElement>('[data-testid="repolens-repository"]')!.value).toBe('example/next')
  view.dispose()
})

it('saves a Token through its trusted client, clears the field and does not send a network probe', async () => {
  const { root, view, requests, client } = fixture()
  await view.open()
  const token = root.querySelector<HTMLInputElement>('input[type="password"]')!
  token.value = 'synthetic-secret'
  root.querySelector<HTMLFormElement>('form[aria-label="RepoLens 连接设置"]')!.requestSubmit()
  await vi.waitFor(async () => expect(await client.configuration()).toEqual({ keyConfigured: true, remember: false }))
  await vi.waitFor(() => expect(token.value).toBe(''))
  expect(root.textContent).not.toContain('synthetic-secret')
  expect(requests).toEqual([])
  view.dispose()
})
