/**
 * Transporte de chat com IA (fase UI 2.4.2) — cliente HTTP real, autenticado por sessão (cookie).
 *
 * Nenhum token/segredo é embutido no bundle: a autenticação é feita por cookie HttpOnly de sessão
 * (`credentials: 'include'`). O cabeçalho `X-GBOS-CSRF` é enviado para a defesa CSRF do servidor.
 */

export interface ChatClientConfig {
  url: string
}

export type ChatClientResult =
  | { ok: true; text: string }
  | { ok: true; unavailable: true; reason: string; instructions: string }
  | { ok: false; error: string }

export type ChatTransport = (message: string, context: unknown, signal: AbortSignal) => Promise<ChatClientResult>

export const CSRF_HEADER = 'x-gbos-csrf'

export function createChatTransport(cfg: ChatClientConfig): ChatTransport {
  const base = cfg.url.trim().replace(/\/+$/, '')
  return async (message, context, signal) => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
      body: JSON.stringify({ message, context }),
      signal,
    })
    if (!res.ok) {
      let error = res.status === 401 ? 'unauthorized' : `chat_failed:${res.status}`
      try {
        const body = (await res.json()) as { error?: string }
        if (body && typeof body.error === 'string') error = body.error
      } catch {
        // corpo não-JSON: mantém a mensagem genérica.
      }
      return { ok: false, error }
    }
    return (await res.json()) as ChatClientResult
  }
}
