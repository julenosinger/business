/**
 * Handler HTTP do backend (fase UI 2.4.2) — testável, separado do bootstrap do servidor.
 *
 * Contém o roteamento, autenticação (sessão cookie para o chat; Bearer mestre para o ledger),
 * CORS e defesa CSRF. O bootstrap (`index.ts`) apenas configura e liga o `Bun.serve`.
 */
import { UnauthorizedError, type LedgerApi } from './api'
import type { ChatApi, ChatRequest } from './chat'
import { CSRF_HEADER, SessionStore, SESSION_COOKIE, clearSessionCookieHeader, parseCookies, sessionCookieHeader } from './session'

export interface HandlerConfig {
  api: LedgerApi
  chat: ChatApi
  sessions: SessionStore
  loginSecret?: string
  allowedOrigin?: string
  cookieSecure: boolean
  sessionMaxAge: number
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } })

export function createHandler(cfg: HandlerConfig): (req: Request) => Promise<Response> | Response {
  const cors = (): Record<string, string> =>
    cfg.allowedOrigin ? { 'access-control-allow-origin': cfg.allowedOrigin, 'access-control-allow-credentials': 'true', vary: 'Origin' } : {}

  const sessionId = (req: Request): string | undefined => parseCookies(req.headers.get('cookie'))[SESSION_COOKIE]

  return async (req) => {
    const url = new URL(req.url)
    const method = req.method

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors(), 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': `content-type, ${CSRF_HEADER}`, 'access-control-max-age': '600' },
      })
    }

    try {
      if (method === 'POST' && url.pathname === '/api/auth/login') {
        const body = (await req.json()) as { secret?: string }
        if (!cfg.loginSecret) return json({ error: 'login_disabled' }, 403, cors())
        if (typeof body?.secret !== 'string' || body.secret !== cfg.loginSecret) return json({ error: 'unauthorized' }, 401, cors())
        const session = cfg.sessions.create()
        return json({ ok: true }, 200, { ...cors(), 'set-cookie': sessionCookieHeader(session.id, cfg.cookieSecure, cfg.sessionMaxAge) })
      }
      if (method === 'POST' && url.pathname === '/api/auth/logout') {
        if (!req.headers.get(CSRF_HEADER)) return json({ error: 'csrf' }, 403, cors())
        const sid = sessionId(req)
        if (sid) cfg.sessions.revoke(sid)
        return json({ ok: true }, 200, { ...cors(), 'set-cookie': clearSessionCookieHeader(cfg.cookieSecure) })
      }

      if (method === 'POST' && url.pathname === '/api/chat') {
        if (!req.headers.get(CSRF_HEADER)) return json({ error: 'csrf' }, 403, cors())
        return json(await cfg.chat.chat(sessionId(req), (await req.json()) as ChatRequest), 200, cors())
      }
      if (method === 'GET' && url.pathname === '/api/chat/status') {
        return json(cfg.chat.status(sessionId(req)), 200, cors())
      }

      const auth = req.headers.get('authorization') ?? undefined
      if (method === 'GET' && url.pathname === '/api/ledger') return json(cfg.api.getLedger(auth))
      if (method === 'POST' && url.pathname === '/api/ledger/events') return json(cfg.api.postEvent(auth, (await req.json()) as never))
      if (method === 'POST' && url.pathname === '/api/ledger/settle') return json(await cfg.api.settle(auth, (await req.json()) as never))

      return json({ error: 'not_found' }, 404)
    } catch (err) {
      if (err instanceof UnauthorizedError) return json({ error: 'unauthorized' }, 401, cors())
      return json({ error: err instanceof Error ? err.message : 'internal_error' }, 400, cors())
    }
  }
}
