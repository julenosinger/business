/**
 * Transporte de chat com IA (fase UI 2.4) — cliente HTTP real.
 *
 * Envia a mensagem + um contexto empresarial minimizado para o endpoint do servidor e devolve o
 * resultado tipado. O token de autenticação vem de uma configuração de RUNTIME (nunca do bundle e
 * nunca persistido em localStorage). Sem configuração, o chat fica indisponível (o app instrui como
 * configurar, sem simular resposta).
 */

export interface ChatClientConfig {
  url: string
  token: string
}

export type ChatClientResult =
  | { ok: true; text: string }
  | { ok: true; unavailable: true; reason: string; instructions: string }
  | { ok: false; error: string }

export type ChatTransport = (message: string, context: unknown, signal: AbortSignal) => Promise<ChatClientResult>

export function createChatTransport(cfg: ChatClientConfig): ChatTransport {
  const base = cfg.url.trim().replace(/\/+$/, '')
  return async (message, context, signal) => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ message, context }),
      signal,
    })
    if (!res.ok) {
      let error = `chat_failed:${res.status}`
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
