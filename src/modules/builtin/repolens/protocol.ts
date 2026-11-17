import type { RepoLensConfiguration, RepoLensResult } from './contracts'
import type { RepoLensController } from './controller'
import { isTrustedModuleManagementSender } from '../../management-protocol'
import { bytes, isRecord, REPOLENS_CHANNEL } from './contracts'

const commands = ['configuration', 'configure', 'analyze', 'cancel', 'clear'] as const
type Command = typeof commands[number]

export function handleRepoLensMessage(
  controller: RepoLensController,
  message: unknown,
  sender: { id?: string, url?: string, documentId?: string },
  extensionId: string,
  extensionBase: string,
) {
  if (!isRecord(message) || message.channel !== REPOLENS_CHANNEL || !commands.includes(message.command as Command)
    || !isRecord(message.data) || bytes(JSON.stringify(message)) > 8192
    || Object.keys(message).some(key => !['channel', 'command', 'data'].includes(key))
    || !isTrustedModuleManagementSender(sender, extensionId, extensionBase)) {
    return undefined
  }
  const command = message.command as Command
  const data = message.data
  const owner = sender.documentId ?? sender.url!
  const execute = async () => {
    if (command === 'configuration')
      return controller.configuration()
    if (command === 'configure')
      return controller.configure(data)
    if (command === 'analyze') {
      if (Object.keys(data).some(key => key !== 'repo'))
        throw new Error('分析请求无效')
      return controller.analyze(data.repo, owner)
    }
    if (command === 'clear')
      return controller.clear()
    controller.cancelOwner(owner)
    return null
  }
  return execute().then(
    value => ({ channel: REPOLENS_CHANNEL, command, ok: true, value }),
    error => ({ channel: REPOLENS_CHANNEL, command, ok: false, error: error instanceof Error ? error.message : 'RepoLens 操作失败' }),
  )
}

export class RepoLensClient {
  constructor(private readonly _transport: { sendMessage: (_message: unknown) => Promise<unknown> }) {}
  async request<T>(command: Command, data: object = {}): Promise<T> {
    const response = await this._transport.sendMessage({ channel: REPOLENS_CHANNEL, command, data })
    if (!isRecord(response) || response.channel !== REPOLENS_CHANNEL || response.command !== command || typeof response.ok !== 'boolean')
      throw new Error('RepoLens 连接已中断，请重新打开应用')
    if (!response.ok)
      throw new Error(typeof response.error === 'string' ? response.error : 'RepoLens 操作失败')
    return response.value as T
  }

  configuration() { return this.request<RepoLensConfiguration>('configuration') }
  configure(input: { token: string, remember: boolean }) { return this.request<RepoLensConfiguration>('configure', input) }
  analyze(repo: string) { return this.request<RepoLensResult>('analyze', { repo }) }
  cancel() { return this.request<null>('cancel') }
  clear() { return this.request<null>('clear') }
}
