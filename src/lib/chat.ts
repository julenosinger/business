import { useSyncExternalStore } from 'react'
import { today } from './format'

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  at: string
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

/** Mutações do chat (fonte única da verdade + persistência local). NÃO gera respostas de IA. */
export const chatStore = {
  select: (id: string): void => {
    commit(state.conversations, id)
  },
  newConversation: (): void => {
    commit(state.conversations, null)
  },
  removeConversation: (id: string): void => {
    const next = state.conversations.filter((c) => c.id !== id)
    commit(next, state.activeId === id ? null : state.activeId)
  },
  /** Anexa a mensagem do usuário. Sem backend de IA: nenhuma resposta é gerada. */
  send: (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    const msg: ChatMessage = { id: newId(), role: 'user', text: trimmed, at: today() }
    if (state.activeId) {
      const next = state.conversations.map((c) => (c.id === state.activeId ? { ...c, messages: [...c.messages, msg] } : c))
      commit(next, state.activeId)
    } else {
      const id = newId()
      const conv: Conversation = { id, title: trimmed.slice(0, 48), createdAt: today(), messages: [msg] }
      commit([conv, ...state.conversations], id)
    }
  },
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export interface ChatApi {
  conversations: Conversation[]
  activeId: string | null
  active: Conversation | null
  select: (id: string) => void
  newConversation: () => void
  removeConversation: (id: string) => void
  send: (text: string) => void
}

export function useChat(): ChatApi {
  const snapshot = useSyncExternalStore(subscribe, () => state)
  return {
    conversations: snapshot.conversations,
    activeId: snapshot.activeId,
    active: snapshot.conversations.find((c) => c.id === snapshot.activeId) ?? null,
    select: chatStore.select,
    newConversation: chatStore.newConversation,
    removeConversation: chatStore.removeConversation,
    send: chatStore.send,
  }
}
