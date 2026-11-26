import { describe, expect, test } from 'bun:test'
import { createApi, UnauthorizedError } from '../server/api'
import { LedgerDb } from '../server/db'
import {
  generateCheckoutToken,
  hashCheckoutToken,
  isCheckoutTokenValid,
  createGatewayCharge,
  getPublicCheckout,
  computeChargeFingerprint,
  type CreateCommercialChargeInput,
} from '../server/payments'
import { gatewayConfigFor } from '../src/lib/gateway-config'

const DEPOSITOR = '0x000000000000000000000000000000000000000a'

const obligationDraft = (accountId = 'a1', amountMinor = '40000000') => ({
  orgId: 'local',
  idempotencyKey: `obligation:${accountId}`,
  type: 'receivable.created' as const,
  source: { module: 'receivables', recordId: accountId },
  occurredAt: '2026-11-22T10:00:00.000Z',
  accountingDate: '2026-11-22',
  currency: 'USDC',
  amountMinor,
  payload: { accountId, category: 'Vendas' },
  confirmation: 'confirmed' as const,
})

function setup(db: LedgerDb, accountId = 'a1', amountMinor = '40000000') {
  const api = createApi(db, { token: 'secret', orgId: 'local', depositors: { testnet: DEPOSITOR } })
  const r = api.postEvent('Bearer secret', obligationDraft(accountId, amountMinor))
  if (!r.ok) throw new Error(`obligation failed: ${JSON.stringify(r.errors)}`)
  return { api }
}

const chargeInput = (over: Partial<CreateCommercialChargeInput> = {}): CreateCommercialChargeInput => ({
  environment: 'testnet',
  accountId: 'a1',
  amountDecimal: '15',
  idempotencyKey: 'k1',
  companyName: 'Acme',
  ...over,
})

describe('checkout backend — segurança criptográfica', () => {
  test('generateCheckoutToken usa CSPRNG e hash SHA-256', () => {
    const a = generateCheckoutToken()
    expect(isCheckoutTokenValid(a.token)).toBe(true)
    expect(a.tokenHash).toHaveLength(64)
    expect(a.tokenHash).toBe(hashCheckoutToken(a.token))
  })
  test('hashCheckoutToken é SHA-256 determinístico', () => {
    expect(hashCheckoutToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  test('isCheckoutTokenValid rejeita formato inválido', () => {
    expect(isCheckoutTokenValid('short')).toBe(false)
    expect(isCheckoutTokenValid(null)).toBe(false)
    expect(isCheckoutTokenValid('!'.repeat(43))).toBe(false)
  })
})

describe('checkout backend — criação autoritativa e transacional', () => {
  test('resolve gatewayWallet/chainId do registro e valida saldo (15 de 40)', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const r = createGatewayCharge(db, 'local', 'testnet', chargeInput(), DEPOSITOR)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.configurationPending).toBe(false)
    const intent = db.db.query('SELECT * FROM payment_intents WHERE intent_id = ?').get(r.intentId) as Record<string, unknown>
    expect(intent.gateway_wallet.toLowerCase()).toBe(gatewayConfigFor('testnet').gatewayWallet.toLowerCase())
    expect(intent.chain_id).toBe(5042002)
    expect(intent.usdc_minor).toBe('15000000')
    // fingerprint calculado pelo servidor (não enviado pelo cliente)
    expect(intent.fingerprint).toBe(computeChargeFingerprint({ organizationId: 'local', environment: 'testnet', accountId: 'a1', currency: 'USDC', amountMinor: '15000000', usdcMinor: '15000000', chainId: 5042002, gatewayWallet: gatewayConfigFor('testnet').gatewayWallet, tokenAddress: gatewayConfigFor('testnet').usdcToken, depositor: DEPOSITOR }))
    db.close()
  })

  test('rejeita cobrança acima do saldo disponível (50 > 40)', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const r = createGatewayCharge(db, 'local', 'testnet', chargeInput({ amountDecimal: '50' }), DEPOSITOR)
    expect(r).toEqual({ ok: false, reason: 'insufficient_balance' })
    db.close()
  })

  test('rejeita obrigação inexistente no razão', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const r = createGatewayCharge(db, 'local', 'testnet', chargeInput({ accountId: 'ghost' }), DEPOSITOR)
    expect(r).toEqual({ ok: false, reason: 'obligation_not_found' })
    db.close()
  })

  test('idempotência: mesma chave reemite link sem duplicar intenção/reserva', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const first = createGatewayCharge(db, 'local', 'testnet', chargeInput(), DEPOSITOR)
    if (!first.ok) throw new Error('expected ok')
    const again = createGatewayCharge(db, 'local', 'testnet', chargeInput(), DEPOSITOR)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.intentId).toBe(first.intentId)
    expect((db.db.query('SELECT COUNT(*) AS c FROM payment_intents').get() as { c: number }).c).toBe(1)
    db.close()
  })

  test('mesma chave com valor divergente → duplicate_conflict', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const first = createGatewayCharge(db, 'local', 'testnet', chargeInput(), DEPOSITOR)
    if (!first.ok) throw new Error('expected ok')
    const conflict = createGatewayCharge(db, 'local', 'testnet', chargeInput({ amountDecimal: '20' }), DEPOSITOR)
    expect(conflict).toEqual({ ok: false, reason: 'duplicate_conflict' })
    db.close()
  })

  test('depositor inválido (GatewayWallet) não é aceito', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const r = createGatewayCharge(db, 'local', 'testnet', chargeInput(), gatewayConfigFor('testnet').gatewayWallet)
    expect(r.ok).toBe(false)
    db.close()
  })
})

describe('checkout backend — consulta pública', () => {
  test('retorna dados mínimos com gatewayWallet resolvido; token desconhecido → null', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const r = createGatewayCharge(db, 'local', 'testnet', chargeInput({ publicDescription: 'Venda', publicReference: 'REF-1' }), DEPOSITOR)
    if (!r.ok) throw new Error('expected ok')
    const checkout = getPublicCheckout(db, r.checkoutToken)
    expect(checkout).toBeTruthy()
    expect(checkout!.usdcMinor).toBe('15000000')
    expect(checkout!.gatewayWallet.toLowerCase()).toBe(gatewayConfigFor('testnet').gatewayWallet.toLowerCase())
    expect(checkout!.company).toBe('Acme')
    expect(checkout!.paymentReady).toBe(true)
    expect((checkout as Record<string, unknown>).organizationId).toBeUndefined()
    expect(getPublicCheckout(db, '0'.repeat(43))).toBeNull()
    db.close()
  })

  test('depositor não resolvido → configurationPending + paymentReady false', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const r = createGatewayCharge(db, 'local', 'testnet', chargeInput(), null)
    if (!r.ok) throw new Error('expected ok')
    expect(r.configurationPending).toBe(true)
    expect(getPublicCheckout(db, r.checkoutToken)!.paymentReady).toBe(false)
    db.close()
  })
})

describe('checkout backend — autenticação', () => {
  test('createPaymentIntent exige Bearer token e usa depositor do servidor', () => {
    const db = new LedgerDb(':memory:')
    const { api } = setup(db)
    expect(() => api.createPaymentIntent(undefined, 'testnet', chargeInput())).toThrow(UnauthorizedError)
    expect(api.createPaymentIntent('Bearer secret', 'testnet', chargeInput()).ok).toBe(true)
    db.close()
  })
})
