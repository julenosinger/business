/**
 * Conciliação entre o Livro-Caixa (fonte de movimento de caixa) e o razão contábil.
 * Não altera dados: apenas relata divergências. Registros históricos sem moeda conhecida são
 * sinalizados (`unknown_currency`), nunca convertidos.
 */
import type { CurrencyCode } from '../types'
import { accountByCode, accountBySubtype } from './chart'
import { fromNumber } from './money'
import { isReversed, postEvent, type Ctx } from './engine'
import type { EventDraft, LedgerState } from './types'
import { cashBookEvent } from './adapters'

export interface CashRow {
  id: string
  type: 'in' | 'out'
  amount: number
  date: string
  category: string
  description?: string
}

export interface ReconciliationReport {
  balanced: boolean
  unbalancedEntries: string[]
  events: { pending: number; failed: number; rejected: number }
  ledgered: number
  legacyUnledgered: { id: string; reason: 'unknown_currency' }[]
  missingCash: string[]
  mismatches: { cashEntryId: string; ledgerMinor: string; cashMinor: string }[]
  duplicates: string[]
  clean: boolean
}

export function reconcileCashBook(ledger: LedgerState, cash: CashRow[]): ReconciliationReport {
  const cashAccount = accountBySubtype(ledger, 'cash')
  const unbalancedEntries: string[] = []
  for (const j of ledger.journal) {
    let d = 0n
    let c = 0n
    for (const l of j.lines) {
      if (l.side === 'debit') d += BigInt(l.amountMinor)
      else c += BigInt(l.amountMinor)
    }
    if (d !== c) unbalancedEntries.push(j.id)
  }

  const byCash = new Map<string, typeof ledger.journal>()
  for (const j of ledger.journal) {
    const id = j.links.cashEntryId
    if (!id) continue
    byCash.set(id, [...(byCash.get(id) ?? []), j])
  }

  const cashById = new Map(cash.map((c) => [c.id, c]))
  const mismatches: ReconciliationReport['mismatches'] = []
  const missingCash: string[] = []
  const duplicates: string[] = []

  for (const [cashId, entries] of byCash) {
    const active = entries.filter((e) => !e.reversalOf && !isReversed(ledger, e.id))
    if (active.length > 1) duplicates.push(cashId)
    let net = 0n
    for (const e of entries) {
      for (const l of e.lines) {
        const acct = accountByCode(ledger, l.accountCode)
        if (acct?.subtype === 'cash' || (cashAccount && l.accountCode === cashAccount.code)) {
          net += l.side === 'debit' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor)
        }
      }
    }
    const row = cashById.get(cashId)
    const currency: CurrencyCode = entries[0]?.currency ?? 'USDC'
    if (!row) {
      if (net !== 0n) missingCash.push(cashId)
      continue
    }
    const minor = fromNumber(row.amount, currency)
    const expected = minor === null ? 0n : row.type === 'in' ? minor : -minor
    if (expected !== net) mismatches.push({ cashEntryId: cashId, ledgerMinor: net.toString(), cashMinor: expected.toString() })
  }

  const legacyUnledgered = cash.filter((c) => !byCash.has(c.id)).map((c) => ({ id: c.id, reason: 'unknown_currency' as const }))
  const events = {
    pending: ledger.events.filter((e) => e.status === 'pending').length,
    failed: ledger.events.filter((e) => e.status === 'failed').length,
    rejected: ledger.events.filter((e) => e.status === 'rejected').length,
  }
  const balanced = unbalancedEntries.length === 0
  return {
    balanced,
    unbalancedEntries,
    events,
    ledgered: byCash.size,
    legacyUnledgered,
    missingCash,
    mismatches,
    duplicates,
    clean: balanced && missingCash.length === 0 && mismatches.length === 0 && duplicates.length === 0,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Importação histórica (dry-run primeiro; moeda informada explicitamente, nunca presumida)
// ---------------------------------------------------------------------------------------------------------------------

export interface ImportPlan {
  currency: CurrencyCode
  candidates: { cashId: string; draft: EventDraft }[]
  alreadyLedgered: string[]
  invalid: { id: string; reason: string }[]
}

export function planHistoricalImport(ledger: LedgerState, cash: CashRow[], opts: { currency: CurrencyCode; ids?: string[] }): ImportPlan {
  const plan: ImportPlan = { currency: opts.currency, candidates: [], alreadyLedgered: [], invalid: [] }
  const wanted = opts.ids ? new Set(opts.ids) : null
  for (const row of cash) {
    if (wanted && !wanted.has(row.id)) continue
    const key = `cashbook:${row.id}:r0`
    if (ledger.events.some((e) => e.idempotencyKey === key && e.status === 'posted') || ledger.journal.some((j) => j.links.cashEntryId === row.id)) {
      plan.alreadyLedgered.push(row.id)
      continue
    }
    const res = cashBookEvent(ledger, row, { currency: opts.currency, revision: 0, forceEnabled: true, imported: true })
    if (!res.ok) plan.invalid.push({ id: row.id, reason: res.reason })
    else plan.candidates.push({ cashId: row.id, draft: res.draft })
  }
  return plan
}

export function applyHistoricalImport(ledger: LedgerState, plan: ImportPlan, ctx: Ctx): { ledger: LedgerState; posted: number; duplicates: number; rejected: number } {
  let next = ledger
  let posted = 0
  let duplicates = 0
  let rejected = 0
  for (const c of plan.candidates) {
    const r = postEvent(next, c.draft, ctx)
    next = r.ledger
    if (!r.ok) rejected += 1
    else if (r.duplicate) duplicates += 1
    else posted += 1
  }
  return { ledger: next, posted, duplicates, rejected }
}
