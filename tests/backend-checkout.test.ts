import { describe, expect, test } from 'bun:test'
import { createApi, UnauthorizedError } from '../server/api'
import { LedgerDb } from '../server/db'
import {
  generateCheckoutToken,
  hashCheckoutToken,
  isCheckoutTokenValid,
  createGatewayCharge,
  getPublicCheckout,
  type CreateGatewayChargeInput,
} from '../server/payments'

const chargeInput = (over: Partial<CreateGatewayChargeInput> = {}): CreateGatewayChargeInput => ({
  accountId: 'a1',
  chainId: 5042002,
  tokenAddress: '0x3600000000000000000000000000000000000000',
  gatewayWallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
  depositor: '0x000000000000000000000000000000000000000a',
  currency: 'USDC',
  amountMinor: '15000000',
  usdcMinor: '15000000',
  idempotencyKey: 'k1',
  fingerprint: 'fp-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  companyName: 'Acme',
  ...over,
})

describe('checkout backend — segurança criptográfica', () => {
  test('generateCheckoutToken usa CSPRNG (43 caracteres base64url) e hash SHA-256', () => {
    const a = generateCheckoutToken()
    const b = generateCheckoutToken()
    expect(isCheckoutTokenValid(a.token)).toBe(true)
    expect(a.token).not.toBe(b.token)
    expect(a.tokenHash).toHaveLength(64)
    expect(a.tokenHash).toBe(hashCheckoutToken(a.token))
  })

  test('hashCheckoutToken é SHA-256 determinístico', () => {
    expect(hashCheckoutToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  test('isCheckoutTokenValid rejeita formato inválido', () => {
    expect(isCheckoutTokenValid('short')).toBe(false)
    expect(isCheckoutTokenValid('')).toBe(false)
    expect(isCheckoutTokenValid(null)).toBe(false)
    expect(isCheckoutTokenValid('x'.repeat(43))).toBe(true) // 43 chars dentro do alfabeto
    expect(isCheckoutTokenValid('!'.repeat(43))).toBe(false) // 43 chars fora do alfabeto
  })
})

describe('checkout backend — criação transacional', () => {
  test('cria intenção + reserva + token em uma transação', () => {
    const db = new LedgerDb(':memory:')
    const r = createGatewayCharge(db, 'local', 'testnet', chargeInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.configurationPending).toBe(false)
    // intenção e reserva persistidas
    const intent = db.db.query('SELECT * FROM payment_intents WHERE intent_id = ?').get(r.intentId)
    expect(intent).toBeTruthy()
    const reservation = db.db.query('SELECT * FROM payment_reservations WHERE intent_id = ?').get(r.intentId)
    expect(reservation).toBeTruthy()
    db.close()
  })

  test('idempotência: mesma chave reemite o link sem duplicar intenção/reserva', () => {
    const db = new LedgerDb(':memory:')
    const first = createGatewayCharge(db, 'local', 'testnet', chargeInput())
    if (!first.ok) throw new Error('expected ok')
    const again = createGatewayCharge(db, 'local', 'testnet', chargeInput())
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.intentId).toBe(first.intentId)
    const count = db.db.query('SELECT COUNT(*) AS c FROM payment_intents').get() as { c: number }
    expect(count.c).toBe(1)
    const tokens = db.db.query('SELECT COUNT(*) AS c FROM checkout_tokens').get() as { c: number }
    expect(tokens.c).toBe(2) // novo token emitido, intenção não duplicada
    db.close()
  })

  test('parâmetros divergentes na mesma chave → duplicate_conflict', () => {
    const db = new LedgerDb(':memory:')
    const first = createGatewayCharge(db, 'local', 'testnet', chargeInput())
    if (!first.ok) throw new Error('expected ok')
    const conflict = createGatewayCharge(db, 'local', 'testnet', chargeInput({ usdcMinor: '99999999', fingerprint: 'fp-2' }))
    expect(conflict).toEqual({ ok: false, reason: 'duplicate_conflict' })
    db.close()
  })

  test('rollback: entrada inválida não cria registros órfãos', () => {
    const db = new LedgerDb(':memory:')
    const bad = createGatewayCharge(db, 'local', 'testnet', chargeInput({ idempotencyKey: '' }))
    expect(bad.ok).toBe(false)
    const count = db.db.query('SELECT COUNT(*) AS c FROM payment_intents').get() as { c: number }
    expect(count.c).toBe(0)
    db.close()
  })
})

describe('checkout backend — consulta pública', () => {
  test('getPublicCheckout retorna dados mínimos; token desconhecido → null', () => {
    const db = new LedgerDb(':memory:')
    const r = createGatewayCharge(db, 'local', 'testnet', chargeInput({ publicDescription: 'Venda', publicReference: 'REF-1' }))
    if (!r.ok) throw new Error('expected ok')
    const checkout = getPublicCheckout(db, r.checkoutToken)
    expect(checkout).toBeTruthy()
    expect(checkout!.usdcMinor).toBe('15000000')
    expect(checkout!.gatewayWallet).toBe('0x0077777d7EBA4688BDeF3E311b846F25870A19B9')
    expect(checkout!.company).toBe('Acme')
    expect(checkout!.description).toBe('Venda')
    expect(checkout!.paymentReady).toBe(true)
    // Não expõe campos privados.
    expect((checkout as Record<string, unknown>).organizationId).toBeUndefined()
    expect(getPublicCheckout(db, '0'.repeat(43))).toBeNull()
    db.close()
  })

  test('depositor não resolvido → paymentReady false', () => {
    const db = new LedgerDb(':memory:')
    const r = createGatewayCharge(db, 'local', 'testnet', chargeInput({ depositor: null }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.configurationPending).toBe(true)
    const checkout = getPublicCheckout(db, r.checkoutToken)!
    expect(checkout.paymentReady).toBe(false)
    db.close()
  })
})

describe('checkout backend — autenticação', () => {
  test('createPaymentIntent exige Bearer token', () => {
    const db = new LedgerDb(':memory:')
    const api = createApi(db, { token: 'secret', orgId: 'local' })
    expect(() => api.createPaymentIntent(undefined, 'testnet', chargeInput())).toThrow(UnauthorizedError)
    expect(api.createPaymentIntent('Bearer secret', 'testnet', chargeInput()).ok).toBe(true)
    db.close()
  })
})
