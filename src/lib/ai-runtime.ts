/**
 * Runtime de IA (fase UI 2.4.2) — inicialização automática e autenticação por sessão.
 *
 * NENHUM token/segredo é embutido no bundle. A configuração usa apenas:
 * - VITE_AI_BACKEND_URL — URL do backend (configuração, não segredo).
 *
 * A autenticação é por sessão: o dono faz login com `GBOS_LOGIN_SECRET` (servidor) via `login()`, e o
 * servidor define um cookie HttpOnly de sessão. O transporte usa `credentials: 'include'`.
 */
import { createChatTransport, CSRF_HEADER } from './chat-client'
import { configureChatTransport, chatTransportConfigured } from './chat'

// Acesso defensivo: em build Vite `import.meta.env` existe; em testes Bun pode ser ausente.
const env = import.meta.env as unknown as Record<string, string> | undefined
const url = env?.VITE_AI_BACKEND_URL?.trim()

let initialized = false

export function initChatRuntime(): void {
  if (initialized) return
  initialized = true
  if (url) configureChatTransport(createChatTransport({ url }))
}

export function aiConfigured(): boolean {
  return chatTransportConfigured()
}

export function aiBackendUrl(): string | undefined {
  return url || undefined
}

function baseUrl(): string | undefined {
  return url?.replace(/\/+$/, '')
}

/** Estado real de conexão do chat (transporte + backend + sessão + provedor). */
export type AiStatus =
  | { kind: 'not_configured' }
  | { kind: 'unavailable' }
  | { kind: 'unauthenticated' }
  | { kind: 'no_provider' }
  | { kind: 'ready'; provider: string }

export async function fetchChatStatus(): Promise<AiStatus> {
  if (!chatTransportConfigured()) return { kind: 'not_configured' }
  const base = baseUrl()
  if (!base) return { kind: 'not_configured' }
  try {
    const res = await fetch(`${base}/api/chat/status`, { credentials: 'include' })
    if (!res.ok) return { kind: 'unavailable' }
    const body = (await res.json()) as { provider?: string | null; authenticated?: boolean }
    if (!body?.authenticated) return { kind: 'unauthenticated' }
    return body.provider ? { kind: 'ready', provider: body.provider } : { kind: 'no_provider' }
  } catch {
    return { kind: 'unavailable' }
  }
}

/** Autentica o dono (segredo → cookie de sessão). Retorna true em sucesso. */
export async function login(secret: string): Promise<boolean> {
  const base = baseUrl()
  if (!base) return false
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Encerra a sessão (revoga no servidor e limpa o cookie). */
export async function logout(): Promise<void> {
  const base = baseUrl()
  if (!base) return
  try {
    await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
    })
  } catch {
    // logout é best-effort
  }
}
