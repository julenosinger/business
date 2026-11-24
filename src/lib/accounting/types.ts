import type { CurrencyCode, Environment } from '../types'
import type { Role } from './auth'

/** Classe contábil da conta. O lado normal é débito para ativo/despesa e crédito para os demais. */
export type AccountClass = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

/** Papel funcional da conta: as regras de lançamento referenciam subtipos, não códigos fixos. */
export type AccountSubtype =
  | 'group'
  | 'cash'
  | 'usdc_wallet'
  | 'usdc_gateway'
  | 'receivable'
  | 'inventory'
  | 'payable'
  | 'payroll_payable'
  | 'tax_payable'
  | 'equity'
  | 'opening'
  | 'revenue_sales'
  | 'revenue_other'
  | 'cogs'
  | 'expense_operating'
  | 'expense_payroll'
  | 'expense_freight'
  | 'expense_fees'
  | 'expense_network'
  | 'expense_tax'

export interface LedgerAccount {
  code: string
  class: AccountClass
  subtype: AccountSubtype
  name: { pt: string; en: string }
  active: boolean
  /** Código da conta-pai (hierarquia). Ausente = raiz. Contas `group` só agrupam e não recebem lançamentos. */
  parent?: string
}

export type ActorKind = 'user' | 'system' | 'agent'
export interface Actor {
  id: string
  kind: ActorKind
  /** Papel de autorização. Ausente = `owner` no app de usuário único (comportamento legado). */
  role?: Role
}

export type SourceModule = 'cashbook' | 'sales' | 'purchases' | 'payables' | 'receivables' | 'payroll' | 'logistics' | 'treasury' | 'fees' | 'adjustment'

export type EventType =
  | 'cashbook.income'
  | 'cashbook.expense'
  | 'sale.recorded'
  | 'receivable.settled'
  | 'purchase.recorded'
  | 'payable.settled'
  | 'payroll.accrued'
  | 'payroll.paid'
  | 'freight.posted'
  | 'treasury.deposit'
  | 'treasury.transfer_internal'
  | 'treasury.payment'
  | 'fee.confirmed'
  | 'payable.created'
  | 'receivable.created'
  | 'adjustment'

/** Estado de processamento do evento de negócio (não confundir com movimento de caixa). */
export type EventStatus = 'pending' | 'posted' | 'rejected' | 'failed'

/** Confirmação do fato gerador. Operações on-chain pendentes não viram liquidação confirmada. */
export type Confirmation = 'confirmed' | 'pending' | 'failed'

export type PayloadValue = string | number | boolean | null

export interface EventDraft {
  orgId: string
  idempotencyKey: string
  type: EventType
  source: { module: SourceModule; recordId: string }
  occurredAt: string
  /** Data contábil, YYYY-MM-DD. */
  accountingDate: string
  currency: CurrencyCode
  /** Valor em unidades menores (inteiro positivo, como string). */
  amountMinor: string
  payload: Record<string, PayloadValue>
  confirmation: Confirmation
  /** Ambiente de origem da operação (Mainnet/Testnet/unassigned). Ausente = legado. */
  environment?: Environment
}

export interface FinancialEvent extends EventDraft {
  id: string
  status: EventStatus
  actor: Actor
  createdAt: string
  updatedAt: string
  attempts: number
  journalEntryId?: string
  error?: string
}

export type Side = 'debit' | 'credit'

export interface JournalLine {
  accountCode: string
  side: Side
  /** Inteiro positivo em unidades menores. */
  amountMinor: string
  memo?: string
}

export interface JournalEntry {
  id: string
  orgId: string
  eventId: string
  idempotencyKey: string
  accountingDate: string
  currency: CurrencyCode
  memo: string
  lines: JournalLine[]
  postedAt: string
  postedBy: Actor
  /** Vínculos com registros do app (somente leitura, para conciliação). */
  links: Record<string, string>
  /** Presente apenas em estornos: lançamento original e motivo. */
  reversalOf?: string
  reason?: string
  /** Ambiente de origem da partida (todas as linhas compartilham o mesmo ambiente). Ausente = legado. */
  environment?: Environment
}

export type AuditAction =
  | 'event.received'
  | 'event.posted'
  | 'event.pending'
  | 'event.rejected'
  | 'event.failed'
  | 'event.duplicate'
  | 'entry.reversed'
  | 'fee.registered'
  | 'fee.confirmed'
  | 'approval.requested'
  | 'approval.approved'
  | 'approval.rejected'
  | 'flag.changed'
  | 'chart.changed'
  | 'review.recorded'
  | 'fx.recorded'
  | 'period.review'
  | 'period.closed'
  | 'period.reopened'
  | 'period.adjusted'
  | 'account.classified'
  | 'record.classified'

export interface AuditRecord {
  id: string
  at: string
  actor: Actor
  action: AuditAction
  orgId: string
  eventId?: string
  entryId?: string
  detail: string
}

export type FeeKind = 'gateway' | 'processing' | 'network' | 'freight' | 'service' | 'tax'
export type FeeStatus = 'estimated' | 'confirmed'
export type FeePaidFrom = 'cash' | 'usdc_wallet' | 'usdc_gateway' | 'payable'

export interface FeeRecord {
  id: string
  /** Chave única: módulo + registro + tipo + referência. Impede lançar a mesma taxa duas vezes. */
  dedupeKey: string
  source: { module: SourceModule; recordId: string }
  kind: FeeKind
  status: FeeStatus
  amountMinor: string
  currency: CurrencyCode
  /** Taxa percentual/fração decimal quando aplicável (ex.: "0.0050"), nunca inventada. */
  rate?: string
  relatedRef?: string
  paidFrom: FeePaidFrom
  createdAt: string
  confirmedAt?: string
  eventKey?: string
}

/** Regra fiscal configurada pelo usuário. O motor nunca assume alíquotas: só aplica regras validadas. */
export interface TaxRule {
  id: string
  jurisdiction: string
  name: string
  /** Fração decimal (ex.: "0.0500" = 5%). */
  rate: string
  accountSubtype: AccountSubtype
  validated: boolean
  validatedBy?: string
  validatedAt?: string
  effectiveFrom: string
  effectiveTo?: string
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export interface ApprovalRequest {
  id: string
  orgId: string
  createdAt: string
  requestedBy: Actor
  note: string
  draft: EventDraft
  status: ApprovalStatus
  decidedBy?: Actor
  decidedAt?: string
  decisionNote?: string
  resultEntryId?: string
}

export interface LedgerFlags {
  /** Adaptadores ativos. Somente `cashBook` vem ligado nesta fase. */
  adapters: {
    cashBook: boolean
    sales: boolean
    purchases: boolean
    payables: boolean
    payroll: boolean
    logistics: boolean
    treasury: boolean
  }
}

/** Decisão humana sobre um item da conciliação (nada é resolvido automaticamente). */
export type ReviewDecision = 'confirmed' | 'failed' | 'dismissed'
export interface ReviewRecord {
  id: string
  /** Chave estável do item de conciliação (ex.: `treasury:<op>`, `cashbook:<id>`). */
  itemKey: string
  decision: ReviewDecision
  note: string
  /** Evidência informada por quem revisou (hash, link do explorer). O app não verifica sozinho. */
  evidence?: { txHash?: string; explorerUrl?: string }
  actor: Actor
  at: string
}

/** Taxa de câmbio informada e identificada (origem + horário). Nunca é inferida. */
export interface StoredFxRate {
  id: string
  from: CurrencyCode
  to: CurrencyCode
  rate: string
  source: string
  at: string
  recordedBy: Actor
}

/** Situação de um período contábil. Só `closed` bloqueia lançamentos; `review` é um marco informativo de fechamento. */
export type PeriodStatus = 'open' | 'review' | 'closed'

/**
 * Período contábil mensal, identificado pela chave `YYYY-MM`. Períodos ausentes desta lista são considerados
 * abertos (nenhum lançamento é bloqueado). Fechar é uma decisão explícita de um usuário, nunca automática.
 */
export interface AccountingPeriod {
  key: string
  status: PeriodStatus
  closedAt?: string
  closedBy?: Actor
  reopenReason?: string
  reopenedAt?: string
  reopenedBy?: Actor
  /** Ambiente do período (Mainnet/Testnet/unassigned). Ausente = legado/global. */
  environment?: Environment
}

export interface LedgerState {
  orgId: string
  version: 1
  flags: LedgerFlags
  chart: LedgerAccount[]
  /** Categoria do Livro-Caixa (texto canônico) -> subtipo de conta contrapartida. */
  categoryMap: Record<string, AccountSubtype>
  events: FinancialEvent[]
  journal: JournalEntry[]
  audit: AuditRecord[]
  fees: FeeRecord[]
  taxRules: TaxRule[]
  approvals: ApprovalRequest[]
  reviews: ReviewRecord[]
  fxRates: StoredFxRate[]
  /** Períodos contábeis com fechamento explícito. Ausência = período aberto. */
  periods: AccountingPeriod[]
}

export type PostErrorCode =
  | 'org_mismatch'
  | 'agent_cannot_post'
  | 'invalid_amount'
  | 'invalid_currency'
  | 'invalid_date'
  | 'missing_key'
  | 'invalid_source'
  | 'unknown_event_type'
  | 'missing_payload'
  | 'unbalanced'
  | 'unknown_account'
  | 'inactive_account'
  | 'invalid_line'
  | 'too_few_lines'
  | 'currency_account_mismatch'
  | 'not_found'
  | 'already_reversed'
  | 'is_reversal'
  | 'reason_required'
  | 'not_pending'
  | 'not_confirmed'
  | 'invalid_rate'
  | 'rule_not_validated'
  | 'rule_not_effective'
  | 'duplicate_fee'
  | 'not_estimated'
  | 'approval_not_pending'
  | 'approver_must_be_user'
  | 'group_account'
  | 'duplicate_code'
  | 'invalid_code'
  | 'invalid_name'
  | 'invalid_parent'
  | 'account_in_use'
  | 'immutable_field'
  | 'last_active_subtype'
  | 'not_authorized'
  | 'invalid_fx'
  | 'invalid_review'
  | 'invalid_subtype'
  | 'unsupported_category'
  | 'period_closed'
  | 'period_not_found'
  | 'period_already_closed'
  | 'period_not_closed'
  | 'invalid_period'
