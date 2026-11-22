/**
 * Revisões humanas da conciliação e registro de taxas de câmbio informadas.
 * Nada aqui roda sozinho: toda decisão tem ator humano, nota e (quando aplicável) evidência informada.
 * O app NÃO verifica transações on-chain; a evidência é declarada por quem revisa e fica na auditoria.
 */
import { fxConvert, isCurrency, parseRate, type ConvertedMoney } from './money'
import { settlePendingEvent, withAudit, type Ctx, type OpResult } from './engine'
import type { CurrencyCode } from '../types'
import type { LedgerState, PostErrorCode, ReviewDecision, ReviewRecord, StoredFxRate } from './types'

const nextId = (items: { id: string }[], prefix: string): string => {
  let max = 0
  for (const it of items) {
    const n = Number(it.id.startsWith(`${prefix}-`) ? it.id.slice(prefix.length + 1) : NaN)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}-${String(max + 1).padStart(6, '0')}`
}

const cleanText = (s: string, max: number): string => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export const EVENT_ITEM_PREFIX = 'event:'

export interface ReviewInput {
  itemKey: string
  decision: ReviewDecision
  note: string
  evidence?: { txHash?: string; explorerUrl?: string }
}

export const latestReview = (ledger: LedgerState, itemKey: string): ReviewRecord | undefined => {
  let found: ReviewRecord | undefined
  for (const r of ledger.reviews) if (r.itemKey === itemKey) found = r
  return found
}

/**
 * Registra a decisão. Para itens `event:<chave>` pendentes, "confirmed" lança o evento (uma única vez) e
 * "failed" o encerra sem lançar. Revisão de item que não é evento só documenta ("dismissed").
 */
export function recordReview(ledger: LedgerState, input: ReviewInput, ctx: Ctx): OpResult<{ reviewId: string; entryId: string | null }> {
  if (ctx.actor.kind !== 'user') return { ok: false, ledger: withAudit(ledger, ctx, 'event.rejected', 'review denied: actor is not a user'), errors: ['not_authorized'] }
  const note = cleanText(input.note, 300)
  const txHash = input.evidence?.txHash ? cleanText(input.evidence.txHash, 100) : ''
  const explorerUrl = input.evidence?.explorerUrl ? cleanText(input.evidence.explorerUrl, 300) : ''
  if (!input.itemKey.trim()) return { ok: false, ledger, errors: ['invalid_review'] }
  if (input.decision === 'confirmed' && !txHash && note.length < 3) return { ok: false, ledger, errors: ['invalid_review'] }
  if (input.decision !== 'confirmed' && note.length < 3) return { ok: false, ledger, errors: ['invalid_review'] }
  if (explorerUrl && !/^https:\/\//i.test(explorerUrl)) return { ok: false, ledger, errors: ['invalid_review'] }

  let working = ledger
  let entryId: string | null = null
  if (input.itemKey.startsWith(EVENT_ITEM_PREFIX) && input.decision !== 'dismissed') {
    const key = input.itemKey.slice(EVENT_ITEM_PREFIX.length)
    const settled = settlePendingEvent(ledger, key, input.decision === 'confirmed' ? 'confirmed' : 'failed', ctx)
    if (!settled.ok) return { ok: false, ledger: settled.ledger, errors: settled.errors }
    if (settled.duplicate) return { ok: false, ledger: settled.ledger, errors: ['not_pending'] as PostErrorCode[] }
    working = settled.ledger
    entryId = settled.entryId
  } else if (input.decision !== 'dismissed') {
    return { ok: false, ledger, errors: ['invalid_review'] }
  }
  const record: ReviewRecord = {
    id: nextId(working.reviews, 'RV'),
    itemKey: input.itemKey,
    decision: input.decision,
    note,
    ...(txHash || explorerUrl ? { evidence: { ...(txHash ? { txHash } : {}), ...(explorerUrl ? { explorerUrl } : {}) } } : {}),
    actor: ctx.actor,
    at: ctx.now,
  }
  const next = withAudit({ ...working, reviews: [...working.reviews, record] }, ctx, 'review.recorded', `${record.id} ${record.decision} ${record.itemKey}`.slice(0, 200), entryId ? { entryId } : {})
  return { ok: true, ledger: next, value: { reviewId: record.id, entryId } }
}

// ---------------------------------------------------------------------------------------------------------------------
// Taxas de câmbio informadas (para exibição em moeda de relatório; nunca aplicadas implicitamente)
// ---------------------------------------------------------------------------------------------------------------------

export interface FxInput {
  from: CurrencyCode
  to: CurrencyCode
  rate: string
  source: string
  at: string
}

export function recordFxRate(ledger: LedgerState, input: FxInput, ctx: Ctx): OpResult<{ id: string }> {
  if (ctx.actor.kind !== 'user') return { ok: false, ledger, errors: ['not_authorized'] }
  const source = cleanText(input.source, 80)
  if (!isCurrency(input.from) || !isCurrency(input.to) || input.from === input.to) return { ok: false, ledger, errors: ['invalid_fx'] }
  if (!parseRate(input.rate) || !source || Number.isNaN(Date.parse(input.at))) return { ok: false, ledger, errors: ['invalid_fx'] }
  const rec: StoredFxRate = { id: nextId(ledger.fxRates, 'FX'), from: input.from, to: input.to, rate: input.rate.trim(), source, at: input.at, recordedBy: ctx.actor }
  return { ok: true, ledger: withAudit({ ...ledger, fxRates: [...ledger.fxRates, rec] }, ctx, 'fx.recorded', `${rec.from}->${rec.to} ${rec.rate} (${rec.source})`), value: { id: rec.id } }
}

/** Taxa mais recente registrada até o fim do dia da data contábil; null se não houver (nunca presume). */
export function findFxRate(ledger: LedgerState, from: CurrencyCode, to: CurrencyCode, onDate: string): StoredFxRate | null {
  const limit = `${onDate}T23:59:59.999Z`
  let best: StoredFxRate | null = null
  for (const r of ledger.fxRates) {
    if (r.from === from && r.to === to && r.at <= limit && (!best || r.at > best.at)) best = r
  }
  return best
}

/** Converte para a moeda de relatório SOMENTE com taxa registrada; caso contrário retorna null (exibir "indisponível"). */
export function convertForReporting(ledger: LedgerState, amountMinor: bigint, from: CurrencyCode, to: CurrencyCode, onDate: string): ConvertedMoney | null {
  if (from === to) return null
  const rate = findFxRate(ledger, from, to, onDate)
  if (!rate) return null
  const out = fxConvert(amountMinor, from, { from: rate.from, to: rate.to, rate: rate.rate, source: rate.source, at: rate.at })
  return 'error' in out ? null : out
}
