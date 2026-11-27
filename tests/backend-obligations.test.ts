import { describe, expect, test } from 'bun:test'
import { LedgerDb } from '../server/db'
import { syncObligation, getObligation } from '../server/obligations'
import { createGatewayCharge } from '../server/payments'

const DEPOSITOR = '0x000000000000000000000000000000000000000a'

describe('FIN-04.1B.2.2B.3.2B — sincronização autoritativa de obrigações', () => {
  test('syncObligation é idempotente e versionada (stale → conflict)', () => {
    const db = new LedgerDb(':memory:')
    const input = { obligationId: 'a1', sourceKind: 'sale', sourceId: 's1', currency: 'USDC', originalAmountMinor: '40000000', outstandingMinor: '40000000', version: 0 }
    const a = syncObligation(db, 'local', 'testnet', input)
    expect(a).toEqual({ ok: true, obligationId: 'a1', version: 0, duplicate: false })
    const b = syncObligation(db, 'local', 'testnet', input)
    expect(b.ok && b.duplicate).toBe(true)
    // versão mais nova → atualiza
    const d = syncObligation(db, 'local', 'testnet', { ...input, version: 1, outstandingMinor: '25000000' })
    expect(d.ok && d.version === 1).toBe(true)
    expect(getObligation(db, 'local', 'testnet', 'a1')?.outstandingMinor).toBe('25000000')
    // versão antiga (0) → conflito (não sobrescreve a versão 1)
    expect(syncObligation(db, 'local', 'testnet', input)).toEqual({ ok: false, reason: 'version_conflict' })
    expect(getObligation(db, 'local', 'testnet', 'a1')?.outstandingMinor).toBe('25000000')
    db.close()
  })

  test('obrigações são isoladas por organização e ambiente', () => {
    const db = new LedgerDb(':memory:')
    syncObligation(db, 'local', 'testnet', { obligationId: 'a1', sourceKind: 'sale', sourceId: 's1', currency: 'USDC', originalAmountMinor: '40000000', outstandingMinor: '40000000', version: 0 })
    expect(getObligation(db, 'local', 'mainnet', 'a1')).toBeNull()
    expect(getObligation(db, 'other', 'testnet', 'a1')).toBeNull()
    expect(getObligation(db, 'local', 'testnet', 'a1')).toBeTruthy()
    db.close()
  })

  test('createGatewayCharge usa a obrigação sincronizada (15 de 40)', () => {
    const db = new LedgerDb(':memory:')
    syncObligation(db, 'local', 'testnet', { obligationId: 'a1', sourceKind: 'sale', sourceId: 's1', currency: 'USDC', originalAmountMinor: '40000000', outstandingMinor: '40000000', version: 0 })
    const r = createGatewayCharge(db, 'local', 'testnet', { environment: 'testnet', accountId: 'a1', amountDecimal: '15', idempotencyKey: 'k1', companyName: 'Acme' }, DEPOSITOR)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const intent = db.db.query('SELECT usdc_minor FROM payment_intents WHERE intent_id = ?').get(r.intentId) as { usdc_minor: string }
    expect(intent.usdc_minor).toBe('15000000')
    db.close()
  })

  test('createGatewayCharge sem obrigação (nem sincronizada nem no razão) → obligation_not_found', () => {
    const db = new LedgerDb(':memory:')
    const r = createGatewayCharge(db, 'local', 'testnet', { environment: 'testnet', accountId: 'ghost', amountDecimal: '15', idempotencyKey: 'k1', companyName: 'Acme' }, DEPOSITOR)
    expect(r).toEqual({ ok: false, reason: 'obligation_not_found' })
    db.close()
  })

  test('obrigação sincronizada com saldo parcial impede cobrança acima do disponível', () => {
    const db = new LedgerDb(':memory:')
    syncObligation(db, 'local', 'testnet', { obligationId: 'a1', sourceKind: 'sale', sourceId: 's1', currency: 'USDC', originalAmountMinor: '40000000', outstandingMinor: '25000000', version: 0 })
    const r = createGatewayCharge(db, 'local', 'testnet', { environment: 'testnet', accountId: 'a1', amountDecimal: '30', idempotencyKey: 'k1', companyName: 'Acme' }, DEPOSITOR)
    expect(r).toEqual({ ok: false, reason: 'insufficient_balance' })
    db.close()
  })
})
