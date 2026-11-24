/**
 * Regras de lançamento (posting rules): cada tipo de evento de negócio vira linhas de partida dobrada.
 * As regras referenciam SUBTIPOS de conta; o plano de contas decide o código concreto.
 * Nenhuma regra fiscal é assumida aqui.
 */
import type { AccountSubtype, EventDraft, EventType, FeeKind, LedgerState, PostErrorCode, Side } from './types'
import { accountBySubtype } from './chart'
import { isUnsupportedCategory } from '../financial-categories'

export interface LineSpec {
  subtype: AccountSubtype
  side: Side
  amount: bigint
  memo?: string
}

export type RuleResult = { ok: true; lines: LineSpec[]; memo: string } | { ok: false; error: PostErrorCode }
export type Rule = (draft: EventDraft, ledger: LedgerState, amount: bigint) => RuleResult

export type SettleIn = 'cash' | 'usdc_wallet' | 'usdc_gateway'
const SETTLE_IN: SettleIn[] = ['cash', 'usdc_wallet', 'usdc_gateway']

const str = (draft: EventDraft, key: string): string => {
  const v = draft.payload[key]
  return typeof v === 'string' ? v : ''
}

function settleIn(draft: EventDraft, key = 'settleIn'): SettleIn | null {
  const v = str(draft, key)
  if (v === '') return 'cash'
  return (SETTLE_IN as string[]).includes(v) ? (v as SettleIn) : null
}

const bigPayload = (draft: EventDraft, key: string): bigint | null => {
  const v = draft.payload[key]
  if (v === undefined || v === null || v === '') return 0n
  return typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : null
}

const ok = (memo: string, lines: LineSpec[]): RuleResult => ({ ok: true, memo, lines })
const fail = (error: PostErrorCode): RuleResult => ({ ok: false, error })

export const FEE_SUBTYPE: Record<FeeKind, AccountSubtype> = {
  gateway: 'expense_fees',
  processing: 'expense_fees',
  network: 'expense_network',
  freight: 'expense_freight',
  service: 'expense_operating',
  tax: 'expense_tax',
}

const cashbookIncome: Rule = (d, ledger, amount) => {
  if (isUnsupportedCategory(str(d, 'category'))) return fail('unsupported_category')
  const mapped = ledger.categoryMap[str(d, 'category')]
  const counter = accountBySubtype(ledger, mapped ?? 'revenue_other')
  // Receita só pode creditar conta de receita; qualquer outro mapeamento cai no padrão seguro.
  const subtype = counter?.class === 'revenue' ? counter.subtype : 'revenue_other'
  return ok(str(d, 'description') || 'Lançamento de entrada', [
    { subtype: 'cash', side: 'debit', amount },
    { subtype, side: 'credit', amount },
  ])
}

const cashbookExpense: Rule = (d, ledger, amount) => {
  if (isUnsupportedCategory(str(d, 'category'))) return fail('unsupported_category')
  const mapped = ledger.categoryMap[str(d, 'category')]
  const counter = accountBySubtype(ledger, mapped ?? 'expense_operating')
  const subtype = counter && (counter.class === 'expense' || counter.class === 'asset') && counter.subtype !== 'cash' ? counter.subtype : 'expense_operating'
  return ok(str(d, 'description') || 'Lançamento de saída', [
    { subtype, side: 'debit', amount },
    { subtype: 'cash', side: 'credit', amount },
  ])
}

/** Obrigação a pagar criada manualmente (aluguel, frete lançado, etc.): despesa (ou estoque) a crédito de contas a pagar. */
const payableCreated: Rule = (d, ledger, amount) => {
  if (isUnsupportedCategory(str(d, 'category'))) return fail('unsupported_category')
  const mapped = accountBySubtype(ledger, ledger.categoryMap[str(d, 'category')] ?? 'expense_operating')
  const okTarget = mapped && (mapped.class === 'expense' || mapped.subtype === 'inventory')
  return ok(str(d, 'description') || 'Conta a pagar', [
    { subtype: okTarget && mapped ? mapped.subtype : 'expense_operating', side: 'debit', amount },
    { subtype: 'payable', side: 'credit', amount },
  ])
}

/** Direito a receber criado manualmente (serviço prestado a prazo): contas a receber contra receita. */
const receivableCreated: Rule = (d, ledger, amount) => {
  if (isUnsupportedCategory(str(d, 'category'))) return fail('unsupported_category')
  const mapped = accountBySubtype(ledger, ledger.categoryMap[str(d, 'category')] ?? 'revenue_other')
  return ok(str(d, 'description') || 'Conta a receber', [
    { subtype: 'receivable', side: 'debit', amount },
    { subtype: mapped?.class === 'revenue' ? mapped.subtype : 'revenue_other', side: 'credit', amount },
  ])
}

const saleRecorded: Rule = (d, _l, amount) => {
  const paidNow = d.payload.paidNow === true
  const where = settleIn(d)
  const cogs = bigPayload(d, 'cogsMinor')
  if (where === null || cogs === null) return fail('missing_payload')
  const lines: LineSpec[] = [
    { subtype: paidNow ? where : 'receivable', side: 'debit', amount },
    { subtype: 'revenue_sales', side: 'credit', amount },
  ]
  if (cogs > 0n) {
    lines.push({ subtype: 'cogs', side: 'debit', amount: cogs }, { subtype: 'inventory', side: 'credit', amount: cogs })
  }
  return ok('Venda registrada', lines)
}

const receivableSettled: Rule = (d, _l, amount) => {
  const where = settleIn(d)
  if (where === null) return fail('missing_payload')
  return ok('Recebimento de conta a receber', [
    { subtype: where, side: 'debit', amount },
    { subtype: 'receivable', side: 'credit', amount },
  ])
}

const purchaseRecorded: Rule = (d, _l, amount) => {
  const where = settleIn(d)
  if (where === null) return fail('missing_payload')
  const paidNow = d.payload.paidNow === true
  return ok('Compra de mercadorias', [
    { subtype: 'inventory', side: 'debit', amount },
    { subtype: paidNow ? where : 'payable', side: 'credit', amount },
  ])
}

const payableSettled: Rule = (d, _l, amount) => {
  const where = settleIn(d)
  if (where === null) return fail('missing_payload')
  return ok('Pagamento de conta a pagar', [
    { subtype: 'payable', side: 'debit', amount },
    { subtype: where, side: 'credit', amount },
  ])
}

const payrollAccrued: Rule = (_d, _l, amount) =>
  ok('Folha de pagamento apropriada', [
    { subtype: 'expense_payroll', side: 'debit', amount },
    { subtype: 'payroll_payable', side: 'credit', amount },
  ])

const payrollPaid: Rule = (d, _l, amount) => {
  const where = settleIn(d)
  if (where === null) return fail('missing_payload')
  return ok('Pagamento de salário', [
    { subtype: 'payroll_payable', side: 'debit', amount },
    { subtype: where, side: 'credit', amount },
  ])
}

const freightPosted: Rule = (_d, _l, amount) =>
  ok('Frete e custos logísticos', [
    { subtype: 'expense_freight', side: 'debit', amount },
    { subtype: 'payable', side: 'credit', amount },
  ])

/** Transferência entre contas da própria empresa: nunca é receita nem despesa. */
const internalTransfer: Rule = (d, _l, amount) => {
  const from = str(d, 'from') || 'usdc_wallet'
  const to = str(d, 'to') || 'usdc_gateway'
  const allowed = ['usdc_wallet', 'usdc_gateway', 'cash']
  if (!allowed.includes(from) || !allowed.includes(to) || from === to) return fail('missing_payload')
  return ok('Transferência interna', [
    { subtype: to as AccountSubtype, side: 'debit', amount },
    { subtype: from as AccountSubtype, side: 'credit', amount },
  ])
}

const treasuryPayment: Rule = (d, _l, amount) => {
  const from = str(d, 'from') || 'usdc_gateway'
  if (from !== 'usdc_gateway' && from !== 'usdc_wallet') return fail('missing_payload')
  return ok('Pagamento via tesouraria', [
    { subtype: 'payable', side: 'debit', amount },
    { subtype: from, side: 'credit', amount },
  ])
}

const feeConfirmed: Rule = (d, _l, amount) => {
  const kind = str(d, 'feeKind') as FeeKind
  const sub = FEE_SUBTYPE[kind]
  const paidFrom = str(d, 'paidFrom') || 'usdc_gateway'
  if (!sub || !['cash', 'usdc_wallet', 'usdc_gateway', 'payable'].includes(paidFrom)) return fail('missing_payload')
  return ok('Taxa confirmada', [
    { subtype: sub, side: 'debit', amount },
    { subtype: paidFrom as AccountSubtype, side: 'credit', amount },
  ])
}

const adjustment: Rule = (d, ledger, amount) => {
  const debit = str(d, 'debit') as AccountSubtype
  const credit = str(d, 'credit') as AccountSubtype
  const reason = str(d, 'reason').trim()
  if (reason.length < 3) return fail('reason_required')
  if (!accountBySubtype(ledger, debit) || !accountBySubtype(ledger, credit) || debit === credit) return fail('missing_payload')
  return ok(`Ajuste: ${reason}`, [
    { subtype: debit, side: 'debit', amount },
    { subtype: credit, side: 'credit', amount },
  ])
}

export const RULES: Record<EventType, Rule> = {
  'cashbook.income': cashbookIncome,
  'cashbook.expense': cashbookExpense,
  'payable.created': payableCreated,
  'receivable.created': receivableCreated,
  'sale.recorded': saleRecorded,
  'receivable.settled': receivableSettled,
  'purchase.recorded': purchaseRecorded,
  'payable.settled': payableSettled,
  'payroll.accrued': payrollAccrued,
  'payroll.paid': payrollPaid,
  'freight.posted': freightPosted,
  'treasury.deposit': internalTransfer,
  'treasury.transfer_internal': internalTransfer,
  'treasury.payment': treasuryPayment,
  'fee.confirmed': feeConfirmed,
  adjustment,
}

export const isEventType = (v: string): v is EventType => v in RULES
