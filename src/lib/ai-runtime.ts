/**
 * Runtime de IA (fase UI 2.4.1) — inicialização automática do transporte de chat.
 *
 * A configuração vem de variáveis de ambiente de BUILD do frontend (nunca do token mestre do servidor):
 * - VITE_AI_BACKEND_URL   URL do backend (ex.: http://localhost:8787).
 * - VITE_AI_SESSION_TOKEN token de SESSÃO escopado (GBOS_CHAT_TOKEN no servidor), não o GBOS_API_TOKEN.
 *
 * `initChatRuntime()` é idempotente e chamado uma única vez no bootstrap do app (main.tsx).
 * Sem configuração, o transporte permanece indisponível (o chat declara indisponibilidade real).
 */
import { createChatTransport } from './chat-client'
import { configureChatTransport, chatTransportConfigured } from './chat'

// Acesso defensivo: em build Vite `import.meta.env` existe; em testes Bun pode ser ausente.
const env = import.meta.env as unknown as Record<string, string> | undefined
const url = env?.VITE_AI_BACKEND_URL?.trim()
const token = env?.VITE_AI_SESSION_TOKEN?.trim()

let initialized = false

export function initChatRuntime(): void {
  if (initialized) return
  initialized = true
  const u = url?.trim()
  const t = token?.trim()
  if (u && t) configureChatTransport(createChatTransport({ url: u, token: t }))
}

export function aiConfigured(): boolean {
  return chatTransportConfigured()
}

export function aiBackendUrl(): string | undefined {
  return url?.trim() || undefined
}

/** Estado real de conexão do chat (não apenas "transporte instanciado"). */
export type AiStatus = { kind: 'not_configured' } | { kind: 'unavailable' } | { kind: 'no_provider' } | { kind: 'ready'; provider: string }

export async function fetchChatStatus(): Promise<AiStatus> {
  if (!chatTransportConfigured()) return { kind: 'not_configured' }
  const base = aiBackendUrl()
  if (!base) return { kind: 'not_configured' }
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/chat/status`)
    if (!res.ok) return { kind: 'unavailable' }
    const body = (await res.json()) as { provider?: string | null }
    const provider = typeof body?.provider === 'string' ? body.provider : null
    return provider ? { kind: 'ready', provider } : { kind: 'no_provider' }
  } catch {
    return { kind: 'unavailable' }
  }
}
