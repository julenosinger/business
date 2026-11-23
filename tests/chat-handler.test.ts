import { describe, expect, test } from 'bun:test'
import { createChatApi } from '../server/chat'
import { SessionStore } from '../server/session'
import { createHandler } from '../server/handler'
import type { ChatProvider } from '../server/ai'
import type { LedgerApi } from '../server/api'

const mockProvider = (): ChatProvider => ({ id: 'mock', model: 'm', generate: async () => 'ok' })

const stubApi = {
  getLedger: () => ({ orgId: 'local' }),
  postEvent: () => ({ ok: false }),
  settle: async () => ({ ok: false, error: 'x' }),
  cfg: { token: 't', orgId: 'local' },
} as unknown as LedgerApi

function makeHandler(over: Record<string, unknown> = {}) {
  const sessions = new SessionStore()
  const chat = createChatApi({ sessions, provider: mockProvider() })
  const handler = createHandler({
    api: stubApi,
    chat,
    sessions,
    loginSecret: 's3cret',
    cookieSecure: false,
    sessionMaxAge: 3600,
    ...over,
  } as Parameters<typeof createHandler>[0])
  return { handler, sessions }
}

const cookie = (res: Response): string | null => res.headers.get('set-cookie')
const sid = (res: Response): string | undefined => cookie(res)?.match(/gbos_session=([^;]+)/)?.[1]

describe('handler HTTP do chat (autenticação e CSRF)', () => {
  test('login com segredo incorreto → 401; correto → cria sessão HttpOnly', async () => {
    const { handler } = makeHandler()
    const badRes = await handler(new Request('http://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'errado' }) }))
    expect(badRes.status).toBe(401)

    const ok = await handler(new Request('http://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 's3cret' }) }))
    expect(ok.status).toBe(200)
    expect(cookie(ok)).toContain('HttpOnly')
    expect(sid(ok)).toBeTruthy()
  })

  test('login desabilitado sem GBOS_LOGIN_SECRET → 403', async () => {
    const { handler } = makeHandler({ loginSecret: undefined })
    const res = await handler(new Request('http://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'x' }) }))
    expect(res.status).toBe(403)
  })

  test('chat sem sessão → 401; sem CSRF → 403; com sessão+CSRF → ok', async () => {
    const { handler } = makeHandler()
    const noSession = await handler(new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gbos-csrf': '1' }, body: JSON.stringify({ message: 'oi' }) }))
    expect(noSession.status).toBe(401)

    const login = await handler(new Request('http://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 's3cret' }) }))
    const id = sid(login)!

    const noCsrf = await handler(new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `gbos_session=${id}` }, body: JSON.stringify({ message: 'oi' }) }))
    expect(noCsrf.status).toBe(403)

    const ok = await handler(new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gbos-csrf': '1', cookie: `gbos_session=${id}` }, body: JSON.stringify({ message: 'oi' }) }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, text: 'ok' })
  })

  test('status reflete autenticação sem expor credenciais', async () => {
    const { handler } = makeHandler()
    expect(await (await handler(new Request('http://x/api/chat/status'))).json()).toEqual({ provider: 'mock', authenticated: false })

    const login = await handler(new Request('http://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 's3cret' }) }))
    const id = sid(login)!
    expect(await (await handler(new Request('http://x/api/chat/status', { headers: { cookie: `gbos_session=${id}` } }))).json()).toEqual({ provider: 'mock', authenticated: true })
  })

  test('logout revoga a sessão', async () => {
    const { handler } = makeHandler()
    const login = await handler(new Request('http://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 's3cret' }) }))
    const id = sid(login)!
    const out = await handler(new Request('http://x/api/auth/logout', { method: 'POST', headers: { 'x-gbos-csrf': '1', cookie: `gbos_session=${id}` } }))
    expect(out.status).toBe(200)
    expect(await (await handler(new Request('http://x/api/chat/status', { headers: { cookie: `gbos_session=${id}` } }))).json()).toEqual({ provider: 'mock', authenticated: false })
  })
})
