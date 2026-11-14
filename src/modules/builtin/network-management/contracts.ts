export const WEB_RTC_POLICIES = [
  'default',
  'default_public_and_private_interfaces',
  'default_public_interface_only',
  'disable_non_proxied_udp',
] as const
export type WebRtcPolicy = typeof WEB_RTC_POLICIES[number]
export interface NetworkSettings {
  enabled: boolean
  policy: WebRtcPolicy
  blockSupport: boolean
  blockDevices: boolean
  blockAdditional: boolean
}
export const DEFAULT_NETWORK_SETTINGS: Readonly<NetworkSettings> = {
  enabled: false,
  policy: 'disable_non_proxied_udp',
  blockSupport: true,
  blockDevices: false,
  blockAdditional: false,
}
export interface NetworkStatus {
  settings: NetworkSettings
  actualPolicy: WebRtcPolicy | null
  levelOfControl: string | null
  privacyPermission: boolean
  hostPermission: boolean
  scriptsActive: boolean
  protected: boolean
}
export type NetworkResult = { ok: true, value: NetworkStatus } | { ok: false, reason: string }
export const NETWORK_SETTINGS_STORAGE_KEY = 'oneweb.network-management.v1'
export const NETWORK_HOST_PERMISSIONS = ['http://*/*', 'https://*/*']
export const NETWORK_SCRIPT_IDS = ['oneweb-network-support', 'oneweb-network-devices', 'oneweb-network-additional']

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function isWebRtcPolicy(value: unknown): value is WebRtcPolicy {
  return typeof value === 'string' && WEB_RTC_POLICIES.includes(value as WebRtcPolicy)
}
export function isNetworkSettings(value: unknown): value is NetworkSettings {
  return isRecord(value) && Object.keys(value).length === 5
    && typeof value.enabled === 'boolean' && isWebRtcPolicy(value.policy)
    && typeof value.blockSupport === 'boolean' && typeof value.blockDevices === 'boolean'
    && typeof value.blockAdditional === 'boolean'
}
export function hasNetworkPageOptions(settings: NetworkSettings) {
  return settings.blockSupport || settings.blockDevices || settings.blockAdditional
}
