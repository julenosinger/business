import { useSyncExternalStore } from 'react'
import { today } from './format'
import { t } from './i18n'
import type { ChatTransport } from './chat-client'

export type ChatRole = 'user' | 'assistant' | 'system'

export type ChatStatus = 'responding' | 'done' | 'error' | 'unavailable'

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  at: string
  /** Presente em mensagens de assistente: indica processamento, conclusão ou falha. */
  status?: ChatStatus
}

export interface Conversation {
  id: string
  title: string
  createdAt: string
  messages: ChatMessage[]
}

const KEY = 'gbos:chat'
const listeners = new Set<() => void>()

function read(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (c): c is Conversation =>
        typeof c === 'object' && c !== null && typeof (c as Conversation).id === 'string' && Array.isArray((c as Conversation).messages),
    )
  } catch {
    return []
  }
}

interface ChatState {
  conversations: Conversation[]
  activeId: string | null
}

let state: ChatState = { conversations: read(), activeId: null }

function commit(conversations: Conversation[], activeId: string | null): void {
  state = { conversations, activeId }
  try {
    localStorage.setItem(KEY, JSON.stringify(conversations))
  } catch {
    // histórico local: falha de armazenamento não deve quebrar o chat
  }
  listeners.forEach((l) => l())
}

const newId = (): string => crypto.randomUUID().slice(0, 12)

/**
 * Transporte de IA configurável em runtime. `null` = indisponível (o app exibe instrução, sem simular).
 * O token NUNCA é persistido; a configuração vive em memória.
 */
let transport: ChatTransport | null = null

export function configureChatTransport(t: ChatTransport | null): void {
  transport = t
}

export function chatTransportConfigured(): boolean {
  return transport !== null
}

/** Requisição em voo (para prevenir respostas obsoletas e envio duplicado). */
interface InFlight {
  conversationId: string
  messageId: string
  abort: AbortController
}

let inFlight: InFlight | null = null

function updateMessage(conversationId: string, messageId: string, patch: Partial<ChatMessage>): void {
  const next = state.conversations.map((c) =>
    c.id === conversationId ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) } : c,
  )
  commit(next, state.activeId)
}

function unavailableText(): string {
  return t(
    'O assistente de IA não está configurado. Para habilitar respostas reais, configure o backend de IA (provedor e chave) no servidor e o endpoint no aplicativo.',
    'The AI assistant is not configured. To enable real responses, configure the AI backend (provider and key) on the server and the endpoint in the app.',
  )
}

function errorText(): string {
  return t('Não foi possível obter uma resposta agora. Tente novamente em instantes.', 'Could not get a response right now. Try again shortly.')
}

/** Anexa a mensagem do usuário e dispara a resposta da IA (assíncrona, com proteção contra envio duplicado). */
function send(text: string, context: unknown): void {
  const trimmed = text.trim()
  if (!trimmed) return
  // Proteção contra envio duplicado: ignora enquanto há uma resposta em andamento.
  if (inFlight) return

  const userMsg: ChatMessage = { id: newId(), role: 'user', text: trimmed, at: today() }
  const assistantId = newId()
  const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', text: '', at: today(), status: 'responding' }

  let conversationId: string
  let next: Conversation[]
  if (state.activeId) {
    conversationId = state.activeId
    next = state.conversations.map((c) => (c.id === conversationId ? { ...c, messages: [...c.messages, userMsg, assistantMsg] } : c))
  } else {
    conversationId = newId()
    const conv: Conversation = { id: conversationId, title: trimmed.slice(0, 48), createdAt: today(), messages: [userMsg, assistantMsg] }
    next = [conv, ...state.conversations]
  }
  commit(next, conversationId)

  if (!transport) {
    updateMessage(conversationId, assistantId, { text: unavailableText(), status: 'unavailable' })
    return
  }

  const abort = new AbortController()
  inFlight = { conversationId, messageId: assistantId, abort }

  const settle = (patch: Partial<ChatMessage>): void => {
    if (inFlight?.messageId !== assistantId) return // resposta obsoleta descartada
    inFlight = null
    updateMessage(conversationId, assistantId, patch)
  }

  transport(trimmed, context, abort.signal)
    .then((res) => {
      if (res.ok && 'text' in res) settle({ text: res.text, status: 'done' })
      else if ('unavailable' in res) settle({ text: res.instructions, status: 'unavailable' })
      else settle({ text: errorText(), status: 'error' })
    })
    .catch((err: unknown) => {
      if ((err as { name?: string })?.name === 'AbortError') {
        if (inFlight?.messageId === assistantId) inFlight = null
        return
      }
      settle({ text: errorText(), status: 'error' })
    })
}

/** Mutações do chat (fonte única da verdade + persistência local). */
export const chatStore = {
  select: (id: string): void => {
    commit(state.conversations, id)
  },
  newConversation: (): void => {
    commit(state.conversations, null)
  },
  removeConversation: (id: string): void => {
    if (inFlight && inFlight.conversationId === id) inFlight.abort.abort()
    const next = state.conversations.filter((c) => c.id !== id)
    commit(next, state.activeId === id ? null : state.activeId)
  },
  send,
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Snapshot do estado do chat (somente leitura, para testes e diagnóstico). */
export function getChatState(): { conversations: Conversation[]; activeId: string | null } {
  return { conversations: state.conversations, activeId: state.activeId }
}

export interface ChatApi {
  conversations: Conversation[]
  activeId: string | null
  active: Conversation | null
  configured: boolean
  select: (id: string) => void
  newConversation: () => void
  removeConversation: (id: string) => void
  send: (text: string, context?: unknown) => void
}

export function useChat(): ChatApi {
  const snapshot = useSyncExternalStore(subscribe, () => state)
  return {
    conversations: snapshot.conversations,
    activeId: snapshot.activeId,
    active: snapshot.conversations.find((c) => c.id === snapshot.activeId) ?? null,
    configured: chatTransportConfigured(),
    select: chatStore.select,
    newConversation: chatStore.newConversation,
    removeConversation: chatStore.removeConversation,
    send: chatStore.send,
  }
}
