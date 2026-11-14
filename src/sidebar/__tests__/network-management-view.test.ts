import { afterEach, expect, it, vi } from 'vitest'
import { createNetworkHarness } from '~/modules/builtin/network-management/__tests__/harness'
import { NetworkManagementView } from '../network-management-view'

const views: NetworkManagementView[] = []

afterEach(() => {
  views.splice(0).forEach(view => view.destroy())
  document.body.replaceChildren()
})

function mount(firefox = false) {
  const harness = createNetworkHarness()
  const openTest = vi.fn(async () => undefined)
  const root = document.createElement('section')
  document.body.replaceChildren(root)
  const view = new NetworkManagementView(root, {
    client: harness.client,
    permissions: harness.system.permissions,
    openTest,
    firefox,
  })
  views.push(view)
  void view.refresh()
  const element = <T extends HTMLElement>(testId: string) => root.querySelector<T>(`[data-testid="${testId}"]`)!
  return { ...harness, root, view, element, openTest }
}

it('opens the WebRTC panel without granting permissions or changing browser settings (T2)', async () => {
  const { root, system, element } = mount()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  expect(root.textContent).toContain('WebRTC 防护')
  expect(system.permissions.request).not.toHaveBeenCalled()
  expect(system.privacy.set).not.toHaveBeenCalled()
  expect(element<HTMLSelectElement>('network-policy').value).toBe('disable_non_proxied_udp')
  expect(element<HTMLSelectElement>('network-policy').options).toHaveLength(4)
  expect(element<HTMLInputElement>('network-block-support').checked).toBe(true)
  expect(element<HTMLInputElement>('network-block-devices').checked).toBe(false)
  expect(element<HTMLInputElement>('network-block-additional').checked).toBe(false)
  expect(root.textContent).toContain('网页通话')
  expect(root.textContent).toContain('已有页面需刷新')
})

it('explains Firefox policy coverage before the user applies it and associates it with the controls (T2)', async () => {
  const { root, system, element } = mount(true)
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  const hint = element('network-scope')
  expect(hint?.textContent).toContain('普通窗口和隐私窗口')
  expect(hint?.textContent).toContain('允许 OneWeb 运行的窗口')
  expect(element('network-policy').getAttribute('aria-describedby')).toBe(hint.id)
  expect(element('network-apply').getAttribute('aria-describedby')).toBe(hint.id)
  expect(root.querySelectorAll('[role="alert"]')).toHaveLength(0)
  expect(system.permissions.request).not.toHaveBeenCalled()
  expect(system.privacy.set).not.toHaveBeenCalled()
})

it('requests permissions in the click turn and leaves protection unchanged when permission is declined (T2)', async () => {
  const { system, root, element } = mount()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  system.allowPermission = false
  element<HTMLButtonElement>('network-apply').click()
  expect(system.permissions.request).toHaveBeenCalledWith({
    permissions: ['privacy'],
    origins: ['http://*/*', 'https://*/*'],
  })
  await vi.waitFor(() => expect(element('network-message').textContent).toContain('未获得授权'))
  expect(system.privacy.set).not.toHaveBeenCalled()
  expect(system.scripting.registerContentScripts).not.toHaveBeenCalled()
  expect(root.getAttribute('aria-busy')).toBe('false')
})

it('applies an IP policy through the real client and requests only privacy when no page option is selected (T2)', async () => {
  const { client, system, element } = mount()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  element<HTMLInputElement>('network-block-support').checked = false
  element<HTMLSelectElement>('network-policy').value = 'default_public_interface_only'
  element<HTMLButtonElement>('network-apply').click()
  expect(system.permissions.request).toHaveBeenCalledWith({ permissions: ['privacy'] })
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('防护已生效'))
  expect(element('network-status').textContent).toContain('实际策略：仅默认公网接口')
  expect(element('network-status').textContent).toContain('本插件控制')
  expect(await client.status()).toMatchObject({ ok: true, value: { protected: true, actualPolicy: 'default_public_interface_only' } })
  expect(system.scripting.registerContentScripts).not.toHaveBeenCalled()
})

it('applies independent page options and explicitly clears protection without requesting more access (T2)', async () => {
  const { client, system, element } = mount()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  element<HTMLInputElement>('network-block-support').checked = false
  element<HTMLInputElement>('network-block-devices').checked = true
  element<HTMLInputElement>('network-block-additional').checked = true
  element<HTMLButtonElement>('network-apply').click()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('已注册（新页面生效）'))
  expect(await client.status()).toMatchObject({
    ok: true,
    value: { settings: { enabled: true, blockSupport: false, blockDevices: true, blockAdditional: true }, scriptsActive: true },
  })
  element<HTMLButtonElement>('network-disable').click()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('防护未开启'))
  expect(system.privacy.clear).toHaveBeenCalledWith({ scope: 'regular_only' })
  expect(system.permissions.request).toHaveBeenCalledTimes(1)
  expect(await client.status()).toMatchObject({ ok: true, value: { settings: { enabled: false }, scriptsActive: false, protected: false } })
  expect(element('network-message').textContent).toContain('已释放')
})

it('shows a control conflict from the real browser result without reporting successful protection (T2)', async () => {
  const { system, element } = mount()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  system.levelOfControl = 'controlled_by_other_extensions'
  system.actualPolicy = 'default_public_and_private_interfaces'
  element<HTMLButtonElement>('network-apply').click()
  await vi.waitFor(() => expect(element('network-message').textContent).toContain('其他扩展或浏览器策略'))
  expect(element('network-status').textContent).toContain('其他扩展控制')
  expect(element('network-status').textContent).toContain('实际策略：默认公网与私网接口')
  expect(element('network-status').textContent).not.toContain('防护已生效')
  expect(element('network-message').textContent).not.toContain('设置已应用')
  expect(system.privacy.set).not.toHaveBeenCalled()
})

it('manually rereads actual browser state and clears stale failure feedback after retry (T2)', async () => {
  const { system, element } = mount()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  system.privacyPermission = true
  system.privacy.get.mockRejectedValueOnce(new Error('browser unavailable'))
  element<HTMLButtonElement>('network-refresh').click()
  await vi.waitFor(() => expect(element('network-message').textContent).toContain('未完成'))
  system.actualPolicy = 'default_public_interface_only'
  element<HTMLButtonElement>('network-refresh').click()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('实际策略：仅默认公网接口'))
  expect(element('network-message').textContent).toContain('已刷新')
  expect(element('network-message').textContent).not.toContain('未完成')
  expect(system.permissions.request).not.toHaveBeenCalled()
})

it('opens the external leak test only after an explicit click and does not request access (T2)', async () => {
  const { system, openTest, root, element } = mount()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  expect(openTest).not.toHaveBeenCalled()
  expect(root.textContent).toContain('外部站点')
  element<HTMLButtonElement>('network-test').click()
  expect(openTest).toHaveBeenCalledOnce()
  expect(openTest).toHaveBeenCalledWith()
  expect(system.permissions.request).not.toHaveBeenCalled()
  expect(system.privacy.set).not.toHaveBeenCalled()
})

it('replaces the conflict error after a successful retry and can select the browser default to release control (T2)', async () => {
  const { system, client, element } = mount()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  system.levelOfControl = 'controlled_by_other_extensions'
  element<HTMLButtonElement>('network-apply').click()
  await vi.waitFor(() => expect(element('network-message').dataset.state).toBe('error'))
  system.levelOfControl = 'controllable_by_this_extension'
  element<HTMLButtonElement>('network-apply').click()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('防护已生效'))
  expect(element('network-message').dataset.state).toBe('ready')
  expect(element('network-message').textContent).not.toContain('其他扩展')
  element<HTMLSelectElement>('network-policy').value = 'default'
  element<HTMLButtonElement>('network-apply').click()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('防护未开启'))
  expect(await client.status()).toMatchObject({ ok: true, value: { settings: { enabled: false }, protected: false, scriptsActive: false } })
  expect(element('network-message').textContent).toContain('已释放')
})

it('does not resume an operation or read background state after the panel is destroyed (T2)', async () => {
  const { system, transport, root, view, element } = mount()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  let decide!: (_allowed: boolean) => void
  const permission = new Promise<boolean>(resolve => decide = resolve)
  system.permissions.request.mockImplementationOnce(() => permission)
  element<HTMLButtonElement>('network-apply').click()
  expect(root.getAttribute('aria-busy')).toBe('true')
  expect(element<HTMLButtonElement>('network-disable').disabled).toBe(true)
  const sentBeforeDestroy = transport.sendMessage.mock.calls.length
  view.destroy()
  decide(true)
  await view.refresh()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(transport.sendMessage).toHaveBeenCalledTimes(sentBeforeDestroy)
  expect(system.privacy.set).not.toHaveBeenCalled()
  expect(root.children).toHaveLength(0)
})

it.each(['privacy-clear', 'script-unregister'] as const)('shows incomplete shutdown after %s fails and lets the user retry release (T2)', async (failure) => {
  const { system, element } = mount()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('未授权'))
  element<HTMLButtonElement>('network-apply').click()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('防护已生效'))
  if (failure === 'privacy-clear')
    system.privacy.clear.mockRejectedValueOnce(new Error('native clear failure'))
  else
    system.scripting.unregisterContentScripts.mockRejectedValueOnce(new Error('native unregister failure'))
  element<HTMLButtonElement>('network-disable').click()
  await vi.waitFor(() => expect(element('network-message').dataset.state).toBe('error'))
  element<HTMLButtonElement>('network-refresh').click()
  await vi.waitFor(() => expect(element('network-status').textContent).toContain('关闭尚未完成'))
  expect(element('network-status').textContent).toContain('重试释放')
  expect(element('network-status').textContent).not.toContain('防护未开启')
  expect(element('network-message').textContent).not.toContain('已释放')
  element<HTMLButtonElement>('network-disable').click()
  await vi.waitFor(() => expect(element('network-message').textContent).toContain('已释放'))
  expect(element('network-status').textContent).toContain('防护未开启')
})
