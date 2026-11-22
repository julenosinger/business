import { describe, expect, test } from 'bun:test'
import { createApi, UnauthorizedError } from '../server/api'
import { LedgerDb } from '../server/db'
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
    const r = api.postEvent('Bearer secret', draft())
    expect(r.ok).toBe(true)
    const ledger = api.getLedger('Bearer secret')
    expect(ledger.journal).toHaveLength(1)
    expect(ledger.events).toHaveLength(1)
    db.close()
  })

  test('idempotência: a mesma chave nunca duplica lançamento', () => {
    const db = new LedgerDb(':memory:')
    const api = createApi(db, { token: 'secret', orgId: 'local' })
    expect(api.postEvent('Bearer secret', draft('same')).ok).toBe(true)
    const again = api.postEvent('Bearer secret', draft('same'))
    if (!again.ok) throw new Error('expected ok')
    expect(again.duplicate).toBe(true)
    expect(api.getLedger('Bearer secret').journal).toHaveLength(1)
    db.close()
  })

  test('recordSettlement: constraint UNIQUE impede liquidação duplicada', () => {
    const db = new LedgerDb(':memory:')
    const api = createApi(db, { token: 'secret', orgId: 'local' })
    expect(api.recordSettlement('Bearer secret', { settlementId: 's1', opId: 'op1', payload: '{}' })).toEqual({ ok: true })
    expect(api.recordSettlement('Bearer secret', { settlementId: 's1', opId: 'op1', payload: '{}' })).toEqual({ ok: false, conflict: true })
    db.close()
  })

  test('rollback: draft inválido não posta nada', () => {
    const db = new LedgerDb(':memory:')
    const api = createApi(db, { token: 'secret', orgId: 'local' })
    const r = api.postEvent('Bearer secret', draft('bad', { amountMinor: '-1' }))
    expect(r.ok).toBe(false)
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
