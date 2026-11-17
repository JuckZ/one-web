import type { SmartAppsController } from './controller'
import type { SmartApp, SmartAppInput } from './model'
import { isTrustedModuleManagementSender } from '~/modules/management-protocol'
import { byteLength, isRecord, MAX_SMART_APPS_BYTES, SMART_APPS_CHANNEL } from './model'

const commands = ['list', 'create', 'update', 'set-enabled', 'remove', 'export', 'import'] as const
type Command = typeof commands[number]

export function handleSmartAppsMessage(
  controller: SmartAppsController,
  message: unknown,
  sender: { id?: string, url?: string },
  extensionId: string,
  extensionBase: string,
) {
  if (!isRecord(message) || message.channel !== SMART_APPS_CHANNEL
    || !commands.includes(message.command as Command)
    || Object.keys(message).some(key => !['channel', 'command', 'data'].includes(key))
    || !isRecord(message.data)
    || !isTrustedModuleManagementSender(sender, extensionId, extensionBase)) {
    return undefined
  }
  let size: number
  try {
    size = byteLength(JSON.stringify(message))
  }
  catch { return undefined }
  if (size > MAX_SMART_APPS_BYTES * 2 + 1024)
    return undefined
  const command = message.command as Command
  const data = message.data
  const execute = async () => {
    const fields: Record<Command, string[]> = {
      'list': [],
      'create': ['input'],
      'update': ['id', 'input'],
      'set-enabled': ['id', 'enabled'],
      'remove': ['id'],
      'export': ['ids'],
      'import': ['json'],
    }
    if (Object.keys(data).some(key => !fields[command].includes(key)))
      throw new Error('应用操作包含不支持的字段')
    if (['update', 'set-enabled', 'remove'].includes(command)
      && (typeof data.id !== 'string' || !/^app-[\w-]{1,100}$/.test(data.id))) {
      throw new Error('应用标识无效')
    }
    switch (command) {
      case 'list': return controller.list()
      case 'create': return controller.create(data.input as SmartAppInput)
      case 'update': return controller.update(data.id as string, data.input as SmartAppInput)
      case 'set-enabled': return controller.setEnabled(data.id as string, data.enabled as boolean)
      case 'remove': return controller.remove(data.id as string)
      case 'export': return controller.exportApps(data.ids as string[] | undefined)
      case 'import': return controller.importApps(data.json as string)
    }
  }
  return execute().then(
    value => ({ channel: SMART_APPS_CHANNEL, command, ok: true, value }),
    error => ({ channel: SMART_APPS_CHANNEL, command, ok: false, error: error instanceof Error ? error.message : '应用操作失败' }),
  )
}

export class SmartAppsClient {
  constructor(private readonly _transport: { sendMessage: (_message: unknown) => Promise<unknown> }) {}

  private async request<T>(command: Command, data: object = {}): Promise<T> {
    const response = await this._transport.sendMessage({ channel: SMART_APPS_CHANNEL, command, data })
    if (!isRecord(response) || response.channel !== SMART_APPS_CHANNEL || response.command !== command || typeof response.ok !== 'boolean')
      throw new Error('应用管理连接已断开')
    if (!response.ok)
      throw new Error(typeof response.error === 'string' ? response.error : '应用操作失败')
    return response.value as T
  }

  list() { return this.request<SmartApp[]>('list') }
  create(input: SmartAppInput) { return this.request<SmartApp>('create', { input }) }
  update(id: string, input: SmartAppInput) { return this.request<SmartApp>('update', { id, input }) }
  setEnabled(id: string, enabled: boolean) { return this.request<SmartApp>('set-enabled', { id, enabled }) }
  remove(id: string) { return this.request<void>('remove', { id }) }
  exportApps(ids?: string[]) { return this.request<string>('export', { ids }) }
  importApps(json: string) { return this.request<SmartApp[]>('import', { json }) }
}
