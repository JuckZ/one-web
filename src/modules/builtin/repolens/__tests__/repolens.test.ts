// @vitest-environment node
import type { RequestListener } from 'node:http'
import { createServer } from 'node:http'
import { REPOLENS_CHANNEL, REPOLENS_SECRET_KEY, REPOLENS_STORAGE_KEY } from '../contracts'
import { RepoLensController } from '../controller'
import { handleRepoLensMessage, RepoLensClient } from '../protocol'

// Public, synthetic fixture data; never loaded from a real account.
const credentialFixture = 'synthetic-github-token'

function storage() {
  const values: Record<string, unknown> = {}
  return {
    get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
    set: async (entries: Record<string, unknown>) => { Object.assign(values, structuredClone(entries)) },
  }
}
const servers: ReturnType<typeof createServer>[] = []
afterEach(() => servers.splice(0).forEach(server => server.closeAllConnections()))

function repo(fullName: string, overrides = {}) {
  return {
    full_name: fullName,
    description: 'Reactive web user interface library',
    topics: ['reactive', 'ui'],
    language: 'TypeScript',
    stargazers_count: 1000,
    forks_count: 100,
    open_issues_count: 10,
    pushed_at: '2026-11-15T00:00:00Z',
    private: false,
    ...overrides,
  }
}

async function fixture(handler?: RequestListener) {
  const requests: Array<{ url: string, authorization: string | undefined }> = []
  const server = createServer((req, res) => {
    requests.push({ url: req.url!, authorization: req.headers.authorization })
    if (handler) {
      handler(req, res)
      return
    }
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url!, 'https://api.github.com')
    if (url.pathname.endsWith('/readme')) {
      res.end(url.pathname.includes('unrelated') ? 'A desktop music player and audio mixer.' : 'Reactive web user interface library.')
    }
    else if (url.pathname.endsWith('/releases')) {
      res.end(JSON.stringify([{ name: 'v1.2.3', published_at: '2026-11-10T00:00:00Z' }]))
    }
    else if (url.pathname === '/search/issues') {
      res.end(JSON.stringify({ total_count: 5 }))
    }
    else if (url.pathname === '/search/repositories') {
      res.end(JSON.stringify({ items: [repo('vuejs/core'), repo('example/reactive'), repo('example/unrelated', { topics: ['audio'], language: 'Rust', description: 'Desktop music player' }), repo('example/private', { private: true })] }))
    }
    else {
      res.end(JSON.stringify(repo('vuejs/core')))
    }
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const disk = storage()
  const session = storage()
  let allowed = true
  let enabled = true
  let now = Date.parse('2026-11-16T00:00:00Z')
  const calls: Array<{ url: string, init?: RequestInit }> = []
  const createController = () => new RepoLensController({
    storage: disk,
    secrets: session,
    permissions: { contains: async () => allowed },
    enabled: async () => enabled,
    now: () => now,
    fetch: (async (input, init) => {
      const url = new URL(String(input))
      calls.push({ url: url.href, init })
      expect(url.origin).toBe('https://api.github.com')
      return fetch(`${local}${url.pathname}${url.search}`, init)
    }) as typeof fetch,
  })
  const controller = createController()
  const createClient = (target = controller, owner = 'workspace-a') => new RepoLensClient({ sendMessage: async message => handleRepoLensMessage(target, message, {
    id: 'test',
    url: 'chrome-extension://test/dist/sidebar/index.html',
    documentId: owner,
  }, 'test', 'chrome-extension://test/') })
  return {
    client: createClient(),
    controller,
    requests,
    calls,
    disk,
    session,
    createClient,
    createController,
    setAllowed: (value: boolean) => { allowed = value },
    setEnabled: (value: boolean) => { enabled = value },
    setNow: (value: number) => { now = value },
  }
}

it('analyzes a public repository, ranks semantically related projects and restores its local cache after restart', async () => {
  const { client, requests, calls, createClient, createController } = await fixture()
  const result = await client.analyze('https://github.com/vuejs/core/tree/main?secret=not-transmitted#readme')
  expect(result).toMatchObject({ repository: { fullName: 'vuejs/core', stars: 1000 }, cached: false, warnings: [], latestRelease: { name: 'v1.2.3' } })
  expect(result.similar.map(item => item.repository.fullName)).toEqual(['example/reactive', 'example/unrelated'])
  expect(result.similar[0].score).toBeGreaterThan(result.similar[1].score)
  expect(result.activity).toEqual({ issuesCreated: 5, issuesClosed: 5, pullsCreated: 5, pullsMerged: 5 })
  expect(result.snapshots).toEqual([{ day: '2026-11-16', stars: 1000 }])
  expect(result.report).toContain('https://github.com/vuejs/core')
  expect(result.queries).toHaveLength(3)
  expect(JSON.stringify(requests)).not.toContain('not-transmitted')
  expect(calls.every(call => call.init?.method === 'GET' && call.init.redirect === 'error' && call.init.credentials === 'omit')).toBe(true)
  const count = requests.length
  const restored = createClient(createController())
  expect(await restored.analyze('vuejs/core')).toMatchObject({ cached: true, repository: { fullName: 'vuejs/core' } })
  expect(requests).toHaveLength(count)
})

it('keeps an optional Token out of results and config, defaults to session and can explicitly forget it', async () => {
  const { client, disk, session, requests, createClient, createController } = await fixture()
  expect(await client.configure({ token: credentialFixture, remember: false })).toEqual({ keyConfigured: true, remember: false })
  expect((await disk.get(REPOLENS_SECRET_KEY))[REPOLENS_SECRET_KEY]).toBeNull()
  expect((await session.get(REPOLENS_SECRET_KEY))[REPOLENS_SECRET_KEY]).toMatchObject({ token: credentialFixture })
  expect(JSON.stringify(await client.analyze('vuejs/core'))).not.toContain('synthetic-github-token')
  expect(requests.every(item => item.authorization === 'Bearer synthetic-github-token')).toBe(true)
  const restored = createClient(createController())
  expect(await restored.configuration()).toEqual({ keyConfigured: true, remember: false })
  await restored.configure({ token: '', remember: false })
  expect(await restored.configuration()).toEqual({ keyConfigured: false, remember: false })
  expect((await session.get(REPOLENS_SECRET_KEY))[REPOLENS_SECRET_KEY]).toBeNull()
  expect(JSON.stringify((await disk.get(REPOLENS_STORAGE_KEY))[REPOLENS_STORAGE_KEY])).not.toContain('synthetic-github-token')
})

it('records partial sources and handles GitHub rate limits without inventing activity or hiding missing data', async () => {
  const { client } = await fixture((req, res) => {
    const url = new URL(req.url!, 'https://api.github.com')
    if (url.pathname === '/repos/vuejs/core')
      res.end(JSON.stringify(repo('vuejs/core')))
    else
      res.writeHead(403).end('rate limited')
  })
  const result = await client.analyze('vuejs/core')
  expect(result.activity).toBeNull()
  expect(result.similar).toEqual([])
  expect(result.latestRelease).toBeNull()
  expect(result.warnings.join(' ')).toContain('GitHub 请求受限')
  expect(result.report).toContain('GitHub 请求受限')
})

it('rejects private repositories, hostile inputs and unauthorized senders before exposing any data', async () => {
  const { controller, client, requests } = await fixture((_req, res) => res.end(JSON.stringify(repo('owner/private', { private: true }))))
  await expect(client.analyze('https://evil.example/a/b')).rejects.toThrow('公开 GitHub')
  await expect(client.analyze('../repo')).rejects.toThrow('仓库名称')
  expect(requests).toHaveLength(0)
  const message = { channel: REPOLENS_CHANNEL, command: 'configuration', data: {} }
  expect(handleRepoLensMessage(controller, message, { id: 'test', url: 'https://github.com/a/b' }, 'test', 'chrome-extension://test/')).toBeUndefined()
  await expect(client.analyze('owner/private')).rejects.toThrow('公开 GitHub')
  expect(requests).toHaveLength(1)
})

it('cancels only the requesting owner and rejects late results on disable, revoke and clear', async () => {
  let respond: (() => void) | undefined
  const { client, controller, disk, setEnabled, setAllowed } = await fixture((_req, res) => {
    respond = () => res.end(JSON.stringify(repo('vuejs/core')))
  })
  const first = client.analyze('vuejs/core')
  const firstRejected = expect(first).rejects.toThrow()
  await vi.waitFor(() => expect(respond).toBeTypeOf('function'))
  await client.cancel()
  respond!()
  await firstRejected
  expect((await disk.get(REPOLENS_STORAGE_KEY))[REPOLENS_STORAGE_KEY]).toBeUndefined()
  setEnabled(false)
  await expect(client.analyze('vuejs/core')).rejects.toThrow('已停用')
  setEnabled(true)
  setAllowed(false)
  await expect(client.analyze('vuejs/core')).rejects.toThrow('授权')
  setAllowed(true)
  respond = undefined
  const next = client.analyze('vuejs/core')
  const nextRejected = expect(next).rejects.toThrow()
  await vi.waitFor(() => expect(respond).toBeTypeOf('function'))
  controller.invalidate()
  respond!()
  await nextRejected
  await client.clear()
  expect((await disk.get(REPOLENS_STORAGE_KEY))[REPOLENS_STORAGE_KEY]).toMatchObject({ cache: [], snapshots: {} })
})

it('bounds API responses and never follows redirects carrying an authorization header', async () => {
  const { client, calls } = await fixture((_req, res) => res.end('x'.repeat(1024 * 1024 + 1)))
  await client.configure({ token: credentialFixture, remember: false })
  await expect(client.analyze('vuejs/core')).rejects.toThrow('响应过大')
  expect(calls[0].init).toMatchObject({ redirect: 'error', credentials: 'omit' })
})

it('updates forward-only daily snapshots after cache expiry and clears only RepoLens data', async () => {
  const { client, disk, setNow } = await fixture()
  await disk.set({ unrelatedModule: { keep: true } })
  await client.analyze('vuejs/core')
  setNow(Date.parse('2026-11-17T00:00:00Z'))
  expect((await client.analyze('vuejs/core')).snapshots).toHaveLength(2)
  await client.clear()
  expect((await disk.get('unrelatedModule')).unrelatedModule).toEqual({ keep: true })
})
