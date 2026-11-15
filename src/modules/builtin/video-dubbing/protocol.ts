import type { DubbingCommand, DubbingStatus } from './contracts'
import type { VideoDubbingController } from './controller'
import { isTrustedModuleManagementSender } from '../../management-protocol'
import { isRecord } from './contracts'

const CHANNEL = 'oneweb.video-dubbing.management.v1'
const commands: DubbingCommand[] = [
  'status',
  'save',
  'delete',
  'prepare-site',
  'open',
  'start',
  'stop',
  'pause',
  'resume',
  'volumes',
  'revoke',
]

export function handleDubbingMessage(
  controller: VideoDubbingController,
  message: unknown,
  sender: { id?: string, url?: string },
  extensionId: string,
  extensionBase: string,
) {
  if (
    !isRecord(message)
    || message.channel !== CHANNEL
    || !commands.includes(message.command as DubbingCommand)
    || !isTrustedModuleManagementSender(sender, extensionId, extensionBase)
    || Object.keys(message).some(key => !['channel', 'command', 'data'].includes(key))
    || JSON.stringify(message).length > 2200000
  ) {
    return undefined
  }
  return controller.handle(message.command as DubbingCommand, message.data).then(
    value => ({ channel: CHANNEL, command: message.command, ok: true, value }),
    error => ({
      channel: CHANNEL,
      command: message.command,
      ok: false,
      error: error instanceof Error ? error.message : '配音操作失败',
    }),
  )
}
export class DubbingClient {
  constructor(private readonly _transport: { sendMessage: (_message: unknown) => Promise<unknown> }) {}
  async request(command: DubbingCommand, data: unknown = {}): Promise<DubbingStatus> {
    const result: unknown = await this._transport.sendMessage({ channel: CHANNEL, command, data })
    if (!isRecord(result) || result.channel !== CHANNEL || result.command !== command || typeof result.ok !== 'boolean')
      throw new Error('配音连接已断开')
    if (!result.ok)
      throw new Error(typeof result.error === 'string' ? result.error : '配音操作失败')
    if (!isRecord(result.value) || !('configuration' in result.value) || !('site' in result.value))
      throw new Error('无效配音响应')
    return result.value as unknown as DubbingStatus
  }
}
