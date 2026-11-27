import { describe, expect, test } from 'bun:test'
import { createApi } from '../server/api'
import { createChatApi } from '../server/chat'
import { createHandler } from '../server/handler'
import { LedgerDb } from '../server/db'
import { SessionStore, SESSION_COOKIE } from '../server/session'

const DEPOSITOR = '0x000000000000000000000000000000000000000a'

function makeHandler() {
  const db = new LedgerDb(':memory:')
  const api = createApi(db, { token: 'admin-secret', orgId: 'local', depositors: { mainnet: DEPOSITOR } })
  const sessions = new SessionStore()
  const chat = createChatApi({ sessions })
  const handler = createHandler({ api, chat, sessions, db, loginSecret: 'login-secret', cookieSecure: false, sessionMaxAge: 3600 })
  return { handler, db }
}

async function login(handler: (req: Request) => Promise<Response> | Response): Promise<string> {
  const res = (await handler(new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'login-secret' }) }))) as Response
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie') ?? ''
  return cookie.split(';')[0]!.split('=')[1]!
}

function withCookie(cookie: string, headers: Record<string, string> = {}): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${cookie}`, 'content-type': 'application/json', ...headers }
}

describe('FIN-04.1B.2.2B.3.2B.0 — fluxo HTTP completo (login → sync → cobrança)', () => {
  test('sessão comercial + sincronização + criação de cobrança de 3 USDC', async () => {
    const { handler } = makeHandler()
    const cookie = await login(handler)

    // 1. Sincroniza a obrigação (venda de 3 USDC).
    const sync = (await handler(
      new Request('http://localhost/api/obligations/sync', {
        method: 'POST',
        headers: withCookie(cookie),
        body: JSON.stringify({ environment: 'mainnet', obligationId: 'a1', sourceKind: 'sale', sourceId: 's1', currency: 'USDC', originalAmountMinor: '3000000', outstandingMinor: '3000000', version: 0 }),
      }),
    )) as Response
    expect(sync.status).toBe(200)
    expect((await sync.json()).ok).toBe(true)

    // 2. Cria a cobrança de 3 USDC.
    const charge = (await handler(
      new Request('http://localhost/api/payment-intents', {
        method: 'POST',
        headers: withCookie(cookie),
        body: JSON.stringify({ environment: 'mainnet', accountId: 'a1', amountDecimal: '3', idempotencyKey: 'k1', companyName: 'Acme' }),
      }),
    )) as Response
    expect(charge.status).toBe(200)
    const chargeBody = (await charge.json()) as { ok: boolean; checkoutToken?: string; reason?: string; error?: string }
    expect(chargeBody.ok).toBe(true)
    expect(chargeBody.checkoutToken).toBeTruthy()

    // 3. Checkout público acessível sem sessão.
    const checkout = (await handler(new Request(`http://localhost/api/checkout/${chargeBody.checkoutToken}`))) as Response
    expect(checkout.status).toBe(200)
    const checkoutBody = (await checkout.json()) as { usdcMinor: string; company: string }
    expect(checkoutBody.usdcMinor).toBe('3000000')
    expect(checkoutBody.company).toBe('Acme')
  })

  test('sem sessão comercial → 401 (não mascara o erro)', async () => {
    const { handler } = makeHandler()
    const res = (await handler(
      new Request('http://localhost/api/payment-intents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ environment: 'mainnet', accountId: 'a1', amountDecimal: '3', idempotencyKey: 'k1' }),
      }),
    )) as Response
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('unauthorized')
  })

  test('obrigação não sincronizada → obligation_not_found (código explícito)', async () => {
    const { handler } = makeHandler()
    const cookie = await login(handler)
    const res = (await handler(
      new Request('http://localhost/api/payment-intents', {
        method: 'POST',
        headers: withCookie(cookie),
        body: JSON.stringify({ environment: 'mainnet', accountId: 'ghost', amountDecimal: '3', idempotencyKey: 'k1', companyName: 'Acme' }),
      }),
    )) as Response
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('obligation_not_found')
  })

  test('Testnet é rejeitada explicitamente (testnet_discontinued)', async () => {
    const { handler } = makeHandler()
    const cookie = await login(handler)
    const res = (await handler(
      new Request('http://localhost/api/payment-intents', {
        method: 'POST',
        headers: withCookie(cookie),
        body: JSON.stringify({ environment: 'testnet', accountId: 'a1', amountDecimal: '3', idempotencyKey: 'k1', companyName: 'Acme' }),
      }),
    )) as Response
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('testnet_discontinued')
  })
})
