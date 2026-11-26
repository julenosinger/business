import { describe, expect, test } from 'bun:test'
import { createApi } from '../server/api'
import { LedgerDb } from '../server/db'
import { createGatewayCharge, getPublicCheckout, createCheckoutAttempt, beginDepositSubmission, registerDepositSubmission, getCheckoutStatus, sharePaymentIntent, listPaymentIntents } from '../server/payments'

const DEPOSITOR = '0x000000000000000000000000000000000000000a'
const PAYER = '0x' + 'cd'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

function setup(db: LedgerDb, accountId = 'a1', amountMinor = '40000000', currency = 'USDC') {
  const api = createApi(db, { token: 'secret', orgId: 'local', depositors: { testnet: DEPOSITOR } })
  const r = api.postEvent('Bearer secret', {
    orgId: 'local',
    idempotencyKey: `obligation:${accountId}`,
    type: 'receivable.created' as const,
    source: { module: 'receivables', recordId: accountId },
    occurredAt: '2026-11-22T10:00:00.000Z',
    accountingDate: '2026-11-22',
    currency,
    amountMinor,
    payload: { accountId, category: 'Vendas' },
    confirmation: 'confirmed' as const,
  })
  if (!r.ok) throw new Error(`obligation failed: ${JSON.stringify(r.errors)}`)
  return { api }
}

function makeCharge(db: LedgerDb, over: Record<string, unknown> = {}) {
  const r = createGatewayCharge(db, 'local', 'testnet', { environment: 'testnet', accountId: 'a1', amountDecimal: '15', idempotencyKey: 'k1', companyName: 'Acme', ...over } as never, DEPOSITOR)
  if (!r.ok) throw new Error('charge failed')
  return r
}

describe('checkout backend — múltiplas moedas', () => {
  test('cobrança BRL reserva em centavos e converte para USDC via cotação do razão', () => {
    const db = new LedgerDb(':memory:')
    setup(db, 'brl1', '10000', 'BRL') // 100 BRL
    // cotação: 5 BRL por 1 USDC
    const ledger = db.loadLedger('local')!
    ledger.fxRates = [{ id: 'FX1', from: 'USDC' as const, to: 'BRL' as const, rate: '5', source: 'test', at: '2026-11-22T10:00:00.000Z', recordedBy: 'owner' }]
    db.saveLedger('local', ledger, new Date().toISOString())
    const r = createGatewayCharge(db, 'local', 'testnet', { environment: 'testnet', accountId: 'brl1', amountDecimal: '60', idempotencyKey: 'k1', companyName: 'Acme' }, DEPOSITOR)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const intent = db.db.query('SELECT amount_minor, usdc_minor FROM payment_intents WHERE intent_id = ?').get(r.intentId) as { amount_minor: string; usdc_minor: string }
    expect(intent.amount_minor).toBe('6000') // 60 BRL = 6000 centavos
    expect(intent.usdc_minor).toBe('12000000') // 12 USDC
    db.close()
  })

  test('cobrança BRL sem cotação no razão é rejeitada', () => {
    const db = new LedgerDb(':memory:')
    setup(db, 'brl1', '10000', 'BRL')
    const r = createGatewayCharge(db, 'local', 'testnet', { environment: 'testnet', accountId: 'brl1', amountDecimal: '60', idempotencyKey: 'k1', companyName: 'Acme' }, DEPOSITOR)
    expect(r).toEqual({ ok: false, reason: 'invalid_currency' })
    db.close()
  })
})

describe('checkout backend — consulta do comerciante e share', () => {
  test('listPaymentIntents retorna por ambiente; share reemite link sem duplicar reserva', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const r = makeCharge(db)
    const list = listPaymentIntents(db, 'local', 'testnet')
    expect(list).toHaveLength(1)
    expect(list[0]!.intentId).toBe(r.intentId)
    expect(list[0]!.usdcMinor).toBe('15000000')
    // share
    const share = sharePaymentIntent(db, 'local', r.intentId)
    expect(share.ok).toBe(true)
    if (!share.ok) return
    const checkout = getPublicCheckout(db, share.checkoutToken)
    expect(checkout).toBeTruthy()
    // intenção e reserva não duplicadas
    expect(listPaymentIntents(db, 'local', 'testnet')).toHaveLength(1)
    db.close()
  })
})

describe('checkout backend — tentativas e hash imutável', () => {
  test('createAttempt → begin → submission registra hash imutável com replay', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const r = makeCharge(db)
    const att = createCheckoutAttempt(db, r.checkoutToken, PAYER)
    expect(att.ok).toBe(true)
    if (!att.ok) return
    // hash antes do begin → rejeitado (estado não autorizado)
    expect(registerDepositSubmission(db, r.checkoutToken, att.attemptId, HASH)).toEqual({ ok: false, reason: 'invalid_submission_state' })
    expect(beginDepositSubmission(db, r.checkoutToken, att.attemptId, PAYER)).toEqual({ ok: true })
    const reg = registerDepositSubmission(db, r.checkoutToken, att.attemptId, HASH)
    expect(reg).toEqual({ ok: true, hash: HASH, replay: false })
    // replay idempotente
    expect(registerDepositSubmission(db, r.checkoutToken, att.attemptId, HASH)).toEqual({ ok: true, hash: HASH, replay: true })
    // hash conflitante
    expect(registerDepositSubmission(db, r.checkoutToken, att.attemptId, '0x' + 'cd'.repeat(32))).toEqual({ ok: false, reason: 'hash_conflict' })
    // status
    const status = getCheckoutStatus(db, r.checkoutToken)
    expect(status?.state).toBe('CREATED')
    expect(status?.attempts[0]?.depositHash).toBe(HASH)
    db.close()
  })

  test('uma tentativa ativa impede nova tentativa', () => {
    const db = new LedgerDb(':memory:')
    setup(db)
    const r = makeCharge(db)
    const att = createCheckoutAttempt(db, r.checkoutToken, PAYER)
    if (!att.ok) throw new Error('expected attempt')
    expect(createCheckoutAttempt(db, r.checkoutToken, PAYER)).toEqual({ ok: false, reason: 'attempt_requires_recovery' })
    db.close()
  })
})
