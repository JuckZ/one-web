import type { PageSession, PageTab } from './page-context'
import { PAGE_CHANNEL } from '~/assistantContent/runtime'
import { isRecord } from '~/modules/builtin/assistant/contracts'

export interface PageScripting {
  executeScript: (_details: { target: { tabId: number, frameIds: number[] }, files?: string[], func?: () => unknown }) => Promise<Array<{ documentId?: string }>>
}
export function createPageContextInjection(scripting: PageScripting, tabs: {
  sendMessage: (_id: number, _message: unknown, _options: { frameId: number, documentId?: string }) => Promise<unknown>
}) {
  const sessions = new Map<number, PageSession>()
  const createSession = (tabId: number, documentId?: string): PageSession => ({
    documentId: documentId ?? crypto.randomUUID(),
    request: async (command) => {
      const response = await tabs.sendMessage(tabId, { channel: PAGE_CHANNEL, ...command }, {
        frameId: 0,
        ...(documentId ? { documentId } : {}),
      })
      if (!isRecord(response) || response.ok !== true)
        throw new Error(isRecord(response) && typeof response.error === 'string' ? response.error : '页面连接已断开')
      if (command.command === 'dispose')
        sessions.delete(tabId)
      return response.value
    },
  })
  return {
    async connect(tab: PageTab): Promise<PageSession> {
      if (tab.id === undefined)
        throw new Error('页面已关闭')
      const existing = sessions.get(tab.id)
      if (existing) {
        try {
          await existing.request({ command: 'ping' })
          return existing
        }
        catch { sessions.delete(tab.id) }
      }
      // Recover the document's existing runtime after MV3 worker suspension.
      // A fixed no-op obtains the browser's native identity without reinjecting.
      const [probe] = await scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: () => null })
      if (probe?.documentId) {
        const retained = createSession(tab.id, probe.documentId)
        try {
          await retained.request({ command: 'ping' })
          sessions.set(tab.id, retained)
          return retained
        }
        catch {}
      }
      const [result] = await scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['assistant.js'] })
      const tabId = tab.id
      const session = createSession(tabId, result?.documentId)
      sessions.set(tabId, session)
      return session
    },
  }
}
