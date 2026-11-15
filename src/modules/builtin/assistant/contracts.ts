export const ASSISTANT_CHANNEL = 'oneweb.assistant.v1'
export const ASSISTANT_PORT = 'oneweb.assistant.workspace.v1'
export const ASSISTANT_LIMIT = 2 * 1024 * 1024
export const ASSISTANT_STORAGE_KEY = 'oneweb.assistant.v1'
export const ASSISTANT_SECRET_KEY = 'oneweb.assistant.secret.v1'

export type AssistantIntent = 'chat' | 'summarize' | 'translate' | 'explain' | 'rewrite' | 'writing'
export type MessageStatus = 'preparing' | 'streaming' | 'completed' | 'cancelled' | 'failed'
export interface ProviderConfiguration {
  baseUrl: string
  models: string[]
  key: string
  remember: boolean
}
export type PublicProvider = Omit<ProviderConfiguration, 'key'> & { keyConfigured: boolean }
export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  status: MessageStatus
  favorite: boolean
  error?: string
  modelId?: string
  intent?: AssistantIntent
  attachmentToken?: string
}
export interface AssistantAttachment {
  token: string
  title: string
  url: string
  text: string
  type: 'page' | 'selection' | 'file'
  truncated: boolean
  capturedAt: number
  tabId?: number
  documentId?: string
  extraction?: 'article' | 'visible-text'
}
export interface Conversation {
  id: string
  title: string
  updatedAt: number
  messages: AssistantMessage[]
  attachment?: AssistantAttachment
}
export interface StartInput {
  conversationId?: string
  intent: AssistantIntent
  text: string
  modelId: string
  language?: string
  promptId?: string
  attachmentToken?: string | null
}
export interface AssistantPrompt {
  id: string
  title: string
  template: string
}
export interface AssistantStorage {
  get: (_key: string) => Promise<Record<string, unknown>>
  set: (_items: Record<string, unknown>) => Promise<void>
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}
