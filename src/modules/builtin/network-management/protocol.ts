import type { NetworkResult, NetworkSettings } from './contracts'
import type { NetworkManagementController } from './controller'
import { isTrustedModuleManagementSender } from '../../management-protocol'
import { isNetworkSettings, isRecord, isWebRtcPolicy } from './contracts'

const CHANNEL = 'oneweb.network-management'
const VERSION = 1
type NetworkCommand = 'status' | 'apply' | 'disable'

function isStatus(value: unknown) {
  return isRecord(value) && isNetworkSettings(value.settings)
    && (value.actualPolicy === null || isWebRtcPolicy(value.actualPolicy))
    && (value.levelOfControl === null || typeof value.levelOfControl === 'string')
    && ['privacyPermission', 'hostPermission', 'scriptsActive', 'protected'].every(key => typeof value[key] === 'boolean')
}

export function handleNetworkManagementMessage(
  controller: NetworkManagementController,
  message: unknown,
  sender: { id?: string, url?: string },
  extensionId: string,
  baseUrl: string,
) {
  if (!isRecord(message) || message.channel !== CHANNEL || message.version !== VERSION
    || typeof message.type !== 'string' || !['status', 'apply', 'disable'].includes(message.type)
    || !isTrustedModuleManagementSender(sender, extensionId, baseUrl)
    || Object.keys(message).length !== (message.type === 'apply' ? 4 : 3)
    || Object.keys(message).some(key => !['channel', 'version', 'type', ...(message.type === 'apply' ? ['settings'] : [])].includes(key))
    || (message.type === 'apply' && !isNetworkSettings(message.settings))) {
    return undefined
  }
  const operation = message.type === 'apply'
    ? controller.apply(message.settings as NetworkSettings)
    : message.type === 'disable' ? controller.disable() : controller.status()
  return operation.then(
    result => ({ channel: CHANNEL, version: VERSION, type: message.type, result }),
    () => ({ channel: CHANNEL, version: VERSION, type: message.type, result: { ok: false, reason: 'browser-operation-failed' } }),
  )
}

export class NetworkManagementClient {
  constructor(private readonly _transport: { sendMessage: (_message: unknown) => Promise<unknown> }) {}

  private async request(type: NetworkCommand, settings?: NetworkSettings): Promise<NetworkResult> {
    let response: unknown
    try {
      response = await this._transport.sendMessage({ channel: CHANNEL, version: VERSION, type, ...(type === 'apply' ? { settings } : {}) })
    }
    catch {
      return { ok: false, reason: 'transport-error' }
    }
    if (!isRecord(response) || response.channel !== CHANNEL || response.version !== VERSION || response.type !== type || !isRecord(response.result))
      return { ok: false, reason: 'invalid-response' }
    const result = response.result
    if (result.ok === true && isStatus(result.value))
      return result as NetworkResult
    if (result.ok === false && typeof result.reason === 'string' && /^[a-z-]{1,64}$/.test(result.reason))
      return result as NetworkResult
    return { ok: false, reason: 'invalid-response' }
  }

  status() { return this.request('status') }
  apply(settings: NetworkSettings) { return this.request('apply', settings) }
  disable() { return this.request('disable') }
}
