import { describe, expect, test } from 'bun:test'
import { createApi, UnauthorizedError } from '../server/api'
import { LedgerDb } from '../server/db'
import { importLedger, previewLedger } from '../server/migrate'
import { settleOperation } from '../server/settle'
import { emptyLedger } from '../src/lib/accounting/engine'
import type { EventDraft } from '../src/lib/accounting/types'

const draft = (key = 'k1', over: Partial<EventDraft> = {}): EventDraft => ({
  orgId: 'local',
  idempotencyKey: key,
  type: 'cashbook.income',
  source: { module: 'cashbook', recordId: 'c1' },
  occurredAt: '2026-11-22T10:00:00.000Z',
  accountingDate: '2026-11-22',
  currency: 'BRL',
  amountMinor: '10050',
  payload: { category: 'Outras receitas', description: 'x', cashEntryId: 'c1' },
  confirmation: 'confirmed',
  ...over,
})

const obligationDraft = (accountId = 'a1', amountMinor = '1000000000'): EventDraft => ({
  orgId: 'local',
  idempotencyKey: `obligation:${accountId}`,
  type: 'payable.created',
  source: { module: 'payables', recordId: accountId },
  occurredAt: '2026-11-22T10:00:00.000Z',
  accountingDate: '2026-11-22',
  currency: 'USDC',
  amountMinor,
  payload: { accountId, category: 'Aluguel' },
  confirmation: 'confirmed',
})

const confirmed = async () => ({ state: 'confirmed' as const })
const pending = async () => ({ state: 'pending' as const })

describe('backend transacional (SQLite real, em memória)', () => {
  test('autenticação de dono único (Bearer token)', () => {
    const db = new LedgerDb(':memory:')
    const api = createApi(db, { token: 'secret', orgId: 'local' })
    expect(() => api.getLedger(undefined)).toThrow(UnauthorizedError)
    expect(() => api.getLedger('Bearer errado')).toThrow(UnauthorizedError)
    expect(api.getLedger('Bearer secret')).toBeTruthy()
    db.close()
  })

  test('postEvent persiste atomicamente e GET lê o razão', () => {
    const db = new LedgerDb(':memory:')
    const api = createApi(db, { token: 'secret', orgId: 'local' })
    expect(api.postEvent('Bearer secret', draft()).ok).toBe(true)
    const ledger = api.getLedger('Bearer secret')
    expect(ledger.journal).toHaveLength(1)
    db.close()
  })

  test('idempotência de evento: a mesma chave nunca duplica lançamento', () => {
    const db = new LedgerDb(':memory:')
    const api = createApi(db, { token: 'secret', orgId: 'local' })
    expect(api.postEvent('Bearer secret', draft('same')).ok).toBe(true)
    const again = api.postEvent('Bearer secret', draft('same'))
    if (!again.ok) throw new Error('expected ok')
    expect(again.duplicate).toBe(true)
    expect(api.getLedger('Bearer secret').journal).toHaveLength(1)
    db.close()
  })

  test('rollback: draft inválido não posta nada', () => {
    const db = new LedgerDb(':memory:')
    const api = createApi(db, { token: 'secret', orgId: 'local' })
    expect(api.postEvent('Bearer secret', draft('bad', { amountMinor: '-1' })).ok).toBe(false)
    expect(api.getLedger('Bearer secret').journal).toHaveLength(0)
    db.close()
  })

  test('org mismatch é recusado (isolamento por organização)', () => {
    const db = new LedgerDb(':memory:')
    const api = createApi(db, { token: 'secret', orgId: 'local' })
    expect(() => api.postEvent('Bearer secret', draft('x', { orgId: 'intruso' }))).toThrow('org_mismatch')
    db.close()
  })
})

describe('liquidação atômica server-side', () => {
  const setup = (): LedgerDb => {
    const db = new LedgerDb(':memory:')
    const api = createApi(db, { token: 'secret', orgId: 'local' })
    const r = api.postEvent('Bearer secret', obligationDraft())
    if (!r.ok) throw new Error('obligation post failed')
    return db
  }

  const input = (over: Partial<Parameters<typeof settleOperation>[2]> = {}) => ({
    opId: 'op1',
    accountId: 'a1',
    txHash: `0x${'a'.repeat(64)}`,
    chainKey: 'Arc',
    recipient: `0x${'b'.repeat(40)}`,
    amount: '300',
    fxDate: '2026-11-22',
    ...over,
  })

  test('liquida parcialmente (300/1000) e posta no razão', async () => {
    const db = setup()
    const r = await settleOperation(db, 'local', input(), confirmed)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.duplicate).toBe(false)
    expect(r.allocatedMinor).toBe('300000000')
    expect(r.excessMinor).toBe('0')
    const ledger = db.loadLedger('local')!
    expect(ledger.events.some((e) => e.type === 'payable.settled' && e.amountMinor === '300000000')).toBe(true)
    db.close()
  })

  test('idempotência: a mesma operação nunca liquida duas vezes', async () => {
    const db = setup()
    await settleOperation(db, 'local', input(), confirmed)
    const again = await settleOperation(db, 'local', input(), confirmed)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.duplicate).toBe(true)
    const ledger = db.loadLedger('local')!
    expect(ledger.events.filter((e) => e.type === 'payable.settled')).toHaveLength(1)
    db.close()
  })

  test('evidência não confirmada → não liquida', async () => {
    const db = setup()
    const r = await settleOperation(db, 'local', input(), pending)
    expect(r).toEqual({ ok: false, error: 'unverified' })
    expect(db.loadLedger('local')!.events.some((e) => e.type === 'payable.settled')).toBe(false)
    db.close()
  })

  test('obrigação inexistente → obrigação ausente, sem liquidação fabricada', async () => {
    const db = new LedgerDb(':memory:')
    const r = await settleOperation(db, 'local', input({ accountId: 'ghost' }), confirmed)
    expect(r).toEqual({ ok: false, error: 'obligation_missing' })
    db.close()
  })

  test('pagamento com excesso aloca o saldo e preserva o excedente', async () => {
    const db = setup()
    const r = await settleOperation(db, 'local', input({ amount: '1300' }), confirmed)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.allocatedMinor).toBe('1000000000') // 1000 USDC (saldo total)
    expect(r.excessMinor).toBe('300000000') // 300 USDC excedente
    db.close()
  })
})

describe('migração segura do localStorage', () => {
  test('prévia e importação idempotente (repetida sem duplicidade)', () => {
    const db = new LedgerDb(':memory:')
    const ledger = emptyLedger('local')
    expect(previewLedger(ledger).orgId).toBe('local')
    const first = importLedger(db, ledger)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.imported).toBe(true)
    // Repetida sem force: recusa (não sobrescreve nem duplica).
    expect(importLedger(db, ledger).ok).toBe(false)
    // O razão importado preserva as contagens originais.
    expect(db.loadLedger('local')!.events).toHaveLength(ledger.events.length)
    db.close()
  })
})
