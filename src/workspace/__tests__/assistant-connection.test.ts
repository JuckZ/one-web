import type { Runtime } from 'webextension-polyfill'
import { acceptAssistantWorkspace, createAssistantWorkspaceTransport } from '../assistant-connection'

type Port = Pick<Runtime.Port, 'onMessage' | 'onDisconnect' | 'postMessage' | 'disconnect'>

function event<T extends unknown[]>() {
  const listeners: Array<(..._args: T) => unknown> = []
  return {
    addListener: (listener: (..._args: T) => unknown) => listeners.push(listener),
    emit: (...args: T) => listeners.forEach(listener => listener(...args)),
  }
}

function pair() {
  const incoming = [event<[unknown]>(), event<[unknown]>()] as const
  const disconnected = [event<[]>(), event<[]>()] as const
  let live = true
  return ([0, 1] as const).map((end) => {
    return {
      onMessage: incoming[end],
      onDisconnect: disconnected[end],
      postMessage: (data: unknown) => {
        if (!live)
          throw new Error('Closed test port')
        incoming[end ? 0 : 1].emit(structuredClone(data))
      },
      disconnect: () => {
        if (live) {
          live = false
          disconnected.forEach(event => event.emit())
        }
      },
    } as unknown as Port
  })
}

it('assigns separate connections an owner and reconnects without replaying requests', async () => {
  const release = vi.fn()
  const disconnectNotice = vi.fn()
  const dispatch = vi.fn(async (message: unknown, owner: string) => message === 'wait' ? new Promise(() => {}) : owner)
  const servers: Port[] = []
  const connect = () => {
    const [client, server] = pair()
    acceptAssistantWorkspace(server, dispatch, release)
    servers.push(server)
    return client
  }
  const first = createAssistantWorkspaceTransport(connect, disconnectNotice)
  const second = createAssistantWorkspaceTransport(connect, vi.fn())
  const firstOwner = await first.sendMessage('identify')
  const secondOwner = await second.sendMessage('identify')
  expect(firstOwner).not.toBe(secondOwner)
  const outstanding = first.sendMessage('wait')
  const rejected = expect(outstanding).rejects.toThrow('连接已断开')
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith('wait', firstOwner))
  servers[0].disconnect()
  await rejected
  expect(disconnectNotice).toHaveBeenCalledOnce()
  expect(release.mock.calls).toEqual([[firstOwner]])
  expect(await second.sendMessage('identify')).toBe(secondOwner)
  expect(await first.sendMessage('identify')).not.toBe(firstOwner)
  expect(dispatch.mock.calls.filter(([message]) => message === 'wait')).toHaveLength(1)
  first.disconnect()
  second.disconnect()
})
