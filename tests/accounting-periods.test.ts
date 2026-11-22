import { describe, expect, test } from 'bun:test'
import { closePeriod, emptyLedger, isDateClosed, normalizeLedger, periodKeyOf, postEvent, reopenPeriod, reverseEntry, setPeriodReview, type Ctx } from '../src/lib/accounting/engine'
import type { EventDraft } from '../src/lib/accounting/types'

const NOW = '2026-11-22T10:00:00.000Z'
const user = { id: 'u1', kind: 'user' as const }
const agent = { id: 'a1', kind: 'agent' as const }
const ctx: Ctx = { now: NOW, actor: user }

function draft(over: Partial<EventDraft> = {}): EventDraft {
  return {
    orgId: 'local',
    idempotencyKey: `k-${Math.random().toString(36).slice(2)}`,
    type: 'cashbook.income',
    source: { module: 'cashbook', recordId: 'c1' },
    occurredAt: NOW,
    accountingDate: '2026-11-22',
    currency: 'BRL',
    amountMinor: '10050',
    payload: { category: 'Outras receitas', description: 'x', cashEntryId: 'c1' },
    confirmation: 'confirmed',
    ...over,
  }
}

describe('accounting periods', () => {
  test('período ausente é aberto; fechamento é explícito', () => {
    const l = emptyLedger()
    expect(isDateClosed(l, '2026-11-22')).toBe(false)
    expect(periodKeyOf('2026-11-22')).toBe('2026-11')
  })

  test('postEvent bloqueia lançamento em período fechado, com auditoria', () => {
    let l = emptyLedger()
    const r = closePeriod(l, '2026-11', ctx)
    expect(r.ok).toBe(true)
    l = r.ledger
    expect(isDateClosed(l, '2026-11-30')).toBe(true)
    // Outro mês continua aberto.
    expect(isDateClosed(l, '2026-12-01')).toBe(false)

    const before = l.audit.length
    const posted = postEvent(l, draft(), ctx)
    expect(posted.ok).toBe(false)
    expect(posted.errors).toContain('period_closed')
    expect(posted.ledger.audit.length).toBeGreaterThan(before) // tentativa registrada
    expect(posted.ledger.journal.length).toBe(0)
  })

  test('reverseEntry bloqueia estorno em período fechado', () => {
    let l = emptyLedger()
    const posted = postEvent(l, draft(), ctx)
    expect(posted.ok).toBe(true)
    l = posted.ledger
    const entryId = posted.entryId!
    l = closePeriod(l, '2026-11', ctx).ledger
    const rev = reverseEntry(l, entryId, 'corrigir', ctx)
    expect(rev.ok).toBe(false)
    expect(rev.errors).toContain('period_closed')
    // Reabre e o estorno volta a funcionar.
    l = reopenPeriod(l, '2026-11', 'ajuste autorizado', ctx).ledger
    const rev2 = reverseEntry(l, entryId, 'corrigir', ctx)
    expect(rev2.ok).toBe(true)
  })

  test('reopen exige motivo e usuário; close é idempotente', () => {
    let l = closePeriod(emptyLedger(), '2026-10', ctx).ledger
    expect(reopenPeriod(l, '2026-10', 'x', ctx).ok).toBe(false) // motivo curto
    expect(reopenPeriod(l, '2026-10', 'correção', { now: NOW, actor: agent }).ok).toBe(false) // agente
    const re = reopenPeriod(l, '2026-10', 'correção', ctx)
    expect(re.ok).toBe(true)
    l = re.ledger
    expect(isDateClosed(l, '2026-10-05')).toBe(false)
    // fechar de novo é idempotente
    expect(closePeriod(l, '2026-10', ctx).ok).toBe(true)
  })

  test('review é um marco e não bloqueia lançamentos', () => {
    let l = setPeriodReview(emptyLedger(), '2026-11', ctx).ledger
    expect(isDateClosed(l, '2026-11-22')).toBe(false)
    const posted = postEvent(l, draft(), ctx)
    expect(posted.ok).toBe(true)
  })

  test('normalizeLedger preserva períodos', () => {
    const l = closePeriod(emptyLedger(), '2026-09', ctx).ledger
    const n = normalizeLedger({ periods: l.periods })
    expect(isDateClosed(n, '2026-09-15')).toBe(true)
  })

  test('agente não pode fechar nem reabrir período', () => {
    const actx: Ctx = { now: NOW, actor: agent }
    expect(closePeriod(emptyLedger(), '2026-11', actx).ok).toBe(false)
    const l = closePeriod(emptyLedger(), '2026-11', ctx).ledger
    expect(reopenPeriod(l, '2026-11', 'motivo', actx).ok).toBe(false)
  })
})
