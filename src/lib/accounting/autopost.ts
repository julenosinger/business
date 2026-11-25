/**
 * Lançamento automático por DIFERENÇA DE ESTADO.
 *
 * O store aplica toda mudança em uma única atualização de estado; este módulo compara o estado anterior com o novo
 * e produz os eventos contábeis correspondentes, na MESMA transição (atômico dentro da memória). Assim as ações
 * existentes (vendas, compras, baixas, folha, tesouraria) continuam intactas e nada precisa ser reescrito.
 *
 * Princípios:
 * - Cada integração fica atrás de uma flag (`ledger.flags.adapters`) e só trata registros NOVOS ou alterados depois
 *   de ligada; nada retroativo e nenhum registro histórico é tocado.
 * - Idempotente: as chaves de evento são derivadas dos IDs dos registros.
 * - Competência separada de caixa: a venda/obrigação reconhece receita/despesa; a baixa só movimenta ativo/passivo.
 * - Baixa só é lançada se a obrigação correspondente estiver no razão (senão fica para revisão na conciliação).
 * - Baixa com link de tesouraria (USDC) nasce PENDENTE: nenhuma transação on-chain vira liquidação confirmada
 *   sem decisão humana (Centro de Conciliação).
 * - Nunca lança exceção: em caso de erro devolve o estado novo sem alteração no razão.
 */
import type { Account, AppData, Environment, PurchaseRef, Sale, TreasuryOp } from '../types'
import { fromNumber } from './money'
import { activeEntryForCashEntry, isReversed, postEvent, reverseEntry, type Ctx } from './engine'
import { purchaseEvent, saleEvent, treasuryEvent } from './adapters'
import type { EventDraft, EventType, LedgerState, PayloadValue } from './types'

const OBLIGATION_TYPES: EventType[] = ['payable.created', 'receivable.created', 'sale.recorded', 'purchase.recorded', 'payroll.accrued']

/** A obrigação (conta) tem lançamento ativo no razão? Pré-requisito para lançar a baixa. */
export function hasActiveObligation(ledger: LedgerState, accountId: string): boolean {
  return ledger.events.some((e) => e.status === 'posted' && OBLIGATION_TYPES.includes(e.type) && e.payload.accountId === accountId && !!e.journalEntryId && !isReversed(ledger, e.journalEntryId))
}

function activeObligationEntryId(ledger: LedgerState, accountId: string): string | undefined {
  const ev = ledger.events.find((e) => e.status === 'posted' && OBLIGATION_TYPES.includes(e.type) && e.payload.accountId === accountId && !!e.journalEntryId && !isReversed(ledger, e.journalEntryId))
  return ev?.journalEntryId
}

const revisionOf = (ledger: LedgerState, accountId: string): number => {
  let rev = -1
  const prefix = `account:${accountId}:created:r`
  for (const e of ledger.events) {
    if (e.idempotencyKey.startsWith(prefix)) {
      const n = Number(e.idempotencyKey.slice(prefix.length))
      if (Number.isInteger(n) && n > rev) rev = n
    }
  }
  return rev
}

function baseDraft(ledger: LedgerState, d: Omit<EventDraft, 'orgId' | 'occurredAt'>, at: string): EventDraft {
  return { orgId: ledger.orgId, occurredAt: at, ...d }
}

export interface AutoPostOptions {
  /** Data local (YYYY-MM-DD) usada como data contábil de eventos sem data própria. */
  today: string
  actorId: string
  now: string
}

export function autoPost(prev: AppData, next: AppData, opts: AutoPostOptions): AppData {
  try {
    const flags = next.ledger.flags.adapters
    if (!flags.sales && !flags.purchases && !flags.payables && !flags.payroll && !flags.treasury) return next
    const ledger = run(prev, next, opts)
    return ledger === next.ledger ? next : { ...next, ledger }
  } catch {
    return next
  }
}

function run(prev: AppData, next: AppData, opts: AutoPostOptions): LedgerState {
  const flags = next.ledger.flags.adapters
  const ctx: Ctx = { now: opts.now, actor: { id: opts.actorId, kind: 'user' } }
  const currency = next.settings.currency
  let ledger = next.ledger

  const prevEntryIds = new Set(prev.entries.map((e) => e.id))
  const newEntries = next.entries.filter((e) => !prevEntryIds.has(e.id))
  const claimedEntries = new Set<string>()
  const claim = (match: (e: AppData['entries'][number]) => boolean): string | undefined => {
    const hit = newEntries.find((e) => !claimedEntries.has(e.id) && match(e))
    if (hit) claimedEntries.add(hit.id)
    return hit?.id
  }
  const post = (draft: EventDraft): void => {
    ledger = postEvent(ledger, draft, ctx).ledger
  }
  const str = (v: string | undefined): PayloadValue => v ?? null

  // ----- Vendas ---------------------------------------------------------------------------------------------------
  if (flags.sales) {
    const before = new Map(prev.sales.map((s) => [s.id, s]))
    for (const s of next.sales) {
      const old: Sale | undefined = before.get(s.id)
      if (!old) {
        // Vínculo determinístico (ID + ambiente): a entrada de caixa da venda carrega sourceKind/sourceId.
        const cashEntryId = s.method !== 'prazo' ? claim((e) => e.sourceKind === 'sale' && e.sourceId === s.id && e.environment === s.environment) : undefined
        const res = saleEvent(ledger, { id: s.id, date: s.date, total: s.total, cogs: s.cogs, method: s.method, canceled: !!s.canceledAt }, currency)
        if (res.ok) post({ ...res.draft, environment: s.environment, payload: { ...res.draft.payload, saleId: s.id, cashEntryId: str(cashEntryId), accountId: str(s.accountId) } })
      } else if (!old.canceledAt && s.canceledAt) {
        const ev = ledger.events.find((e) => e.idempotencyKey === `sale:${s.id}:recorded` && e.status === 'posted')
        const paidCredit = s.method === 'prazo' && prev.accounts.find((a) => a.id === s.accountId)?.status === 'paid'
        // Venda a prazo já recebida e depois cancelada exige estorno do recebimento: fica para revisão manual.
        if (ev?.journalEntryId && !paidCredit) ledger = reverseEntry(ledger, ev.journalEntryId, 'Venda cancelada', ctx).ledger
      }
    }
  }

  // ----- Compras --------------------------------------------------------------------------------------------------
  if (flags.purchases) {
    const before = new Map(prev.purchases.map((p) => [p.id, p]))
    const linkedAcc = new Set(ledger.events.map((e) => e.payload.accountId).filter((x): x is string => typeof x === 'string'))
    for (const p of next.purchases) {
      const old: PurchaseRef | undefined = before.get(p.id)
      if (!p.stockPosted || (old && old.stockPosted)) continue
      // Vínculo determinístico: a obrigação da compra carrega sourceId = purchaseId.
      const account = next.accounts.find((a) => a.source === 'purchase' && a.kind === 'payable' && a.sourceId === p.id && !linkedAcc.has(a.id))
      let cashEntryId: string | undefined
      if (!account) {
        cashEntryId = claim((e) => e.sourceKind === 'purchase' && e.sourceId === p.id && e.environment === p.environment)
      }
      if (!account && !cashEntryId) continue // não dá para saber como foi paga: revisão manual
      if (account) linkedAcc.add(account.id)
      const res = purchaseEvent(ledger, { id: p.id, date: p.date, total: p.total, paidNow: !account, stockPosted: true }, currency)
      if (res.ok) post({ ...res.draft, environment: p.environment, payload: { ...res.draft.payload, purchaseId: p.id, cashEntryId: str(cashEntryId), accountId: str(account?.id) } })
    }
  }

  // ----- Obrigações (contas a pagar/receber) e baixas --------------------------------------------------------------
  const before = new Map(prev.accounts.map((a) => [a.id, a]))
  const after = new Map(next.accounts.map((a) => [a.id, a]))
  const minor = (value: number): string | null => {
    const m = fromNumber(value, currency)
    return m !== null && m > 0n ? m.toString() : null
  }
  const enabledFor = (a: Account): boolean => (a.source === 'payroll' ? flags.payroll : flags.payables)

  const postObligation = (a: Account, rev: number): void => {
    const amountMinor = minor(a.amount)
    if (!amountMinor || !/^\d{4}-\d{2}-\d{2}$/.test(opts.today)) return
    if (a.source === 'manual' && flags.payables) {
      post(
        baseDraft(ledger, {
          idempotencyKey: `account:${a.id}:created:r${rev}`,
          type: a.kind === 'payable' ? 'payable.created' : 'receivable.created',
          source: { module: a.kind === 'payable' ? 'payables' : 'receivables', recordId: a.id },
          accountingDate: opts.today,
          currency,
          amountMinor,
          payload: { accountId: a.id, category: a.category, description: a.description.slice(0, 120), revision: rev },
          confirmation: 'confirmed',
          environment: a.environment,
        }, opts.now),
      )
    } else if (a.source === 'payroll' && flags.payroll && /\d{4}-\d{2}$/.test(a.description) && rev === 0) {
      post(
        baseDraft(ledger, {
          idempotencyKey: `payroll:${a.id}:accrued`,
          type: 'payroll.accrued',
          source: { module: 'payroll', recordId: a.id },
          accountingDate: opts.today,
          currency,
          amountMinor,
          payload: { accountId: a.id, month: a.description.slice(-7) },
          confirmation: 'confirmed',
          environment: a.environment,
        }, opts.now),
      )
    }
  }

  for (const a of next.accounts) {
    const old = before.get(a.id)
    if (!old) {
      postObligation(a, 0)
      continue
    }
    if (old.status === 'open' && a.status === 'open' && a.source === 'manual' && flags.payables && (old.amount !== a.amount || old.category !== a.category || old.kind !== a.kind)) {
      const active = activeObligationEntryId(ledger, a.id)
      if (active) {
        const rev = revisionOf(ledger, a.id) + 1
        ledger = reverseEntry(ledger, active, 'Conta editada', ctx).ledger
        postObligation(a, rev)
      }
      continue
    }
    if (!enabledFor(a)) continue
    // Liquidações parciais e totais: cada NOVA liquidação vira um evento, com sequência única e idempotente.
    const prevSettlements = new Set((old.settlements ?? []).map((s) => s.id))
    const newSettlements = (a.settlements ?? []).filter((s) => !prevSettlements.has(s.id))
    const postSettlement = (amount: number, date: string, sequence: number, treasuryTx: string | undefined, settlementId?: string, verified?: boolean): void => {
      if (!hasActiveObligation(ledger, a.id)) return
      const amountMinor = minor(amount)
      if (!amountMinor) return
      // Vínculo individual por liquidação (settlementId) quando disponível; legado cai no vínculo pela conta.
      const cashEntryId = settlementId
        ? claim((e) => e.sourceKind === 'account' && e.sourceId === a.id && e.settlementId === settlementId && e.environment === a.environment)
        : claim((e) => e.sourceKind === 'account' && e.sourceId === a.id && e.environment === a.environment)
      const viaTreasury = !!treasuryTx
      const type: EventType = a.source === 'payroll' ? 'payroll.paid' : a.kind === 'payable' ? 'payable.settled' : 'receivable.settled'
      post(
        baseDraft(ledger, {
          idempotencyKey: `account:${a.id}:settle:${sequence}`,
          type,
          source: { module: a.source === 'payroll' ? 'payroll' : a.kind === 'payable' ? 'payables' : 'receivables', recordId: a.id },
          accountingDate: date,
          currency,
          amountMinor,
          // Pagamento via USDC/Gateway só vira liquidação CONFIRMADA quando já verificado (verified) ou quando for caixa.
          payload: { accountId: a.id, settleIn: viaTreasury && currency === 'USDC' ? 'usdc_gateway' : 'cash', cashEntryId: str(cashEntryId), txRef: str(treasuryTx), ...(settlementId ? { settlementId } : {}) },
          confirmation: viaTreasury && !verified ? 'pending' : 'confirmed',
          environment: a.environment,
        }, opts.now),
      )
    }
    if (newSettlements.length > 0) {
      for (const s of newSettlements) postSettlement(s.amount, s.date, s.sequence, s.treasuryTx, s.id, s.verified)
    } else if (old.status === 'open' && a.status === 'paid') {
      // Liquidação legada (sem lista de liquidações): baixa total no valor da conta.
      postSettlement(a.amount, a.paidAt ?? opts.today, 1, a.treasuryTx)
    }
  }
  for (const old of prev.accounts) {
    if (after.has(old.id) || old.status !== 'open' || old.source !== 'manual' || !flags.payables) continue
    const active = activeObligationEntryId(ledger, old.id)
    if (active) ledger = reverseEntry(ledger, active, 'Conta removida', ctx).ledger
  }

  // ----- Tesouraria (somente depósitos sem conta vinculada; sempre PENDENTES até revisão humana) ----------------------
  if (flags.treasury) {
    const prevOps = new Set(prev.treasuryOps.map((o) => o.id))
    for (const op of next.treasuryOps) {
      if (prevOps.has(op.id) || op.accountId || op.kind !== 'deposit') continue
      const res = treasuryEvent(ledger, { id: op.id, kind: 'deposit', amount: normalizeAmount(op), date: op.date, txHash: op.txHash ?? null, state: 'pending' })
      const chainEnv = (chain: string): Environment | undefined => (chain === 'Arc' ? 'mainnet' : chain === 'Arc_Testnet' ? 'testnet' : undefined)
      if (res.ok) post({ ...res.draft, environment: chainEnv(op.chain), payload: { ...res.draft.payload, opId: op.id, chain: op.chain } })
    }
  }
  return ledger
}

function normalizeAmount(op: TreasuryOp): string {
  const n = op.amount.trim().replace(',', '.')
  return /^\d+(\.\d{1,6})?$/.test(n) ? n : '0'
}

export { activeEntryForCashEntry }
