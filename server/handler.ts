/**
 * Handler HTTP do backend (fase UI 2.4.2) — testável, separado do bootstrap do servidor.
 *
 * Contém o roteamento, autenticação (sessão cookie para o chat; Bearer mestre para o ledger),
 * CORS e defesa CSRF. O bootstrap (`index.ts`) apenas configura e liga o `Bun.serve`.
 */
import { UnauthorizedError, type LedgerApi } from './api'
import type { ChatApi, ChatRequest } from './chat'
import { CSRF_HEADER, SessionStore, SESSION_COOKIE, clearSessionCookieHeader, parseCookies, sessionCookieHeader } from './session'
import { getPublicCheckout, createCheckoutAttempt, beginDepositSubmission, registerDepositSubmission, getCheckoutStatus } from './payments'
import { serveStatic } from './static'
import type { LedgerDb } from './db'

export interface HandlerConfig {
  api: LedgerApi
  chat: ChatApi
  sessions: SessionStore
  db: LedgerDb
  loginSecret?: string
  allowedOrigin?: string
  cookieSecure: boolean
  sessionMaxAge: number
  /** Diretório do frontend compilado (ex.: `dist`) para servir o SPA na mesma origem. */
  staticDir?: string
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
        const session = cfg.sessions.create(cfg.api.cfg.orgId, ['chat:write', 'payments:write'])
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

      // Autenticação comercial: Bearer (admin) OU sessão com permissão `payments:write`.
      const resolvePaymentOrg = (req: Request): string => {
        if (auth === `Bearer ${cfg.api.cfg.token}`) return cfg.api.cfg.orgId
        const session = cfg.sessions.validate(sessionId(req))
        if (session && session.permissions.includes('payments:write')) return session.organizationId
        throw new UnauthorizedError()
      }

      // Mainnet-only: rejeita Testnet explicitamente (sem conversão silenciosa para Mainnet).
      const resolveEnvironment = (value: unknown): { env: 'mainnet' } | { error: string } => {
        if (value === 'mainnet') return { env: 'mainnet' }
        if (value === 'testnet') return { error: 'testnet_discontinued' }
        return { error: 'invalid_environment' }
      }

      // Sincronização autoritativa da obrigação comercial (projeção do checkout).
      if (method === 'POST' && url.pathname === '/api/obligations/sync') {
        const body = (await req.json()) as { environment?: unknown } & Record<string, unknown>
        const resolved = resolveEnvironment(body.environment)
        if ('error' in resolved) return json({ error: resolved.error }, 400, cors())
        const result = cfg.api.syncObligationForOrg(resolvePaymentOrg(req), resolved.env, body as never)
        return json(result, result.ok ? 200 : 409, cors())
      }

      // Cobrança Gateway compartilhável (autenticada pela organização).
      if (method === 'POST' && url.pathname === '/api/payment-intents') {
        const body = (await req.json()) as { environment?: unknown } & Record<string, unknown>
        const resolved = resolveEnvironment(body.environment)
        if ('error' in resolved) return json({ error: resolved.error }, 400, cors())
        const result = cfg.api.createPaymentIntentForOrg(resolvePaymentOrg(req), resolved.env, body as never)
        return json(result, result.ok ? 200 : 409, cors())
      }
      if (method === 'GET' && url.pathname === '/api/payment-intents') {
        const env = url.searchParams.get('environment')
        const resolved = resolveEnvironment(env)
        if ('error' in resolved) return json({ error: resolved.error }, 400, cors())
        return json(cfg.api.listPaymentIntentsForOrg(resolvePaymentOrg(req), resolved.env), 200, cors())
      }
      const intentMatch = url.pathname.match(/^\/api\/payment-intents\/([^/]+)$/)
      if (intentMatch) {
        if (method === 'GET') {
          const intent = cfg.api.getPaymentIntent(auth, intentMatch[1]!)
          return intent ? json(intent, 200, cors()) : json({ error: 'not_found' }, 404, cors())
        }
        if (method === 'POST' && url.pathname.endsWith('/share')) {
          const result = cfg.api.sharePaymentIntentForOrg(resolvePaymentOrg(req), intentMatch[1]!)
          return json(result, result.ok ? 200 : 404, cors())
        }
      }

      // Checkout público (sem autenticação): dados comerciais mínimos, nunca dados privados.
      const checkoutMatch = url.pathname.match(/^\/api\/checkout\/([A-Za-z0-9_-]+)$/)
      if (method === 'GET' && checkoutMatch) {
        const noStore = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
        const checkout = getPublicCheckout(cfg.db, checkoutMatch[1]!)
        if (!checkout) return json({ error: 'not_found' }, 404, { ...cors(), ...noStore })
        return json(checkout, 200, { ...cors(), ...noStore })
      }
      const checkoutStatusMatch = url.pathname.match(/^\/api\/checkout\/([A-Za-z0-9_-]+)\/status$/)
      if (method === 'GET' && checkoutStatusMatch) {
        const status = getCheckoutStatus(cfg.db, checkoutStatusMatch[1]!)
        return status ? json(status, 200, cors()) : json({ error: 'not_found' }, 404, cors())
      }
      const attemptMatch = url.pathname.match(/^\/api\/checkout\/([A-Za-z0-9_-]+)\/attempts$/)
      if (method === 'POST' && attemptMatch) {
        const body = (await req.json()) as { payer?: unknown }
        const result = createCheckoutAttempt(cfg.db, attemptMatch[1]!, String(body.payer ?? ''))
        return json(result, result.ok ? 200 : 409, cors())
      }
      const attemptActionMatch = url.pathname.match(/^\/api\/checkout\/([A-Za-z0-9_-]+)\/attempts\/([^/]+)\/(begin|submission)$/)
      if (method === 'POST' && attemptActionMatch) {
        const body = (await req.json()) as { payer?: unknown; txHash?: unknown }
        const [, token, attemptId, action] = attemptActionMatch
        if (action === 'begin') {
          const result = beginDepositSubmission(cfg.db, token!, attemptId!, String(body.payer ?? ''))
          return json(result, result.ok ? 200 : 409, cors())
        }
        const result = registerDepositSubmission(cfg.db, token!, attemptId!, String(body.txHash ?? ''))
        return json(result, result.ok ? 200 : 409, cors())
      }

      // SPA (same-origin): serve o frontend compilado quando staticDir estiver configurado.
      if (cfg.staticDir) {
        const staticResponse = await serveStatic(req, cfg.staticDir)
        if (staticResponse) return staticResponse
      }

      return json({ error: 'not_found' }, 404)
    } catch (err) {
      if (err instanceof UnauthorizedError) return json({ error: 'unauthorized' }, 401, cors())
      return json({ error: err instanceof Error ? err.message : 'internal_error' }, 400, cors())
    }
  }
}
