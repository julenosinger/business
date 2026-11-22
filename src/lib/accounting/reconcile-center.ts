/**
 * Centro de Conciliação (somente leitura): compara razão x Livro-Caixa x contas a pagar/receber x tesouraria.
 *
 * Estados: matched (conferido) / pending (pendente) / mismatch (divergência) / review (requer revisão).
 * Regras de segurança:
 * - Nada aqui altera saldos nem gera pagamentos; as decisões humanas ficam em `ledger.reviews` (ver reviews.ts).
 * - Uma operação de tesouraria/USDC NUNCA é tratada como liquidada sem confirmação humana registrada.
 * - Registros anteriores ao razão (sem moeda registrada) aparecem como "requer revisão", sem conversão.
 */
import type { AppData, CurrencyCode } from '../types'
import { accountByCode } from './chart'
import { fromNumber } from './money'
import { hasActiveObligation } from './autopost'
import { isReversed } from './engine'
import { EVENT_ITEM_PREFIX, latestReview } from './reviews'
import type { FinancialEvent, JournalEntry, ReviewRecord } from './types'

export type ReconState = 'matched' | 'pending' | 'mismatch' | 'review'
export type ReconGroup = 'cashbook' | 'sales' | 'purchases' | 'obligations' | 'treasury' | 'fees' | 'integrity'
export type ReconReason =
  | 'ok'
  | 'legacy_unledgered'
  | 'amount_mismatch'
  | 'duplicate_posting'
  | 'duplicate_candidate'
  | 'removed_record'
  | 'sale_canceled_unreversed'
  | 'sale_missing'
  | 'purchase_missing'
  | 'obligation_missing'
  | 'settlement_missing'
  | 'pending_confirmation'
  | 'no_evidence'
  | 'needs_classification'
  | 'partial_payment'
  | 'outstanding_balance'
  | 'fee_estimated'
  | 'unbalanced'
  | 'event_rejected'

export interface ReconItem {
  key: string
  group: ReconGroup
  state: ReconState
  reason: ReconReason
  /** Rótulo do registro de origem (descrição); a interface traduz o motivo. */
  label: string
  date?: string
  amount?: number
  currency?: CurrencyCode
  refs: { entryId?: string; accountId?: string; saleId?: string; purchaseId?: string; opId?: string; journalId?: string; eventKey?: string; txHash?: string; explorerUrl?: string }
  resolved?: ReviewRecord
}

export interface ReconSummary {
  matched: number
  pending: number
  mismatch: number
  review: number
  resolved: number
  total: number
}

const eventFor = (events: FinancialEvent[], key: string): FinancialEvent | undefined => events.find((e) => e.idempotencyKey === key)

export function buildReconciliation(data: AppData): ReconItem[] {
  const ledger = data.ledger
  const flags = ledger.flags.adapters
  const items: ReconItem[] = []
  const add = (it: Omit<ReconItem, 'resolved'>): void => {
    const review = latestReview(ledger, it.key)
    items.push({ ...it, ...(review && review.decision === 'dismissed' ? { resolved: review } : {}) })
  }

  // ----- Livro-Caixa x razão ----------------------------------------------------------------------------------------
  const byCash = new Map<string, JournalEntry[]>()
  for (const j of ledger.journal) {
    const id = j.links.cashEntryId
    if (id) byCash.set(id, [...(byCash.get(id) ?? []), j])
  }
  const cashIds = new Set(data.entries.map((e) => e.id))
  const cashNet = (js: JournalEntry[]): bigint => {
    let net = 0n
    for (const j of js) {
      for (const l of j.lines) {
        if (accountByCode(ledger, l.accountCode)?.subtype === 'cash') net += l.side === 'debit' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor)
      }
    }
    return net
  }
  // Registros de caixa já associados a um evento pendente (ex.: baixa via USDC aguardando confirmação).
  const awaiting = new Set(ledger.events.filter((ev) => ev.status === 'pending' && typeof ev.payload.cashEntryId === 'string').map((ev) => ev.payload.cashEntryId as string))
  for (const e of data.entries) {
    const base = { key: `cashbook:${e.id}`, group: 'cashbook' as const, label: e.description || e.category, date: e.date, amount: e.amount, refs: { entryId: e.id } }
    const js = byCash.get(e.id)
    if (!js) {
      if (awaiting.has(e.id)) add({ ...base, state: 'pending', reason: 'pending_confirmation' })
      else add({ ...base, state: 'review', reason: 'legacy_unledgered' })
      continue
    }
    const currency = js[0]?.currency ?? 'USDC'
    const active = js.filter((j) => !j.reversalOf && !isReversed(ledger, j.id))
    const minor = fromNumber(e.amount, currency)
    const expected = minor === null ? 0n : e.type === 'in' ? minor : -minor
    const refs = { ...base.refs, journalId: active[0]?.id ?? js[0]?.id }
    if (active.length > 1) add({ ...base, currency, refs, state: 'mismatch', reason: 'duplicate_posting' })
    else if (cashNet(js) !== expected) add({ ...base, currency, refs, state: 'mismatch', reason: 'amount_mismatch' })
    else add({ ...base, currency, refs, state: 'matched', reason: 'ok' })
  }
  for (const [cashId, js] of byCash) {
    if (cashIds.has(cashId)) continue
    if (cashNet(js) !== 0n) add({ key: `cashbook:${cashId}:orphan`, group: 'cashbook', state: 'mismatch', reason: 'removed_record', label: cashId, refs: { entryId: cashId, journalId: js[0]?.id }, currency: js[0]?.currency })
  }
  // Candidatos a duplicidade no próprio Livro-Caixa (mesma data, tipo, valor, categoria e descrição).
  const seen = new Map<string, string>()
  for (const e of data.entries) {
    const sig = `${e.date}|${e.type}|${e.amount}|${e.category}|${e.description}`
    const first = seen.get(sig)
    if (first === undefined) seen.set(sig, e.id)
    else add({ key: `dup:${e.id}`, group: 'cashbook', state: 'review', reason: 'duplicate_candidate', label: e.description || e.category, date: e.date, amount: e.amount, refs: { entryId: e.id } })
  }

  // ----- Vendas ------------------------------------------------------------------------------------------------------
  if (flags.sales) {
    for (const s of data.sales) {
      const ev = eventFor(ledger.events, `sale:${s.id}:recorded`)
      const base = { key: `sale:${s.id}`, group: 'sales' as const, label: s.customerName, date: s.date, amount: s.total, refs: { saleId: s.id } }
      if (!ev) {
        add({ ...base, state: 'review', reason: 'sale_missing' })
        continue
      }
      const refs = { ...base.refs, journalId: ev.journalEntryId }
      const currency = ev.currency
      if (ev.status === 'rejected' || ev.status === 'failed') add({ ...base, currency, refs, state: 'review', reason: 'event_rejected' })
      else if (s.canceledAt && ev.journalEntryId && !isReversed(ledger, ev.journalEntryId)) add({ ...base, currency, refs, state: 'review', reason: 'sale_canceled_unreversed' })
      else if (!s.canceledAt && BigInt(ev.amountMinor) !== (fromNumber(s.total, currency) ?? -1n)) add({ ...base, currency, refs, state: 'mismatch', reason: 'amount_mismatch' })
      else add({ ...base, currency, refs, state: 'matched', reason: 'ok' })
    }
  }

  // ----- Compras -----------------------------------------------------------------------------------------------------
  for (const p of data.purchases) {
    const base = { key: `purchase:${p.id}`, group: 'purchases' as const, label: p.supplierName, date: p.date, amount: p.total, refs: { purchaseId: p.id } }
    const ev = eventFor(ledger.events, `purchase:${p.id}:recorded`)
    if (!p.stockPosted) add({ ...base, state: 'pending', reason: 'pending_confirmation' }) // aguarda o recebimento da mercadoria
    else if (!ev) add({ ...base, state: 'review', reason: 'purchase_missing' })
    else if (ev.status !== 'posted') add({ ...base, currency: ev.currency, state: 'review', reason: 'event_rejected', refs: base.refs })
    else add({ ...base, currency: ev.currency, state: BigInt(ev.amountMinor) === (fromNumber(p.total, ev.currency) ?? -1n) ? 'matched' : 'mismatch', reason: BigInt(ev.amountMinor) === (fromNumber(p.total, ev.currency) ?? -1n) ? 'ok' : 'amount_mismatch', refs: { ...base.refs, journalId: ev.journalEntryId } })
  }

  // ----- Contas a pagar/receber ----------------------------------------------------------------------------------------
  for (const a of data.accounts) {
    const enabled = a.source === 'payroll' ? flags.payroll : flags.payables
    if (!enabled) continue
    const paid = (a.settlements ?? []).reduce((s, x) => s + x.amount, 0)
    const outstanding = Math.round((a.amount - paid) * 100) / 100
    const base = { key: `account:${a.id}`, group: 'obligations' as const, label: a.description, date: a.paidAt ?? a.dueDate, amount: outstanding, refs: { accountId: a.id } }
    if (!hasActiveObligation(ledger, a.id)) {
      add({ ...base, state: 'review', reason: 'obligation_missing' })
      continue
    }
    const creation = ledger.events.find((e) => e.status === 'posted' && e.payload.accountId === a.id && !!e.journalEntryId && !isReversed(ledger, e.journalEntryId))
    const currency = creation?.currency
    if (creation && BigInt(creation.amountMinor) !== (fromNumber(a.amount, creation.currency) ?? -1n)) {
      add({ ...base, ...(currency ? { currency } : {}), state: 'mismatch', reason: 'amount_mismatch' })
      continue
    }
    const settlements = a.settlements ?? []
    const evidence = a.treasuryTx ? { explorerUrl: a.treasuryTx } : {}
    if (settlements.length === 0) {
      if (a.status === 'open') {
        add({ ...base, ...(currency ? { currency } : {}), state: 'matched', reason: 'ok' })
        continue
      }
      // Liquidação legada (sem lista de liquidações): mantém a verificação antiga da sequência 1.
      const settle = eventFor(ledger.events, `account:${a.id}:settle:1`)
      if (!settle) add({ ...base, ...(currency ? { currency } : {}), state: 'review', reason: 'settlement_missing' })
      else if (settle.status === 'pending') add({ ...base, key: `${EVENT_ITEM_PREFIX}${settle.idempotencyKey}`, ...(currency ? { currency } : {}), refs: { ...base.refs, eventKey: settle.idempotencyKey, ...evidence }, state: 'pending', reason: 'pending_confirmation' })
      else if (settle.status === 'posted') add({ ...base, ...(currency ? { currency } : {}), refs: { ...base.refs, journalId: settle.journalEntryId, ...evidence }, state: 'matched', reason: 'ok' })
      else add({ ...base, ...(currency ? { currency } : {}), state: 'review', reason: 'event_rejected' })
      continue
    }
    // Liquidações (parciais ou totais): cada uma deve ter um evento correspondente.
    let missing = 0
    let pending = 0
    const firstPending = settlements.map((s) => eventFor(ledger.events, `account:${a.id}:settle:${s.sequence}`)).find((e) => e?.status === 'pending')
    for (const s of settlements) {
      const ev = eventFor(ledger.events, `account:${a.id}:settle:${s.sequence}`)
      if (!ev) missing += 1
      else if (ev.status === 'pending') pending += 1
    }
    if (missing > 0) add({ ...base, ...(currency ? { currency } : {}), state: 'review', reason: 'settlement_missing' })
    else if (pending > 0 && firstPending) add({ ...base, key: `${EVENT_ITEM_PREFIX}${firstPending.idempotencyKey}`, ...(currency ? { currency } : {}), refs: { ...base.refs, eventKey: firstPending.idempotencyKey, ...evidence }, state: 'pending', reason: 'pending_confirmation' })
    else if (a.status === 'open') add({ ...base, ...(currency ? { currency } : {}), state: 'pending', reason: 'partial_payment' })
    else add({ ...base, ...(currency ? { currency } : {}), state: 'matched', reason: 'ok' })
  }

  // ----- Tesouraria (Circle Gateway) -----------------------------------------------------------------------------------
  for (const op of data.treasuryOps) {
    const refs = { opId: op.id, ...(op.txHash ? { txHash: op.txHash } : {}), ...(op.explorerUrl ? { explorerUrl: op.explorerUrl } : {}) }
    const base = { key: `treasury:${op.id}`, group: 'treasury' as const, label: op.note || op.kind, date: op.date, amount: Number(op.amount) || 0, currency: 'USDC' as const, refs }
    if (op.accountId) continue // acompanhado pela baixa da conta (item de obrigações)
    if (op.kind !== 'deposit') {
      add({ ...base, state: 'review', reason: 'needs_classification' })
      continue
    }
    if (!flags.treasury) {
      add({ ...base, state: 'review', reason: 'legacy_unledgered' })
      continue
    }
    if (!op.txHash) {
      add({ ...base, state: 'review', reason: 'no_evidence' })
      continue
    }
    const ev = ledger.events.find((e) => e.payload.opId === op.id)
    if (!ev) add({ ...base, state: 'review', reason: 'legacy_unledgered' })
    else if (ev.status === 'pending') add({ ...base, key: `${EVENT_ITEM_PREFIX}${ev.idempotencyKey}`, refs: { ...refs, eventKey: ev.idempotencyKey }, state: 'pending', reason: 'pending_confirmation' })
    else if (ev.status === 'posted') add({ ...base, refs: { ...refs, journalId: ev.journalEntryId }, state: 'matched', reason: 'ok' })
    else add({ ...base, state: 'review', reason: 'event_rejected' })
  }

  // ----- Taxas ---------------------------------------------------------------------------------------------------------
  for (const f of ledger.fees) {
    const key = `fee:${f.dedupeKey}`
    const amount = Number(f.amountMinor) / 10 ** (f.currency === 'USDC' ? 6 : 2)
    const common = { key, group: 'fees' as const, label: `${f.kind} · ${f.source.module}`, date: f.confirmedAt?.slice(0, 10) ?? f.createdAt.slice(0, 10), amount, currency: f.currency, refs: { ...(f.relatedRef ? { txHash: f.relatedRef } : {}) } }
    add({ ...common, state: f.status === 'estimated' ? 'pending' : 'matched', reason: f.status === 'estimated' ? 'fee_estimated' : 'ok' })
  }

  // ----- Integridade -----------------------------------------------------------------------------------------------------
  for (const j of ledger.journal) {
    let d = 0n
    let c = 0n
    for (const l of j.lines) {
      if (l.side === 'debit') d += BigInt(l.amountMinor)
      else c += BigInt(l.amountMinor)
    }
    if (d !== c) add({ key: `je:${j.id}`, group: 'integrity', state: 'mismatch', reason: 'unbalanced', label: j.memo, date: j.accountingDate, currency: j.currency, refs: { journalId: j.id } })
  }
  for (const e of ledger.events) {
    if ((e.status === 'rejected' || e.status === 'failed') && !items.some((i) => i.refs.eventKey === e.idempotencyKey)) {
      add({ key: `rej:${e.idempotencyKey}`, group: 'integrity', state: 'review', reason: 'event_rejected', label: `${e.type} · ${e.error ?? ''}`, date: e.accountingDate, currency: e.currency, refs: { eventKey: e.idempotencyKey } })
    }
  }
  return items
}

export function summarize(items: ReconItem[]): ReconSummary {
  const s: ReconSummary = { matched: 0, pending: 0, mismatch: 0, review: 0, resolved: 0, total: items.length }
  for (const it of items) {
    if (it.resolved) s.resolved += 1
    else s[it.state] += 1
  }
  return s
}
