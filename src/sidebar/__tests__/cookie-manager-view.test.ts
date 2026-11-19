import { CookieManagerController } from '~/modules/builtin/cookie-manager/controller'
import { createCookieManagerSeed } from '~/modules/builtin/cookie-manager/manifest'
import { CookieManagerClient, handleCookieManagerMessage } from '~/modules/builtin/cookie-manager/protocol'
import { CookieManagerView } from '../cookie-manager-view'

it('requires explicit reading, hides values and reviews a selected deletion in the packaged view', async () => {
  const cookie = {
    name: 'session',
    value: '<img data-cookie-xss src=x>',
    domain: 'example.com',
    path: '/',
    storeId: '0',
    hostOnly: true,
    secure: true,
    httpOnly: true,
    session: true,
    sameSite: 'lax' as const,
  }
  let permitted = false
  let cookies = [cookie]
  const copied: string[] = []
  const downloads: string[] = []
  const seed = createCookieManagerSeed()
  const controller = new CookieManagerController({
    registry: {
      get: async () => ({
        ...seed,
        enabled: true,
        source: 'seeded',
        update: null,
        installedAt: '2026-11-12',
        updatedAt: '2026-11-12',
      }),
    },
    permissions: { contains: async () => permitted },
    tabs: { query: async () => [], get: async () => ({}) },
    cookies: {
      getAllCookieStores: async () => [{ id: '0' }],
      getAll: async () => structuredClone(cookies),
      get: async () => cookies[0],
      set: async (details) => {
        cookies = [{ ...cookie, value: details.value }]
        return cookies[0]
      },
      remove: async () => {
        cookies = []
        return { name: 'session' }
      },
    },
  })
  const client = new CookieManagerClient({
    sendMessage: async message => handleCookieManagerMessage(
      controller,
      message,
      { id: 'test', url: 'chrome-extension://test/sidebar.html' },
      'test',
      'chrome-extension://test/',
    ),
  })
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  const view = new CookieManagerView(root, {
    client,
    permissions: { request: async () => {
      permitted = true
      return true
    } },
    clipboard: { writeText: async (text) => {
      copied.push(text)
    } },
    download: (text) => {
      downloads.push(text)
    },
  })
  const click = (testId: string) => root.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click()
  expect(root.querySelectorAll('[data-cookie-row]')).toHaveLength(0)
  click('cookie-all')
  await vi.waitFor(() => expect(root.querySelector('[data-testid="cookie-authorize"]')).not.toBeNull())
  click('cookie-authorize')
  await vi.waitFor(() => expect(root.querySelectorAll('[data-cookie-row]')).toHaveLength(1))
  expect(root.textContent).not.toContain(cookie.value)
  expect(root.querySelector('[data-cookie-xss]')).toBeNull()
  click('cookie-edit')
  const value = root.querySelector<HTMLTextAreaElement>('[data-testid="cookie-value"]')!
  expect(value.value).toBe(cookie.value)
  expect(root.querySelector<HTMLInputElement>('[data-testid="cookie-name"]')!.disabled).toBe(true)
  value.value = 'edited-through-form'
  value.dispatchEvent(new Event('input'))
  click('cookie-save')
  await vi.waitFor(() => expect(root.textContent).toContain('Cookie 已保存'))
  click('cookie-copy')
  await vi.waitFor(() => expect(root.textContent).toContain('Cookie 值已复制'))
  expect(copied).toEqual(['edited-through-form'])
  click('cookie-select-domain')
  expect(root.querySelector<HTMLInputElement>('[data-cookie-select]')!.checked).toBe(true)
  click('cookie-select-none')
  root.querySelector<HTMLInputElement>('[data-cookie-select]')!.click()
  click('cookie-export')
  expect(downloads).toHaveLength(0)
  const search = root.querySelector<HTMLInputElement>('input[type="search"]')!
  search.value = 'hidden-result'
  search.dispatchEvent(new Event('input'))
  expect(root.querySelector('[data-testid="cookie-export-confirm"]')).toBeNull()
  search.value = ''
  search.dispatchEvent(new Event('input'))
  root.querySelector<HTMLInputElement>('[data-cookie-select]')!.click()
  click('cookie-export')
  click('cookie-export-confirm')
  await vi.waitFor(() => expect(root.textContent).toContain('JSON 已导出'))
  expect(JSON.parse(downloads[0])).toEqual([{ ...cookie, value: 'edited-through-form' }])
  const store = root.querySelector<HTMLSelectElement>('[data-testid="cookie-import-store"]')!
  store.value = '0'
  store.dispatchEvent(new Event('change'))
  const file = new File([JSON.stringify([{ ...cookie, value: 'restored-value' }])], 'cookies.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify([{ ...cookie, value: 'restored-value' }]) })
  const upload = root.querySelector<HTMLInputElement>('[data-testid="cookie-import-file"]')!
  Object.defineProperty(upload, 'files', { value: [file] })
  upload.dispatchEvent(new Event('change'))
  await vi.waitFor(() => expect(root.querySelectorAll('[data-cookie-preview]')).toHaveLength(1))
  expect(cookies[0].value).toBe('edited-through-form')
  root.querySelector<HTMLInputElement>('[data-cookie-preview-select]')!.click()
  click('cookie-import-confirm')
  await vi.waitFor(() => expect(root.querySelector('[data-testid="cookie-import-confirm"]')).toBeNull())
  expect(cookies[0].value).toBe('restored-value')
  expect(root.querySelector('[data-cookie-result]')?.textContent).toContain('example.com · session · / · Store 0')
  root.querySelector<HTMLInputElement>('[data-cookie-select]')!.click()
  click('cookie-delete')
  expect(root.textContent).toContain('将删除 1 个 Cookie')
  expect(root.querySelectorAll('[data-cookie-row]')).toHaveLength(1)
  click('cookie-delete-confirm')
  await vi.waitFor(() => expect(root.querySelectorAll('[data-cookie-row]')).toHaveLength(0))
  expect(root.textContent).toContain('成功 1 项')
  view.destroy()
})
