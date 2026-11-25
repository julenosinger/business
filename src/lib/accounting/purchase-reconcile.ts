/**
 * Conciliação histórica de compras (fase 2.2).
 *
 * Compras criadas enquanto o adaptador `purchases` estava desligado podem não ter lançamento no razão.
 * Este módulo detecta essas compras, propõe os lançamentos (dry-run), valida a evidência de recebimento e
 * pagamento e, só então, permite aplicar com aprovação humana.
 *
 * Regras de segurança:
 * - NADA é lançado automaticamente: `planPurchaseReconciliation` é somente leitura (dry-run).
 * - Compras "aguardando recebimento" (stockPosted=false) nunca são lançadas aqui.
 * - Sem evidência de pagamento (conta a pagar ou saída no Livro-Caixa), o item fica `requires_review`.
 * - A data original da compra é preservada; a moeda usada é a vigente no app (registros antigos não guardam moeda).
 * - Idempotência: a chave `purchase:<id>:recorded` impede lançar a mesma compra duas vezes.
 */
import type { Account, AppData, CurrencyCode } from '../types'
import { CAT_PURCHASE } from '../types'
import { purchaseEvent } from './adapters'
import { fromNumber } from './money'
import { isReversed, postEvent, type Ctx } from './engine'
import type { EventDraft, LedgerState } from './types'

export type PurchaseAcctStatus = 'posted' | 'awaiting_receipt' | 'ready' | 'requires_review'

export interface PurchaseReconItem {
  purchaseId: string
  supplier: string
  date: string
  total: number
  stockPosted: boolean
  status: PurchaseAcctStatus
  paidNow: boolean
  payableAccountId?: string
  cashEntryId?: string
  entryId?: string
  draft?: EventDraft
  /** Liquidação a recuperar quando a obrigação da compra já está paga (reconhecimento + baixa). */
  settlementDraft?: EventDraft
  reason?: string
  currency: CurrencyCode
}

/** Lançamento ativo (não estornado) ligado à compra, se existir. */
export function purchaseAccountedEntry(ledger: LedgerState, purchaseId: string): string | undefined {
  const ev = ledger.events.find((e) => e.idempotencyKey === `purchase:${purchaseId}:recorded`)
  if (ev?.status === 'posted' && ev.journalEntryId && !isReversed(ledger, ev.journalEntryId)) return ev.journalEntryId
  return undefined
}

/** Dry-run: identifica compras sem lançamento e propõe os lançamentos, sem gravar nada. */
export function planPurchaseReconciliation(data: AppData): PurchaseReconItem[] {
  const ledger = data.ledger
  const currency = data.settings.currency
  const items: PurchaseReconItem[] = []
  const claimedAccounts = new Set<string>()
  const claimedCash = new Set<string>()

  for (const p of data.purchases) {
    const base = { purchaseId: p.id, supplier: p.supplierName, date: p.date, total: p.total, stockPosted: p.stockPosted, paidNow: false, currency }
    const existing = ledger.events.find((e) => e.idempotencyKey === `purchase:${p.id}:recorded`)
    const entryId = purchaseAccountedEntry(ledger, p.id)
    if (entryId) {
      items.push({ ...base, status: 'posted', entryId })
      continue
    }
    if (existing) {
      // Evento existe mas não gerou lançamento ativo (rejeitado/pendente/estornado): requer revisão humana.
      items.push({ ...base, status: 'requires_review', reason: existing.status === 'pending' ? 'event_pending' : 'event_rejected' })
      continue
    }
    if (!p.stockPosted) {
      items.push({ ...base, status: 'awaiting_receipt' })
      continue
    }

    const payable = data.accounts.find(
      (a) => a.source === 'purchase' && a.kind === 'payable' && a.amount === p.total && a.contactName === p.supplierName && !claimedAccounts.has(a.id),
    )
    let cashEntryId: string | undefined
    let paidNow = false
    if (payable) {
      claimedAccounts.add(payable.id)
      paidNow = false
    } else {
      cashEntryId = data.entries.find((e) => !claimedCash.has(e.id) && e.type === 'out' && e.category === CAT_PURCHASE && e.date === p.date && e.amount === p.total)?.id
      if (cashEntryId) {
        claimedCash.add(cashEntryId)
        paidNow = true
      }
    }

    if (!payable && !cashEntryId) {
      items.push({ ...base, status: 'requires_review', reason: 'no_evidence' })
      continue
    }

    const res = purchaseEvent(ledger, { id: p.id, date: p.date, total: p.total, paidNow, stockPosted: true }, currency, { forceEnabled: true, imported: true })
    if (!res.ok) {
      items.push({ ...base, status: 'requires_review', reason: res.reason })
      continue
    }
    const draft: EventDraft = {
      ...res.draft,
      payload: { ...res.draft.payload, purchaseId: p.id, ...(cashEntryId ? { cashEntryId } : {}), ...(payable ? { accountId: payable.id } : {}) },
    }

    // Compra a prazo JÁ paga: recupera também a liquidação (débito contas a pagar, crédito caixa),
    // para a obrigação não ficar com saldo residual no razão.
    const settlementDraft = payable ? paidPayableSettlementDraft(ledger, payable, currency, p.date, data) : undefined
    items.push({ ...base, status: 'ready', paidNow, payableAccountId: payable?.id, cashEntryId, draft, ...(settlementDraft ? { settlementDraft } : {}) })
  }
  return items
}

/** Liquidação a recuperar de uma compra a prazo já paga (idempotente, sequência 1). */
function paidPayableSettlementDraft(ledger: LedgerState, payable: Account, currency: CurrencyCode, purchaseDate: string, data: AppData): EventDraft | undefined {
  const paid = (payable.settlements ?? []).reduce((s, x) => s + x.amount, 0)
  const isPaid = payable.status === 'paid' || paid >= payable.amount - 1e-9
  if (!isPaid) return undefined
  const minor = fromNumber(payable.amount, currency)
  if (minor === null || minor <= 0n) return undefined
  const amountMinor = minor.toString()
  const date = payable.paidAt ?? purchaseDate
  // Vínculo da saída de caixa da liquidação (rastreabilidade), quando existir.
  const settleCash = data.entries.find((e) => e.type === 'out' && e.sourceKind === 'account' && e.sourceId === payable.id)?.id
  return {
    orgId: ledger.orgId,
    idempotencyKey: `account:${payable.id}:settle:1`,
    type: 'payable.settled',
    source: { module: 'payables', recordId: payable.id },
    occurredAt: `${date}T12:00:00.000Z`,
    accountingDate: date,
    currency,
    amountMinor,
    payload: { accountId: payable.id, settleIn: 'cash', ...(settleCash ? { cashEntryId: settleCash } : {}) },
    confirmation: 'confirmed',
    ...(payable.environment && payable.environment !== 'unassigned' ? { environment: payable.environment } : {}),
  }
}

/** Aplica os lançamentos propostos (somente itens `ready`), com idempotência. Nada além do dry-run é gravado. */
export function applyPurchaseReconciliation(ledger: LedgerState, items: PurchaseReconItem[], ctx: Ctx): { ledger: LedgerState; posted: number; duplicates: number; rejected: number } {
  let next = ledger
  let posted = 0
  let duplicates = 0
  let rejected = 0
  for (const item of items) {
    if (item.status !== 'ready' || !item.draft) {
      rejected += 1
      continue
    }
    const r = postEvent(next, item.draft, ctx)
    next = r.ledger
    if (!r.ok) rejected += 1
    else if (r.duplicate) duplicates += 1
    else posted += 1
    if (item.settlementDraft) {
      const s = postEvent(next, item.settlementDraft, ctx)
      next = s.ledger
      if (!s.ok) rejected += 1
      else if (s.duplicate) duplicates += 1
      else posted += 1
    }
  }
  return { ledger: next, posted, duplicates, rejected }
}
