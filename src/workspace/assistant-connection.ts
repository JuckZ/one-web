import type { Runtime } from 'webextension-polyfill'
import { isRecord } from '~/modules/builtin/assistant/contracts'

type WorkspacePort = Pick<Runtime.Port, 'onMessage' | 'onDisconnect' | 'postMessage' | 'disconnect'>

export function acceptAssistantWorkspace(
  port: WorkspacePort,
  dispatch: (_message: unknown, _owner: string) => Promise<unknown> | undefined,
  release: (_owner: string) => void,
) {
  const owner = `assistant-workspace:${crypto.randomUUID()}`
  let connected = true
  port.onDisconnect.addListener(() => {
    connected = false
    release(owner)
  })
  port.onMessage.addListener((request: unknown) => {
    if (!connected || !isRecord(request) || !Number.isSafeInteger(request.id))
      return
    const reply = (value: unknown) => {
      if (connected)
        port.postMessage({ id: request.id, value: value ?? null })
    }
    void Promise.resolve().then(() => connected ? dispatch(request.message, owner) : undefined).then(reply, () => reply(null)).catch(() => {})
  })
}

export function createAssistantWorkspaceTransport(connect: () => WorkspacePort, onDisconnect: () => void) {
  interface Pending { resolve: (_value: unknown) => void, reject: (_error: Error) => void }
  let sequence = 0
  let port: WorkspacePort | undefined
  let closed = false
  const pending = new Map<number, Pending>()
  const reset = (connection: WorkspacePort) => {
    if (port !== connection)
      return
    port = undefined
    for (const request of pending.values()) request.reject(new Error('助手连接已断开，请重试'))
    pending.clear()
    if (!closed)
      onDisconnect()
  }
  const open = () => {
    const connection = connect()
    port = connection
    connection.onMessage.addListener((response: unknown) => {
      if (port !== connection || !isRecord(response) || typeof response.id !== 'number')
        return
      const request = pending.get(response.id)
      pending.delete(response.id)
      request?.resolve(response.value)
    })
    connection.onDisconnect.addListener(() => reset(connection))
    return connection
  }
  return {
    async sendMessage(message: unknown) {
      if (closed)
        throw new Error('助手工作区已关闭')
      const connection = port ?? open()
      const id = ++sequence
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try {
          connection.postMessage({ id, message })
        }
        catch {
          reset(connection)
          connection.disconnect()
        }
      })
    },
    disconnect() {
      closed = true
      const connection = port
      if (connection) {
        reset(connection)
        connection.disconnect()
      }
    },
  }
}
