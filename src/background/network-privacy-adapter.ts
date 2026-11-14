import type { NetworkControllerOptions } from '~/modules/builtin/network-management/controller'

interface FirefoxPrivacySetting {
  get: (_details: Record<string, never>) => Promise<{ value: unknown, levelOfControl: string }>
  set: (_details: { value: string, scope: 'regular' }) => Promise<unknown>
  clear: (_details: { scope: 'regular' }) => Promise<unknown>
}

export function createFirefoxNetworkPrivacy(setting?: FirefoxPrivacySetting): NetworkControllerOptions['privacy'] {
  if (!setting)
    return undefined
  return {
    get: details => setting.get(details),
    async set({ value }) {
      await setting.set({ value, scope: 'regular' })
    },
    async clear() {
      await setting.clear({ scope: 'regular' })
    },
  }
}
