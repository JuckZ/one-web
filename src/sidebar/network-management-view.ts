import type { NetworkSettings, NetworkStatus, WebRtcPolicy } from '~/modules/builtin/network-management/contracts'
import {
  DEFAULT_NETWORK_SETTINGS,
  hasNetworkPageOptions,
  NETWORK_HOST_PERMISSIONS,
} from '~/modules/builtin/network-management/contracts'
import type { NetworkManagementClient } from '~/modules/builtin/network-management/protocol'
import './network-management.css'

export interface NetworkManagementViewOptions {
  client: NetworkManagementClient
  permissions: { request: (_details: { permissions: ['privacy'], origins?: string[] }) => Promise<boolean> }
  openTest?: () => Promise<unknown>
  firefox?: boolean
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
  const element = document.createElement(tag)
  element.textContent = text
  return element
}

const policyLabels: Record<WebRtcPolicy, string> = {
  default: '浏览器默认（关闭防护）',
  default_public_and_private_interfaces: '默认公网与私网接口',
  default_public_interface_only: '仅默认公网接口',
  disable_non_proxied_udp: '禁用不经代理的 UDP',
}

function failureMessage(reason: string) {
  const messages: Record<string, string> = {
    'control-conflict': '其他扩展或浏览器策略正在控制 WebRTC 设置，请检查控制权后手动重试。',
    'module-disabled': '请先启用网络管理模块。',
    'permission-required': 'WebRTC 隐私权限已失效，请重新授权并应用。',
    'host-permission-required': '页面保护的站点权限已失效，请重新授权并应用。',
    'unsupported': '当前浏览器不支持所需的 WebRTC 隐私或页面保护能力。',
    'invalid-input': 'WebRTC 设置无效，请重新选择后应用。',
    'transport-error': '后台暂时不可用，请手动刷新后重试。',
    'invalid-response': '后台响应无效，请手动刷新后重试。',
    'lifecycle-cancelled': '操作期间模块或权限发生变化，请刷新检查。',
  }
  return messages[reason] || '操作未完成，请刷新检查网络状态。'
}

export class NetworkManagementView {
  private readonly policy = node('select')
  private readonly checks = new Map<'blockSupport' | 'blockDevices' | 'blockAdditional', HTMLInputElement>()
  private readonly statusLine = node('p')
  private readonly feedback = node('p')
  private destroyed = false
  private busy = false

  constructor(readonly root: HTMLElement, private readonly _options: NetworkManagementViewOptions) {
    root.classList.add('network-management')
    root.dataset.testid = 'network-management'
    root.setAttribute('aria-busy', 'false')
    this.policy.dataset.testid = 'network-policy'
    this.policy.setAttribute('aria-label', 'WebRTC IP 处理策略')
    for (const [value, label] of Object.entries(policyLabels)) {
      const option = node('option', label)
      option.value = value
      this.policy.append(option)
    }
    const policyLabel = node('label', 'WebRTC IP 处理策略')
    policyLabel.className = 'network-policy-label'
    policyLabel.append(this.policy)
    root.append(node('h3', 'WebRTC 防护'))
    if (this._options.firefox) {
      const scope = node('p', 'Firefox 的 WebRTC IP 策略同时作用于普通窗口和隐私窗口。页面屏蔽仅作用于允许 OneWeb 运行的窗口。')
      scope.id = `network-scope-${crypto.randomUUID()}`
      scope.dataset.testid = 'network-scope'
      this.policy.setAttribute('aria-describedby', scope.id)
      root.append(scope)
    }
    root.append(policyLabel)
    for (const [key, suffix, label] of [
      ['blockSupport', 'support', '隐藏 WebRTC 支持检测'],
      ['blockDevices', 'devices', '阻止摄像头与麦克风设备访问'],
      ['blockAdditional', 'additional', '隐藏其他 RTC 对象'],
    ] as const) {
      const wrapper = node('label')
      wrapper.className = 'network-option'
      const input = node('input')
      input.type = 'checkbox'
      input.dataset.testid = `network-block-${suffix}`
      wrapper.append(input, node('span', label))
      this.checks.set(key, input)
      root.append(wrapper)
    }
    this.statusLine.dataset.testid = 'network-status'
    this.statusLine.setAttribute('role', 'status')
    this.feedback.dataset.testid = 'network-message'
    this.feedback.setAttribute('role', 'status')
    const actions = node('div')
    actions.className = 'network-actions'
    this.button(actions, 'apply', '授权并应用', () => this.apply())
    this.button(actions, 'disable', '关闭并释放控制', () => this.disable())
    this.button(actions, 'refresh', '刷新防护状态', () => this.refresh())
    this.button(actions, 'test', 'WebRTC 泄漏检测（外部站点）', async () => {
      if (this._options.openTest) {
        await this._options.openTest()
        if (!this.destroyed) {
          this.feedback.textContent = '已打开外部检测页面，请在新标签页查看。'
          this.feedback.dataset.state = 'ready'
        }
      }
      else {
        this.feedback.textContent = '当前环境无法打开检测页面。'
        this.feedback.dataset.state = 'error'
      }
    })
    root.append(
      node('p', '这些选项可能影响网页通话、摄像头、麦克风与实时协作。已有页面需刷新，关闭后也需刷新以恢复页面能力。'),
      actions,
      this.statusLine,
      this.feedback,
    )
    this.showSettings(DEFAULT_NETWORK_SETTINGS)
  }

  private button(parent: HTMLElement, action: string, label: string, task: () => Promise<unknown>) {
    const button = node('button', label)
    button.type = 'button'
    button.className = 'secondary-button'
    button.dataset.testid = `network-${action}`
    const description = this.policy.getAttribute('aria-describedby')
    if (action === 'apply' && description)
      button.setAttribute('aria-describedby', description)
    button.addEventListener('click', () => {
      if (this.busy || this.destroyed)
        return
      this.setBusy(true)
      // Invoke immediately to retain the click's activation for permissions.request.
      void task().catch(() => {
        if (!this.destroyed) {
          this.feedback.textContent = '操作未完成，请刷新检查网络状态。'
          this.feedback.dataset.state = 'error'
        }
      }).finally(() => this.setBusy(false))
    })
    parent.append(button)
  }

  private setBusy(busy: boolean) {
    if (this.destroyed)
      return
    this.busy = busy
    this.root.setAttribute('aria-busy', String(busy))
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button'))
      control.disabled = busy
  }

  private async apply() {
    const settings: NetworkSettings = {
      enabled: true,
      policy: this.policy.value as WebRtcPolicy,
      blockSupport: this.checks.get('blockSupport')!.checked,
      blockDevices: this.checks.get('blockDevices')!.checked,
      blockAdditional: this.checks.get('blockAdditional')!.checked,
    }
    const granted = await this._options.permissions.request({
      permissions: ['privacy'],
      ...(settings.policy !== 'default' && hasNetworkPageOptions(settings) ? { origins: [...NETWORK_HOST_PERMISSIONS] } : {}),
    })
    if (this.destroyed)
      return
    if (!granted) {
      this.feedback.textContent = '未获得授权，WebRTC 防护未应用。'
      this.feedback.dataset.state = 'error'
      return
    }
    const result = await this._options.client.apply(settings)
    if (this.destroyed)
      return
    if (result.ok) {
      this.showStatus(result.value)
      this.feedback.textContent = !result.value.settings.enabled
        ? '防护已关闭；已释放本插件的控制，已有页面需刷新。'
        : result.value.protected
          ? '设置已应用；已有页面需刷新。'
          : '设置已保存；请根据实际状态确认防护，已有页面需刷新。'
      this.feedback.dataset.state = 'ready'
    }
    else {
      const current = await this._options.client.status()
      if (this.destroyed)
        return
      if (current.ok)
        this.showStatus(current.value, false)
      this.feedback.textContent = failureMessage(result.reason)
      this.feedback.dataset.state = 'error'
    }
  }

  private async disable() {
    const result = await this._options.client.disable()
    if (this.destroyed)
      return
    if (result.ok) {
      this.showStatus(result.value)
      this.feedback.textContent = '防护已关闭；已释放本插件的控制，已有页面需刷新。'
      this.feedback.dataset.state = 'ready'
    }
    else {
      this.feedback.textContent = failureMessage(result.reason)
      this.feedback.dataset.state = 'error'
    }
  }

  private showSettings(settings: Readonly<NetworkSettings>) {
    this.policy.value = settings.policy
    for (const [key, input] of this.checks)
      input.checked = settings[key]
  }

  private showStatus(status: NetworkStatus, updateSettings = true) {
    if (updateSettings)
      this.showSettings(status.settings)
    const controls: Record<string, string> = {
      controlled_by_this_extension: '本插件控制',
      controllable_by_this_extension: '本插件可控制',
      controlled_by_other_extensions: '其他扩展控制',
      not_controllable: '浏览器策略控制，无法修改',
    }
    const shutdownIncomplete = !status.settings.enabled
      && (status.levelOfControl === 'controlled_by_this_extension' || status.scriptsActive)
    const state = shutdownIncomplete
      ? 'WebRTC 防护关闭尚未完成，仍有本插件控制或页面保护，请重试释放'
      : !status.privacyPermission
          ? 'WebRTC 隐私权限未授权'
          : status.protected
            ? 'WebRTC 防护已生效'
            : status.settings.enabled ? 'WebRTC 防护尚未完全生效' : 'WebRTC 防护未开启'
    const actual = status.actualPolicy ? policyLabels[status.actualPolicy] : '未知'
    const control = status.levelOfControl ? controls[status.levelOfControl] || '控制权未知' : '未授权或不可用'
    this.statusLine.textContent = `${state}。实际策略：${actual}。控制权：${control}。页面保护：${status.scriptsActive ? '已注册（新页面生效）' : '未注册'}。`
    this.statusLine.dataset.state = status.protected ? 'protected' : 'inactive'
  }

  async refresh() {
    if (this.destroyed)
      return
    const result = await this._options.client.status()
    if (this.destroyed)
      return
    if (result.ok) {
      this.showStatus(result.value)
      this.feedback.textContent = '已刷新 WebRTC 防护状态。'
      this.feedback.dataset.state = 'ready'
    }
    else {
      this.feedback.textContent = failureMessage(result.reason)
      this.feedback.dataset.state = 'error'
    }
  }

  destroy() {
    this.destroyed = true
    this.root.replaceChildren()
  }
}
