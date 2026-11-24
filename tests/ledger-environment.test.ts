import { describe, expect, test } from 'bun:test'

// Stubs mínimos para importar store.ts (i18n/localStorage/document).
const g = globalThis as unknown as Record<string, unknown>
const storage: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => void (storage[k] = v), removeItem: (k: string) => void delete storage[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { migrateLedgerEnvironments, emptyData } = await import('../src/lib/store')
const { emptyLedger, closePeriod, isDateClosed, reopenPeriod } = await import('../src/lib/accounting/engine')
import type { FinancialEvent } from '../src/lib/accounting/types'

const ev = (id: string, payload: Record<string, unknown>): FinancialEvent => ({
  id,
  orgId: 'local',
  idempotencyKey: `k-${id}`,
  type: 'cashbook.income',
  source: { module: 'cashbook', recordId: 'x' },
  occurredAt: '2026-11-20T00:00:00.000Z',
  accountingDate: '2026-11-20',
  currency: 'USDC',
  amountMinor: '100',
  payload: payload as FinancialEvent['payload'],
  confirmation: 'confirmed',
  status: 'posted',
  actor: { id: 'u', kind: 'user' },
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  attempts: 1,
  journalEntryId: `je-${id}`,
})

describe('migração do ambiente contábil (FIN-02)', () => {
  test('classifica eventos por vínculo inequívoco e deixa ambíguo sem ambiente', () => {
    const d = emptyData()
    d.accounts = [{ id: 'a1', kind: 'payable', description: 'd', contactName: 'c', amount: 100, dueDate: '2026-12-01', category: 'Aluguel', status: 'open', source: 'manual', environment: 'mainnet' }]
    d.sales = [{ id: 's1', date: '2026-11-20', customerName: 'c', items: [], total: 100, cogs: 50, method: 'pix', environment: 'testnet' }]
    d.entries = [{ id: 'e1', date: '2026-11-20', type: 'in', category: 'Vendas', description: 'd', amount: 10, environment: 'testnet' }]
    d.ledger = {
      ...emptyLedger(),
      events: [
        ev('ev1', { accountId: 'a1' }),
        ev('ev2', { saleId: 's1' }),
        ev('ev3', { cashEntryId: 'e1' }),
        ev('ev4', { chain: 'Arc' }),
        ev('ev5', { chain: 'Arc_Testnet' }),
        ev('ev6', { description: 'sem vínculo' }),
      ],
      journal: [
        { id: 'je-ev1', orgId: 'local', eventId: 'ev1', idempotencyKey: 'k-ev1', accountingDate: '2026-11-20', currency: 'USDC', memo: '', lines: [], postedAt: 'x', postedBy: { id: 'u', kind: 'user' }, links: {} },
        { id: 'je-ev6', orgId: 'local', eventId: 'ev6', idempotencyKey: 'k-ev6', accountingDate: '2026-11-20', currency: 'USDC', memo: '', lines: [], postedAt: 'x', postedBy: { id: 'u', kind: 'user' }, links: {} },
      ],
    }
    const out = migrateLedgerEnvironments(d)
    const env = (id: string) => out.ledger.events.find((e) => e.id === id)?.environment
    expect(env('ev1')).toBe('mainnet')
    expect(env('ev2')).toBe('testnet')
    expect(env('ev3')).toBe('testnet')
    expect(env('ev4')).toBe('mainnet')
    expect(env('ev5')).toBe('testnet')
    expect(env('ev6')).toBeUndefined() // ambíguo permanece
    expect(out.ledger.journal.find((j) => j.id === 'je-ev1')?.environment).toBe('mainnet')
    expect(out.ledger.journal.find((j) => j.id === 'je-ev6')?.environment).toBeUndefined()
  })

  test('migração é idempotente', () => {
    const d = emptyData()
    d.accounts = [{ id: 'a1', kind: 'payable', description: 'd', contactName: 'c', amount: 100, dueDate: '2026-12-01', category: 'Aluguel', status: 'open', source: 'manual', environment: 'mainnet' }]
    d.ledger = { ...emptyLedger(), events: [ev('ev1', { accountId: 'a1' })] }
    const once = migrateLedgerEnvironments(d)
    const twice = migrateLedgerEnvironments(once)
    expect(twice.ledger.events).toEqual(once.ledger.events)
  })
})

describe('períodos contábeis independentes (FIN-02)', () => {
  const ctx = { now: '2026-11-22T10:00:00.000Z', actor: { id: 'u', kind: 'user' as const } }

  test('fechamento Mainnet não bloqueia Testnet (e vice-versa)', () => {
    let l = emptyLedger()
    l = closePeriod(l, '2026-11', 'mainnet', ctx).ledger
    expect(isDateClosed(l, '2026-11-22', 'mainnet')).toBe(true)
    expect(isDateClosed(l, '2026-11-22', 'testnet')).toBe(false)
    l = closePeriod(l, '2026-11', 'testnet', ctx).ledger
    expect(isDateClosed(l, '2026-11-22', 'testnet')).toBe(true)
    expect(isDateClosed(l, '2026-11-22', 'mainnet')).toBe(true)
    // Reabre apenas a Testnet.
    l = reopenPeriod(l, '2026-11', 'ajuste', 'testnet', ctx).ledger
    expect(isDateClosed(l, '2026-11-22', 'testnet')).toBe(false)
    expect(isDateClosed(l, '2026-11-22', 'mainnet')).toBe(true)
  })
})
