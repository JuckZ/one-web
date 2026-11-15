import type { AssistantAttachment, AssistantPrompt, Conversation, ProviderConfiguration, PublicProvider, StartInput } from './contracts'
import type { AssistantController } from './controller'
import { isTrustedModuleManagementSender } from '~/modules/management-protocol'
import { ASSISTANT_CHANNEL, byteLength, isRecord } from './contracts'

const commands = [
  'configure',
  'configuration',
  'start',
  'open',
  'cancel',
  'close',
  'list',
  'favorite',
  'delete',
  'import',
  'prompt-save',
  'prompts',
  'prompt-delete',
  'prompt-order',
  'history-enabled',
  'preferences',
  'clear',
] as const
type Command = typeof commands[number]
export function handleAssistantMessage(
  controller: AssistantController,
  message: unknown,
  sender: { id?: string, url?: string, documentId?: string },
  extensionId: string,
  extensionBase: string,
) {
  if (!isRecord(message) || message.channel !== ASSISTANT_CHANNEL
    || !commands.includes(message.command as Command)
    || Object.keys(message).some(key => !['channel', 'command', 'data'].includes(key))
    || byteLength(JSON.stringify(message)) > 262144
    || !isRecord(message.data)
    || !isTrustedModuleManagementSender(sender, extensionId, extensionBase)) {
    return undefined
  }
  const command = message.command as Command
  const data = message.data
  const owner = sender.documentId ?? sender.url!
  const execute = async () => {
    if (command === 'prompts')
      return controller.listPrompts()
    if (command === 'prompt-delete')
      return controller.deletePrompt(data.id as string)
    if (command === 'prompt-order')
      return controller.reorderPrompts(data.ids as string[])
    if (command === 'history-enabled')
      return controller.setHistoryEnabled(data.enabled as boolean)
    if (command === 'preferences')
      return controller.preferences()
    if (command === 'clear')
      return controller.clearConversations()
    if (command === 'import')
      return controller.importText(data as unknown as { name: string, text: string }, owner)
    if (command === 'prompt-save')
      return controller.savePrompt(data as unknown as { id?: string, title: string, template: string })
    if (command === 'list')
      return controller.listConversations(data.query as string)
    if (command === 'favorite')
      return controller.setFavorite(data.messageId as string, data.favorite as boolean)
    if (command === 'delete')
      return controller.deleteConversation(data.id as string)
    if (command === 'close') {
      controller.cancelOwner(owner)
      return null
    }
    if (command === 'cancel') {
      if (typeof data.requestId !== 'string')
        throw new Error('请求标识无效')
      return controller.cancel(data.requestId, owner)
    }
    if (command === 'configure')
      return controller.configureProvider(data)
    if (command === 'configuration')
      return controller.readConfiguration()
    if (command === 'start')
      return controller.start(data as unknown as StartInput, owner)
    if (typeof data.id !== 'string')
      throw new Error('对话标识无效')
    return controller.openConversation(data.id)
  }
  return execute().then(
    value => ({ channel: ASSISTANT_CHANNEL, command, ok: true, value }),
    error => ({ channel: ASSISTANT_CHANNEL, command, ok: false, error: error instanceof Error ? error.message : '助手操作失败' }),
  )
}

export class AssistantClient {
  constructor(private readonly _transport: { sendMessage: (_message: unknown) => Promise<unknown> }) {}

  async request<T>(command: Command, data: object = {}): Promise<T> {
    const result = await this._transport.sendMessage({ channel: ASSISTANT_CHANNEL, command, data })
    if (!isRecord(result) || result.channel !== ASSISTANT_CHANNEL || result.command !== command || typeof result.ok !== 'boolean')
      throw new Error('助手连接已断开')
    if (!result.ok)
      throw new Error(typeof result.error === 'string' ? result.error : '助手操作失败')
    return result.value as T
  }

  configureProvider(input: ProviderConfiguration) { return this.request<PublicProvider>('configure', input) }
  readConfiguration() { return this.request<PublicProvider | null>('configuration') }
  start(input: StartInput) { return this.request<{ requestId: string, conversationId: string }>('start', input) }
  openConversation(id: string) { return this.request<Conversation>('open', { id }) }
  cancel(requestId: string) { return this.request<null>('cancel', { requestId }) }
  close() { return this.request<null>('close') }
  listConversations(query = '') { return this.request<Conversation[]>('list', { query }) }
  setFavorite(messageId: string, favorite: boolean) { return this.request<null>('favorite', { messageId, favorite }) }
  deleteConversation(id: string) { return this.request<null>('delete', { id }) }
  importText(input: { name: string, text: string }) { return this.request<AssistantAttachment>('import', input) }
  savePrompt(input: { id?: string, title: string, template: string }) { return this.request<AssistantPrompt>('prompt-save', input) }
  listPrompts() { return this.request<AssistantPrompt[]>('prompts') }
  deletePrompt(id: string) { return this.request<null>('prompt-delete', { id }) }
  reorderPrompts(ids: string[]) { return this.request<null>('prompt-order', { ids }) }
  setHistoryEnabled(enabled: boolean) { return this.request<null>('history-enabled', { enabled }) }
  preferences() { return this.request<{ historyEnabled: boolean }>('preferences') }
  clearConversations() { return this.request<null>('clear') }
}
