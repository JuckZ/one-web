import type { ProviderConfiguration } from './contracts'
import { ASSISTANT_LIMIT, byteLength, isRecord } from './contracts'

export async function completeChat(
  config: ProviderConfiguration,
  messages: Array<{ role: string, content: string }>,
  signal: AbortSignal,
  onText: (_text: string) => void,
  request: typeof fetch = fetch,
) {
  const body = JSON.stringify({ model: config.models[0], stream: true, messages })
  if (byteLength(body) > 262144)
    throw new Error('模型请求超过 256 KiB，请减少对话或附件')
  const response = await request(new URL('chat/completions', config.baseUrl), {
    method: 'POST',
    redirect: 'error',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.key}` },
    signal,
    body,
  })
  if (!response.ok)
    throw new Error(`模型服务返回 HTTP ${response.status}`)
  if (!response.body)
    throw new Error('模型返回空响应')
  const sse = response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let buffer = ''
  let data: string[] = []
  let done = false
  let text = ''
  const add = (value: unknown) => {
    if (typeof value !== 'string')
      throw new Error('模型响应格式无效')
    text += value
    onText(value)
  }
  const dispatch = (): boolean => {
    if (!data.length)
      return false
    const payload = data.join('\n')
    data = []
    if (payload.trim() === '[DONE]') {
      return true
    }
    let event: unknown
    try {
      event = JSON.parse(payload)
    }
    catch { throw new Error('模型流数据无效') }
    if (!isRecord(event) || event.error || !Array.isArray(event.choices))
      throw new Error('模型流数据无效')
    if (!event.choices.length)
      return false
    const first = event.choices[0]
    if (!isRecord(first) || !isRecord(first.delta))
      throw new Error('模型流数据无效')
    if (first.delta.content !== undefined && first.delta.content !== null)
      add(first.delta.content)
    return false
  }
  try {
    while (!done) {
      signal.throwIfAborted()
      const part = await reader.read()
      signal.throwIfAborted()
      if (part.done) {
        buffer += decoder.decode()
        break
      }
      bytes += part.value.byteLength
      if (bytes > ASSISTANT_LIMIT)
        throw new Error('模型响应超过 2 MiB')
      buffer += decoder.decode(part.value, { stream: true })
      if (!sse)
        continue
      while (!done) {
        const newline = buffer.indexOf('\n')
        if (newline < 0)
          break
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (!line)
          done = dispatch()
        else if (line.startsWith('data:'))
          data.push(line.slice(5).replace(/^ /, ''))
        else if (line.startsWith('event:') && line.slice(6).trim() === 'error')
          throw new Error('模型流返回错误')
      }
    }
    if (sse) {
      if (!done)
        throw new Error('模型连接中断，回答未完成')
    }
    else {
      let result
      try {
        result = JSON.parse(buffer)
      }
      catch { throw new Error('模型响应格式无效') }
      add(result?.choices?.[0]?.message?.content)
    }
    if (!text.trim())
      throw new Error('模型返回空回答')
    return text
  }
  finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
