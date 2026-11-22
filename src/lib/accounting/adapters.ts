/**
 * Adaptadores: transformam registros do app em rascunhos de eventos financeiros.
 *
 * Regras:
 * - Só geram evento com informação suficiente e verificada; caso contrário devolvem o motivo.
 * - Cada adaptador respeita uma flag; nesta fase apenas o do Livro-Caixa vem ligado.
 * - Eles NÃO escrevem em lugar nenhum e NÃO movimentam caixa: o Livro-Caixa continua sendo a fonte do caixa.
 */
import type { CurrencyCode } from '../types'
import { fromNumber, formatDecimal, isCurrency } from './money'
import type { EventDraft, LedgerFlags, LedgerState, PayloadValue } from './types'

export type SkipReason = 'adapter_disabled' | 'insufficient_data' | 'unverified_settlement' | 'invalid_amount' | 'unsupported_currency' | 'invalid_date'
export type AdapterResult = { ok: true; draft: EventDraft } | { ok: false; reason: SkipReason }

export type AdapterName = keyof LedgerFlags['adapters']
export const isAdapterEnabled = (ledger: Pick<LedgerState, 'flags'>, name: AdapterName): boolean => ledger.flags.adapters[name] === true

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const minorOf = (value: number, currency: CurrencyCode): string | null => {
  const m = fromNumber(value, currency)
  return m !== null && m > 0n ? m.toString() : null
}

function make(ledger: LedgerState, d: Omit<EventDraft, 'orgId' | 'occurredAt'> & { occurredAt?: string }): EventDraft {
  return { orgId: ledger.orgId, occurredAt: d.occurredAt ?? `${d.accountingDate}T12:00:00.000Z`, ...d }
}

// ---------------------------------------------------------------------------------------------------------------------
// Livro-Caixa (ADAPTADOR ATIVO NESTA FASE)
// ---------------------------------------------------------------------------------------------------------------------

export interface CashBookRow {
  id: string
  type: 'in' | 'out'
  amount: number
  date: string
  category: string
  description?: string
}

export function cashBookEvent(
  ledger: LedgerState,
  row: CashBookRow,
  opts: { currency: CurrencyCode; revision: number; forceEnabled?: boolean; imported?: boolean },
): AdapterResult {
  if (!opts.forceEnabled && !isAdapterEnabled(ledger, 'cashBook')) return { ok: false, reason: 'adapter_disabled' }
  if (!isCurrency(opts.currency)) return { ok: false, reason: 'unsupported_currency' }
  if (!row.id || !row.category) return { ok: false, reason: 'insufficient_data' }
  if (!DATE_RE.test(row.date)) return { ok: false, reason: 'invalid_date' }
  const amountMinor = minorOf(row.amount, opts.currency)
  if (amountMinor === null) return { ok: false, reason: 'invalid_amount' }
  const payload: Record<string, PayloadValue> = { cashEntryId: row.id, category: row.category, description: (row.description ?? '').slice(0, 120), revision: opts.revision, imported: opts.imported === true }
  return {
    ok: true,
    draft: make(ledger, {
      idempotencyKey: `cashbook:${row.id}:r${opts.revision}`,
      type: row.type === 'in' ? 'cashbook.income' : 'cashbook.expense',
      source: { module: 'cashbook', recordId: row.id },
      accountingDate: row.date,
      currency: opts.currency,
      amountMinor,
      payload,
      confirmation: 'confirmed',
    }),
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Adaptadores PREPARADOS (desligados por padrão; serão ativados fase a fase)
// ---------------------------------------------------------------------------------------------------------------------

export interface SaleInput {
  id: string
  date: string
  total: number
  cogs: number
  method: 'dinheiro' | 'pix' | 'cartao' | 'usdc' | 'prazo'
  canceled?: boolean
}

/** Venda: receita (e CMV). A baixa de contas a receber é outro evento, para nunca reconhecer a receita duas vezes. */
export function saleEvent(ledger: LedgerState, sale: SaleInput, currency: CurrencyCode): AdapterResult {
  if (!isAdapterEnabled(ledger, 'sales')) return { ok: false, reason: 'adapter_disabled' }
  if (sale.canceled || !sale.id) return { ok: false, reason: 'insufficient_data' }
  if (!DATE_RE.test(sale.date)) return { ok: false, reason: 'invalid_date' }
  const amountMinor = minorOf(sale.total, currency)
  if (amountMinor === null) return { ok: false, reason: 'invalid_amount' }
  const cogsMinor = sale.cogs > 0 ? (minorOf(sale.cogs, currency) ?? '0') : '0'
  const paidNow = sale.method !== 'prazo'
  return {
    ok: true,
    draft: make(ledger, {
      idempotencyKey: `sale:${sale.id}:recorded`,
      type: 'sale.recorded',
      source: { module: 'sales', recordId: sale.id },
      accountingDate: sale.date,
      currency,
      amountMinor,
      payload: { paidNow, settleIn: sale.method === 'usdc' && currency === 'USDC' ? 'usdc_wallet' : 'cash', cogsMinor },
      confirmation: 'confirmed',
    }),
  }
}

export interface SettlementInput {
  accountId: string
  kind: 'payable' | 'receivable'
  /** Valor efetivamente liquidado nesta operação (liquidação parcial permitida). */
  amount: number
  date: string
  /** Sequência da liquidação para a mesma conta (1, 2, ...), garante idempotência em pagamentos parciais. */
  sequence: number
  settleIn: 'cash' | 'usdc_wallet' | 'usdc_gateway'
}

export function settlementEvent(ledger: LedgerState, s: SettlementInput, currency: CurrencyCode): AdapterResult {
  if (!isAdapterEnabled(ledger, 'payables')) return { ok: false, reason: 'adapter_disabled' }
  if (!s.accountId || s.sequence < 1) return { ok: false, reason: 'insufficient_data' }
  if (!DATE_RE.test(s.date)) return { ok: false, reason: 'invalid_date' }
  const amountMinor = minorOf(s.amount, currency)
  if (amountMinor === null) return { ok: false, reason: 'invalid_amount' }
  return {
    ok: true,
    draft: make(ledger, {
      idempotencyKey: `account:${s.accountId}:settle:${s.sequence}`,
      type: s.kind === 'payable' ? 'payable.settled' : 'receivable.settled',
      source: { module: s.kind === 'payable' ? 'payables' : 'receivables', recordId: s.accountId },
      accountingDate: s.date,
      currency,
      amountMinor,
      payload: { settleIn: s.settleIn },
      confirmation: 'confirmed',
    }),
  }
}

export interface PurchaseInput {
  id: string
  date: string
  total: number
  paidNow: boolean
  /** Compra que aguarda recebimento ainda não deu entrada no estoque: o razão só reconhece o estoque após o recebimento. */
  stockPosted: boolean
}

export function purchaseEvent(ledger: LedgerState, p: PurchaseInput, currency: CurrencyCode, opts?: { forceEnabled?: boolean; imported?: boolean }): AdapterResult {
  if (!opts?.forceEnabled && !isAdapterEnabled(ledger, 'purchases')) return { ok: false, reason: 'adapter_disabled' }
  if (!p.id) return { ok: false, reason: 'insufficient_data' }
  if (!p.stockPosted) return { ok: false, reason: 'insufficient_data' }
  if (!DATE_RE.test(p.date)) return { ok: false, reason: 'invalid_date' }
  const amountMinor = minorOf(p.total, currency)
  if (amountMinor === null) return { ok: false, reason: 'invalid_amount' }
  return {
    ok: true,
    draft: make(ledger, {
      idempotencyKey: `purchase:${p.id}:recorded`,
      type: 'purchase.recorded',
      source: { module: 'purchases', recordId: p.id },
      accountingDate: p.date,
      currency,
      amountMinor,
      payload: { paidNow: p.paidNow, settleIn: 'cash', ...(opts?.imported ? { imported: true } : {}) },
      confirmation: 'confirmed',
    }),
  }
}

export function payrollEvent(ledger: LedgerState, p: { accountId: string; month: string; amount: number; date: string }, currency: CurrencyCode): AdapterResult {
  if (!isAdapterEnabled(ledger, 'payroll')) return { ok: false, reason: 'adapter_disabled' }
  if (!p.accountId || !/^\d{4}-\d{2}$/.test(p.month)) return { ok: false, reason: 'insufficient_data' }
  if (!DATE_RE.test(p.date)) return { ok: false, reason: 'invalid_date' }
  const amountMinor = minorOf(p.amount, currency)
  if (amountMinor === null) return { ok: false, reason: 'invalid_amount' }
  return {
    ok: true,
    draft: make(ledger, {
      idempotencyKey: `payroll:${p.accountId}:accrued`,
      type: 'payroll.accrued',
      source: { module: 'payroll', recordId: p.accountId },
      accountingDate: p.date,
      currency,
      amountMinor,
      payload: { month: p.month },
      confirmation: 'confirmed',
    }),
  }
}

export function freightEvent(ledger: LedgerState, f: { shipmentId: string; total: number; date: string; currency: CurrencyCode }): AdapterResult {
  if (!isAdapterEnabled(ledger, 'logistics')) return { ok: false, reason: 'adapter_disabled' }
  if (!f.shipmentId) return { ok: false, reason: 'insufficient_data' }
  if (!DATE_RE.test(f.date)) return { ok: false, reason: 'invalid_date' }
  const amountMinor = minorOf(f.total, f.currency)
  if (amountMinor === null) return { ok: false, reason: 'invalid_amount' }
  return {
    ok: true,
    draft: make(ledger, {
      idempotencyKey: `freight:${f.shipmentId}:posted`,
      type: 'freight.posted',
      source: { module: 'logistics', recordId: f.shipmentId },
      accountingDate: f.date,
      currency: f.currency,
      amountMinor,
      payload: {},
      confirmation: 'confirmed',
    }),
  }
}

export interface TreasuryOpInput {
  id: string
  kind: 'deposit' | 'transfer' | 'payment'
  /** Valor decimal em USDC ("12.50"), sem float. */
  amount: string
  date: string
  /** Hash da transação on-chain. Sem hash não há fato verificável. */
  txHash: string | null
  /** Estado verificado da transação; "pending" nunca vira liquidação confirmada. */
  state: 'pending' | 'confirmed' | 'failed'
  /** Transferência para outra carteira da própria empresa NÃO é receita nem despesa. */
  ownedDestination?: boolean
}

export function treasuryEvent(ledger: LedgerState, op: TreasuryOpInput): AdapterResult {
  if (!isAdapterEnabled(ledger, 'treasury')) return { ok: false, reason: 'adapter_disabled' }
  if (!op.id || !op.txHash) return { ok: false, reason: 'unverified_settlement' }
  if (!DATE_RE.test(op.date)) return { ok: false, reason: 'invalid_date' }
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(op.amount)
  if (!m) return { ok: false, reason: 'invalid_amount' }
  const amountMinor = (BigInt(m[1] ?? '0') * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'))).toString()
  if (BigInt(amountMinor) <= 0n) return { ok: false, reason: 'invalid_amount' }
  const type = op.kind === 'deposit' ? 'treasury.deposit' : op.kind === 'transfer' ? 'treasury.transfer_internal' : 'treasury.payment'
  if (op.kind === 'payment' && op.ownedDestination) return { ok: false, reason: 'insufficient_data' }
  return {
    ok: true,
    draft: make(ledger, {
      idempotencyKey: `treasury:${op.id}:${op.txHash}`,
      type,
      source: { module: 'treasury', recordId: op.id },
      accountingDate: op.date,
      currency: 'USDC',
      amountMinor,
      payload: { txHash: op.txHash, from: 'usdc_wallet', to: 'usdc_gateway' },
      confirmation: op.state,
    }),
  }
}

export const formatForAudit = (minor: bigint, currency: CurrencyCode): string => `${formatDecimal(minor, currency)} ${currency}`
