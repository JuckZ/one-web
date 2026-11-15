import type { DubbingConfig, ServiceConfig } from './provider'
import { isRecord } from './contracts'

export const CONFIG_KEY = 'oneweb.video-dubbing.config.v1'

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  return parts.length === 4
    && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    && (parts[0] === 10
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168))
}

export function serviceBase(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048)
    throw new Error('服务地址无效')
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('服务地址无效')
  }
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:'
      && (['localhost', '127.0.0.1'].includes(url.hostname) || privateIpv4(url.hostname))))
      || url.username
      || url.password
      || url.hash
      || url.search
  ) {
    throw new Error('服务只支持 HTTPS、本机或私有局域网 IPv4 HTTP；地址不能含凭据、查询或片段')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url.href
}
export function serviceOrigins(config: DubbingConfig): string[] {
  return [...new Set([config.translation, config.speech].map(service => `${new URL(service.baseUrl).origin}/*`))]
}
export function validateConfig(value: unknown, previous: DubbingConfig | null = null): DubbingConfig {
  if (!isRecord(value))
    throw new Error('服务配置无效')
  const read = (candidate: unknown, old?: ServiceConfig): ServiceConfig => {
    if (!isRecord(candidate))
      throw new Error('缺少服务配置')
    const baseUrl = serviceBase(candidate.baseUrl)
    const model = candidate.model
    const key = candidate.key === '' && old?.baseUrl === baseUrl ? old.key : candidate.key
    if (
      typeof model !== 'string'
      || !model.trim()
      || model.length > 128
      || typeof key !== 'string'
      || !key.trim()
      || key.length > 4096
      || /[\r\n]/.test(key)
    ) {
      throw new Error('请填写模型和 API key（留空仅保留同一地址已有 key）')
    }
    return { baseUrl, model: model.trim(), key }
  }
  const translation = read(value.translation, previous?.translation)
  const speech = read(value.speech, previous?.speech)
  const voice = isRecord(value.speech) ? value.speech.voice : null
  if (typeof voice !== 'string' || !voice.trim() || voice.length > 128)
    throw new Error('请填写声音')
  return { translation, speech: { ...speech, voice: voice.trim() } }
}
export function redactConfig(config: DubbingConfig | null) {
  if (!config)
    return null
  const publicService = (service: ServiceConfig) => ({
    baseUrl: service.baseUrl,
    model: service.model,
    keyConfigured: !!service.key,
  })
  return {
    translation: publicService(config.translation),
    speech: { ...publicService(config.speech), voice: config.speech.voice },
  }
}
