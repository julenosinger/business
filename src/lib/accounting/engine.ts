/**
 * Motor contábil central (funcional e imutável).
 *
 * - Eventos de negócio (`FinancialEvent`) são separados de lançamentos (`JournalEntry`) e do Livro-Caixa.
 * - Partida dobrada: total de débitos == total de créditos, por lançamento.
 * - Idempotência: uma chave por evento; reenvio nunca cria um segundo lançamento.
 * - Lançamentos postados são imutáveis. Correções usam estorno vinculado (`reverseEntry`).
 * - Toda função devolve um NOVO `LedgerState`; nada é mutado. A atomicidade vem de aplicar o resultado
 *   completo (evento + lançamento + auditoria) em uma única atualização de estado.
 *
 * Limite conhecido: a persistência atual é localStorage (um navegador, sem transações entre abas).
 * Isso NÃO oferece consistência multiusuário de nível de produção; veja docs/accounting-engine.md.
 */
import type { CurrencyCode, Environment } from '../types'
import { accountByCode, accountBySubtype, defaultCategoryMap, defaultChart, NORMAL_SIDE, USDC_SUBTYPES, validateChart } from './chart'
import { isCurrency, minorFromString, parseRate, mulRate } from './money'
import { FEE_SUBTYPE, isEventType, RULES } from './rules'
import type {
  AccountingPeriod,
  Actor,
  ApprovalRequest,
  AuditAction,
  AuditRecord,
  EventDraft,
  EventStatus,
  FeeKind,
  FeePaidFrom,
  FeeRecord,
  FinancialEvent,
  JournalEntry,
  JournalLine,
  LedgerState,
  PeriodStatus,
  PostErrorCode,
  SourceModule,
  TaxRule,
} from './types'

export const DEFAULT_ORG = 'local'
const AUDIT_CAP = 5000

export function emptyLedger(orgId: string = DEFAULT_ORG): LedgerState {
  return {
    orgId,
    version: 1,
    flags: { adapters: { cashBook: true, sales: false, purchases: false, payables: false, payroll: false, logistics: false, treasury: false } },
    chart: defaultChart(),
    categoryMap: defaultCategoryMap(),
    events: [],
    journal: [],
    audit: [],
    fees: [],
    taxRules: [],
    approvals: [],
    reviews: [],
    fxRates: [],
    periods: [],
  }
}

/** Completa um estado vindo do armazenamento (versões antigas ou parciais) sem descartar nada. */
export function normalizeLedger(raw: Partial<LedgerState> | undefined | null, orgId: string = DEFAULT_ORG): LedgerState {
  const base = emptyLedger(orgId)
  if (!raw || typeof raw !== 'object') return base
  const flags = raw.flags?.adapters ? { adapters: { ...base.flags.adapters, ...raw.flags.adapters } } : base.flags
  return {
    ...base,
    ...raw,
    orgId: typeof raw.orgId === 'string' && raw.orgId ? raw.orgId : base.orgId,
    version: 1,
    flags,
    chart: Array.isArray(raw.chart) && raw.chart.length > 0 && validateChart(raw.chart).length === 0 ? raw.chart : base.chart,
    // Migração aditiva e idempotente: os mapeamentos padrão (incluindo categorias novas) são mesclados com o que
    // já estava salvo; personalizações válidas do usuário têm precedência. Nunca remove mapeamentos existentes.
    categoryMap: { ...base.categoryMap, ...(raw.categoryMap && typeof raw.categoryMap === 'object' ? raw.categoryMap : {}) },
    events: Array.isArray(raw.events) ? raw.events : [],
    journal: Array.isArray(raw.journal) ? raw.journal : [],
    audit: Array.isArray(raw.audit) ? raw.audit : [],
    fees: Array.isArray(raw.fees) ? raw.fees : [],
    taxRules: Array.isArray(raw.taxRules) ? raw.taxRules : [],
    approvals: Array.isArray(raw.approvals) ? raw.approvals : [],
    reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
    fxRates: Array.isArray(raw.fxRates) ? raw.fxRates : [],
    periods: Array.isArray(raw.periods) ? raw.periods : [],
  }
}

export interface Ctx {
  /** Instante ISO da operação (injetado: facilita testes e evita relógio implícito). */
  now: string
  actor: Actor
}

export type PostResult =
  | { ok: true; ledger: LedgerState; eventId: string; entryId: string | null; status: EventStatus; duplicate: boolean }
  | { ok: false; ledger: LedgerState; errors: PostErrorCode[]; eventId?: string }

export type OpResult<T> = { ok: true; ledger: LedgerState; value: T } | { ok: false; ledger: LedgerState; errors: PostErrorCode[] }

const pad = (n: number, w = 6): string => String(n).padStart(w, '0')
const nextSeq = (items: { id: string }[], prefix: string): string => {
  let max = 0
  for (const it of items) {
    if (it.id.startsWith(`${prefix}-`)) {
      const n = Number(it.id.slice(prefix.length + 1))
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}-${pad(max + 1)}`
}

const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s

// ---------------------------------------------------------------------------------------------------------------------
// Períodos contábeis (fechamento explícito, nunca automático)
// ---------------------------------------------------------------------------------------------------------------------

const PERIOD_KEY_RE = /^\d{4}-\d{2}$/

/** Chave do mês de uma data contábil (`YYYY-MM-DD` -> `YYYY-MM`). */
export const periodKeyOf = (date: string): string => date.slice(0, 7)

export const isValidPeriodKey = (key: string): boolean => PERIOD_KEY_RE.test(key)

export const findPeriod = (ledger: LedgerState, key: string, environment?: Environment): AccountingPeriod | undefined =>
  ledger.periods.find((p) => p.key === key && p.environment === environment)

export const periodStatusOf = (ledger: LedgerState, key: string, environment?: Environment): PeriodStatus => findPeriod(ledger, key, environment)?.status ?? 'open'

/**
 * Uma data está em período fechado? (lançamentos bloqueados).
 * - Testnet: apenas períodos Testnet bloqueiam.
 * - Mainnet/legado: períodos Mainnet E períodos legados (sem ambiente) bloqueiam (conservador).
 */
export const isDateClosed = (ledger: LedgerState, date: string, environment?: Environment): boolean => {
  const key = periodKeyOf(date)
  if (environment === 'testnet') return ledger.periods.some((p) => p.key === key && p.environment === 'testnet' && p.status === 'closed')
  return ledger.periods.some((p) => p.key === key && (p.environment === undefined || p.environment === 'mainnet') && p.status === 'closed')
}

const requireUser = (ctx: Ctx): boolean => ctx.actor.kind === 'user'

/** Move um período para "revisão de fechamento" (não bloqueia lançamentos; é um marco com auditoria). */
export function setPeriodReview(ledger: LedgerState, key: string, environment: Environment, ctx: Ctx): OpResult<{ key: string }> {
  if (!requireUser(ctx)) return { ok: false, ledger: withAudit(ledger, ctx, 'event.rejected', 'period review denied: actor is not a user'), errors: ['not_authorized'] }
  if (!isValidPeriodKey(key)) return { ok: false, ledger, errors: ['invalid_period'] }
  const current = findPeriod(ledger, key, environment)
  if (current?.status === 'closed') return { ok: false, ledger, errors: ['period_already_closed'] }
  const period: AccountingPeriod = current ? { ...current, status: 'review' } : { key, environment, status: 'review' }
  const periods = current ? ledger.periods.map((p) => (p.key === key && p.environment === environment ? period : p)) : [...ledger.periods, period]
  return { ok: true, ledger: withAudit({ ...ledger, periods }, ctx, 'period.review', `period ${environment}:${key} -> review`), value: { key } }
}

/** Fecha um período. A partir daqui, lançamentos e estornos nesse mês (e ambiente) são recusados (com auditoria). */
export function closePeriod(ledger: LedgerState, key: string, environment: Environment, ctx: Ctx): OpResult<{ key: string }> {
  if (!requireUser(ctx)) return { ok: false, ledger: withAudit(ledger, ctx, 'event.rejected', 'period close denied: actor is not a user'), errors: ['not_authorized'] }
  if (!isValidPeriodKey(key)) return { ok: false, ledger, errors: ['invalid_period'] }
  const current = findPeriod(ledger, key, environment)
  if (current?.status === 'closed') return { ok: true, ledger, value: { key } } // idempotente
  const period: AccountingPeriod = {
    ...(current ?? { key, environment }),
    status: 'closed',
    closedAt: ctx.now,
    closedBy: ctx.actor,
    // Reabertura anterior deixa de valer ao fechar de novo.
    ...(current ? { reopenReason: undefined, reopenedAt: undefined, reopenedBy: undefined } : {}),
  }
  const periods = current ? ledger.periods.map((p) => (p.key === key && p.environment === environment ? period : p)) : [...ledger.periods, period]
  return { ok: true, ledger: withAudit({ ...ledger, periods }, ctx, 'period.closed', `period ${environment}:${key} closed`), value: { key } }
}

/** Reabre um período fechado, com motivo obrigatório e trilha de auditoria. Único caminho para ajustes em período fechado. */
export function reopenPeriod(ledger: LedgerState, key: string, reason: string, environment: Environment, ctx: Ctx): OpResult<{ key: string }> {
  if (!requireUser(ctx)) return { ok: false, ledger: withAudit(ledger, ctx, 'event.rejected', 'period reopen denied: actor is not a user'), errors: ['not_authorized'] }
  if (!isValidPeriodKey(key)) return { ok: false, ledger, errors: ['invalid_period'] }
  const current = findPeriod(ledger, key, environment)
  if (!current || current.status !== 'closed') return { ok: false, ledger, errors: ['period_not_closed'] }
  const why = reason.trim()
  if (why.length < 3) return { ok: false, ledger, errors: ['reason_required'] }
  const period: AccountingPeriod = { ...current, status: 'open', reopenReason: why.slice(0, 200), reopenedAt: ctx.now, reopenedBy: ctx.actor }
  const periods = ledger.periods.map((p) => (p.key === key && p.environment === environment ? period : p))
  return { ok: true, ledger: withAudit({ ...ledger, periods }, ctx, 'period.reopened', `period ${environment}:${key} reopened: ${why}`), value: { key } }
}

export function withAudit(ledger: LedgerState, ctx: Ctx, action: AuditAction, detail: string, ids: { eventId?: string; entryId?: string } = {}): LedgerState {
  const rec: AuditRecord = { id: nextSeq(ledger.audit, 'AU'), at: ctx.now, actor: ctx.actor, action, orgId: ledger.orgId, detail: detail.slice(0, 300), ...ids }
  const audit = [...ledger.audit, rec]
  return { ...ledger, audit: audit.length > AUDIT_CAP ? audit.slice(audit.length - AUDIT_CAP) : audit }
}

// ---------------------------------------------------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------------------------------------------------

export interface EntryLike {
  currency: CurrencyCode
  lines: JournalLine[]
}

/** Valida partida dobrada, contas e moeda. Não altera nada. */
export function validateEntry(ledger: LedgerState, entry: EntryLike): PostErrorCode[] {
  const errors = new Set<PostErrorCode>()
  if (!isCurrency(entry.currency)) errors.add('invalid_currency')
  if (entry.lines.length < 2) errors.add('too_few_lines')
  let debit = 0n
  let credit = 0n
  for (const line of entry.lines) {
    const amount = minorFromString(line.amountMinor)
    if (amount === null || amount <= 0n || (line.side !== 'debit' && line.side !== 'credit')) {
      errors.add('invalid_line')
      continue
    }
    const acct = accountByCode(ledger, line.accountCode)
    if (!acct) errors.add('unknown_account')
    else {
      if (!acct.active) errors.add('inactive_account')
      if (acct.subtype === 'group') errors.add('group_account')
      if (USDC_SUBTYPES.includes(acct.subtype) && entry.currency !== 'USDC') errors.add('currency_account_mismatch')
    }
    if (line.side === 'debit') debit += amount
    else credit += amount
  }
  if (debit !== credit) errors.add('unbalanced')
  return [...errors]
}

function validateDraft(ledger: LedgerState, draft: EventDraft, ctx: Ctx): PostErrorCode[] {
  const errors: PostErrorCode[] = []
  if (ctx.actor.kind === 'agent') errors.push('agent_cannot_post')
  if (draft.orgId !== ledger.orgId) errors.push('org_mismatch')
  if (!draft.idempotencyKey || !draft.idempotencyKey.trim()) errors.push('missing_key')
  if (!draft.source || !draft.source.recordId || !draft.source.recordId.trim()) errors.push('invalid_source')
  if (!isEventType(draft.type)) errors.push('unknown_event_type')
  if (!isCurrency(draft.currency)) errors.push('invalid_currency')
  if (!isDate(draft.accountingDate)) errors.push('invalid_date')
  if (isDate(draft.accountingDate) && isDateClosed(ledger, draft.accountingDate, draft.environment)) errors.push('period_closed')
  const amount = minorFromString(draft.amountMinor)
  if (amount === null || amount <= 0n) errors.push('invalid_amount')
  return errors
}

// ---------------------------------------------------------------------------------------------------------------------
// Lançamento de eventos
// ---------------------------------------------------------------------------------------------------------------------

function buildEntry(ledger: LedgerState, event: FinancialEvent): { entry: JournalEntry } | { errors: PostErrorCode[] } {
  if (!isEventType(event.type)) return { errors: ['unknown_event_type'] }
  const amount = minorFromString(event.amountMinor)
  if (amount === null || amount <= 0n) return { errors: ['invalid_amount'] }
  const result = RULES[event.type](event, ledger, amount)
  if (!result.ok) return { errors: [result.error] }
  const lines: JournalLine[] = []
  for (const spec of result.lines) {
    const acct = accountBySubtype(ledger, spec.subtype)
    if (!acct) return { errors: ['unknown_account'] }
    lines.push({ accountCode: acct.code, side: spec.side, amountMinor: spec.amount.toString(), ...(spec.memo ? { memo: spec.memo } : {}) })
  }
  const errors = validateEntry(ledger, { currency: event.currency, lines })
  if (errors.length > 0) return { errors }
  const links: Record<string, string> = { sourceModule: event.source.module, sourceRecord: event.source.recordId }
  // Vínculos com registros do app (rastreabilidade): só copia chaves conhecidas e textuais.
  for (const key of ['cashEntryId', 'accountId', 'saleId', 'purchaseId', 'opId', 'txHash', 'chain'] as const) {
    const v = event.payload[key]
    if (typeof v === 'string' && v) links[key] = v
  }
  return {
    entry: {
      id: nextSeq(ledger.journal, 'JE'),
      orgId: ledger.orgId,
      eventId: event.id,
      idempotencyKey: event.idempotencyKey,
      accountingDate: event.accountingDate,
      currency: event.currency,
      memo: result.memo,
      lines,
      postedAt: event.updatedAt,
      postedBy: event.actor,
      links,
      ...(event.environment ? { environment: event.environment } : {}),
    },
  }
}

const replaceEvent = (events: FinancialEvent[], next: FinancialEvent): FinancialEvent[] => events.map((e) => (e.id === next.id ? next : e))

/**
 * Registra um evento e, quando confirmado e válido, gera o lançamento correspondente.
 * Idempotente: a mesma chave nunca gera um segundo lançamento.
 */
export function postEvent(ledger: LedgerState, draft: EventDraft, ctx: Ctx): PostResult {
  const early = validateDraft(ledger, draft, ctx)

  // Erros que impedem até o registro do evento (sem chave/organização confiáveis): só auditoria.
  const unrecordable: PostErrorCode[] = ['agent_cannot_post', 'org_mismatch', 'missing_key', 'invalid_source']
  if (early.some((e) => unrecordable.includes(e))) {
    const audited = withAudit(ledger, ctx, 'event.rejected', `rejected:${early.join(',')}:${draft.type}`)
    return { ok: false, ledger: audited, errors: early }
  }

  const existing = ledger.events.find((e) => e.idempotencyKey === draft.idempotencyKey)
  if (existing && existing.status === 'posted') {
    const audited = withAudit(ledger, ctx, 'event.duplicate', `duplicate:${draft.idempotencyKey}`, { eventId: existing.id, ...(existing.journalEntryId ? { entryId: existing.journalEntryId } : {}) })
    return { ok: true, ledger: audited, eventId: existing.id, entryId: existing.journalEntryId ?? null, status: 'posted', duplicate: true }
  }
  if (existing && existing.status === 'pending' && draft.confirmation === 'pending') {
    const audited = withAudit(ledger, ctx, 'event.duplicate', `duplicate:${draft.idempotencyKey}`, { eventId: existing.id })
    return { ok: true, ledger: audited, eventId: existing.id, entryId: null, status: 'pending', duplicate: true }
  }

  const base: FinancialEvent = existing
    ? { ...existing, ...draft, actor: ctx.actor, updatedAt: ctx.now, attempts: existing.attempts + 1, status: 'pending' }
    : { ...draft, id: nextSeq(ledger.events, 'EV'), status: 'pending', actor: ctx.actor, createdAt: ctx.now, updatedAt: ctx.now, attempts: 1 }
  const { error: _dropped, ...withoutError } = base
  const event: FinancialEvent = withoutError

  const store = (l: LedgerState, ev: FinancialEvent): LedgerState => ({ ...l, events: existing ? replaceEvent(l.events, ev) : [...l.events, ev] })

  if (early.length > 0) {
    const rejected: FinancialEvent = { ...event, status: 'rejected', error: early.join(',') }
    const next = withAudit(store(ledger, rejected), ctx, 'event.rejected', `rejected:${early.join(',')}`, { eventId: rejected.id })
    return { ok: false, ledger: next, errors: early, eventId: rejected.id }
  }

  if (draft.confirmation === 'failed') {
    const failed: FinancialEvent = { ...event, status: 'failed', error: 'operation_failed' }
    const next = withAudit(store(ledger, failed), ctx, 'event.failed', 'operation failed upstream: nothing posted', { eventId: failed.id })
    return { ok: true, ledger: next, eventId: failed.id, entryId: null, status: 'failed', duplicate: false }
  }
  if (draft.confirmation === 'pending') {
    const next = withAudit(store(ledger, event), ctx, 'event.pending', 'awaiting confirmation: nothing posted', { eventId: event.id })
    return { ok: true, ledger: next, eventId: event.id, entryId: null, status: 'pending', duplicate: false }
  }

  const built = buildEntry(ledger, event)
  if ('errors' in built) {
    const rejected: FinancialEvent = { ...event, status: 'rejected', error: built.errors.join(',') }
    const next = withAudit(store(ledger, rejected), ctx, 'event.rejected', `rejected:${built.errors.join(',')}`, { eventId: rejected.id })
    return { ok: false, ledger: next, errors: built.errors, eventId: rejected.id }
  }
  const posted: FinancialEvent = { ...event, status: 'posted', journalEntryId: built.entry.id }
  let next = store(ledger, posted)
  next = { ...next, journal: [...next.journal, built.entry] }
  next = withAudit(next, ctx, 'event.posted', `${posted.type} -> ${built.entry.id}`, { eventId: posted.id, entryId: built.entry.id })
  return { ok: true, ledger: next, eventId: posted.id, entryId: built.entry.id, status: 'posted', duplicate: false }
}

/** Confirma ou falha um evento que estava pendente (ex.: transação on-chain). Só uma vez. */
export function settlePendingEvent(ledger: LedgerState, idempotencyKey: string, outcome: 'confirmed' | 'failed', ctx: Ctx): PostResult {
  const existing = ledger.events.find((e) => e.idempotencyKey === idempotencyKey)
  if (!existing) return { ok: false, ledger, errors: ['not_found'] }
  if (existing.status === 'posted') {
    return { ok: true, ledger: withAudit(ledger, ctx, 'event.duplicate', `already settled:${idempotencyKey}`, { eventId: existing.id }), eventId: existing.id, entryId: existing.journalEntryId ?? null, status: 'posted', duplicate: true }
  }
  if (existing.status !== 'pending') return { ok: false, ledger, errors: ['not_pending'] }
  const { id: _id, status: _s, actor: _a, createdAt: _c, updatedAt: _u, attempts: _at, journalEntryId: _j, error: _e, ...draft } = existing
  return postEvent(ledger, { ...draft, confirmation: outcome }, ctx)
}

// ---------------------------------------------------------------------------------------------------------------------
// Estornos (única forma de corrigir lançamentos postados)
// ---------------------------------------------------------------------------------------------------------------------

export const isReversed = (ledger: LedgerState, entryId: string): boolean => ledger.journal.some((j) => j.reversalOf === entryId)

export function reverseEntry(ledger: LedgerState, entryId: string, reason: string, ctx: Ctx): OpResult<{ entryId: string }> {
  if (ctx.actor.kind === 'agent') return { ok: false, ledger: withAudit(ledger, ctx, 'event.rejected', 'agent cannot reverse', { entryId }), errors: ['agent_cannot_post'] }
  const original = ledger.journal.find((j) => j.id === entryId)
  if (!original) return { ok: false, ledger, errors: ['not_found'] }
  if (original.reversalOf) return { ok: false, ledger, errors: ['is_reversal'] }
  if (isReversed(ledger, entryId)) return { ok: false, ledger, errors: ['already_reversed'] }
  if (isDateClosed(ledger, original.accountingDate, original.environment)) {
    return { ok: false, ledger: withAudit(ledger, ctx, 'event.rejected', `reversal blocked: period ${periodKeyOf(original.accountingDate)} closed`, { entryId }), errors: ['period_closed'] }
  }
  const why = reason.trim()
  if (why.length < 3) return { ok: false, ledger, errors: ['reason_required'] }

  const key = `reversal:${entryId}`
  const evId = nextSeq(ledger.events, 'EV')
  const reversal: JournalEntry = {
    id: nextSeq(ledger.journal, 'JE'),
    orgId: ledger.orgId,
    eventId: evId,
    idempotencyKey: key,
    accountingDate: original.accountingDate,
    currency: original.currency,
    memo: `Estorno de ${original.id}: ${why}`.slice(0, 200),
    lines: original.lines.map((l) => ({ ...l, side: l.side === 'debit' ? 'credit' : 'debit' })),
    postedAt: ctx.now,
    postedBy: ctx.actor,
    links: { ...original.links, reversalOf: original.id },
    reversalOf: original.id,
    reason: why,
    ...(original.environment ? { environment: original.environment } : {}),
  }
  const errors = validateEntry(ledger, reversal)
  if (errors.length > 0) return { ok: false, ledger: withAudit(ledger, ctx, 'event.rejected', `reversal rejected:${errors.join(',')}`, { entryId }), errors }
  const event: FinancialEvent = {
    id: evId,
    orgId: ledger.orgId,
    idempotencyKey: key,
    type: 'adjustment',
    source: { module: 'adjustment', recordId: original.id },
    occurredAt: ctx.now,
    accountingDate: original.accountingDate,
    currency: original.currency,
    amountMinor: original.lines.filter((l) => l.side === 'debit').reduce((s, l) => s + BigInt(l.amountMinor), 0n).toString(),
    payload: { reversalOf: original.id, reason: why },
    confirmation: 'confirmed',
    status: 'posted',
    actor: ctx.actor,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    attempts: 1,
    journalEntryId: reversal.id,
  }
  let next: LedgerState = { ...ledger, events: [...ledger.events, event], journal: [...ledger.journal, reversal] }
  next = withAudit(next, ctx, 'entry.reversed', `${original.id} reversed by ${reversal.id}: ${why}`, { eventId: evId, entryId: reversal.id })
  return { ok: true, ledger: next, value: { entryId: reversal.id } }
}

// ---------------------------------------------------------------------------------------------------------------------
// Taxas e tributos
// ---------------------------------------------------------------------------------------------------------------------

export interface FeeInput {
  source: { module: SourceModule; recordId: string }
  kind: FeeKind
  status: 'estimated' | 'confirmed'
  amountMinor: string
  currency: CurrencyCode
  rate?: string
  relatedRef?: string
  paidFrom: FeePaidFrom
  accountingDate: string
}

export const feeDedupeKey = (i: Pick<FeeInput, 'source' | 'kind' | 'relatedRef'>): string => `${i.source.module}:${i.source.recordId}:${i.kind}:${i.relatedRef ?? ''}`

function postFeeEvent(ledger: LedgerState, fee: FeeRecord, accountingDate: string, ctx: Ctx): PostResult {
  const draft: EventDraft = {
    orgId: ledger.orgId,
    idempotencyKey: `fee:${fee.dedupeKey}`,
    type: 'fee.confirmed',
    source: { module: 'fees', recordId: fee.id },
    occurredAt: ctx.now,
    accountingDate,
    currency: fee.currency,
    amountMinor: fee.amountMinor,
    payload: { feeKind: fee.kind, paidFrom: fee.paidFrom, feeRecord: fee.id, relatedRef: fee.relatedRef ?? null, rate: fee.rate ?? null },
    confirmation: 'confirmed',
  }
  return postEvent(ledger, draft, ctx)
}

/** Registra uma taxa. Estimada: só guarda. Confirmada: guarda e lança. Nunca duplica a mesma taxa. */
export function registerFee(ledger: LedgerState, input: FeeInput, ctx: Ctx): OpResult<{ feeId: string; duplicate: boolean; entryId: string | null }> {
  const amount = minorFromString(input.amountMinor)
  if (amount === null || amount <= 0n) return { ok: false, ledger, errors: ['invalid_amount'] }
  if (!isCurrency(input.currency)) return { ok: false, ledger, errors: ['invalid_currency'] }
  if (!isDate(input.accountingDate)) return { ok: false, ledger, errors: ['invalid_date'] }
  if (input.rate !== undefined && parseRate(input.rate) === null) return { ok: false, ledger, errors: ['invalid_rate'] }
  if (!input.source.recordId.trim()) return { ok: false, ledger, errors: ['invalid_source'] }
  const dedupeKey = feeDedupeKey(input)
  const existing = ledger.fees.find((f) => f.dedupeKey === dedupeKey)
  if (existing) {
    return { ok: true, ledger: withAudit(ledger, ctx, 'event.duplicate', `duplicate fee:${dedupeKey}`), value: { feeId: existing.id, duplicate: true, entryId: null } }
  }
  const fee: FeeRecord = {
    id: nextSeq(ledger.fees, 'FEE'),
    dedupeKey,
    source: input.source,
    kind: input.kind,
    status: input.status,
    amountMinor: input.amountMinor,
    currency: input.currency,
    ...(input.rate !== undefined ? { rate: input.rate } : {}),
    ...(input.relatedRef ? { relatedRef: input.relatedRef } : {}),
    paidFrom: input.paidFrom,
    createdAt: ctx.now,
    ...(input.status === 'confirmed' ? { confirmedAt: ctx.now } : {}),
  }
  let next: LedgerState = withAudit({ ...ledger, fees: [...ledger.fees, fee] }, ctx, 'fee.registered', `${fee.kind} ${fee.status} ${fee.id}`)
  if (input.status !== 'confirmed') return { ok: true, ledger: next, value: { feeId: fee.id, duplicate: false, entryId: null } }
  const posted = postFeeEvent(next, fee, input.accountingDate, ctx)
  next = posted.ledger
  if (!posted.ok) return { ok: false, ledger: next, errors: posted.errors }
  return { ok: true, ledger: next, value: { feeId: fee.id, duplicate: false, entryId: posted.entryId } }
}

/** Confirma uma taxa estimada (uma única vez) e a lança. */
export function confirmFee(ledger: LedgerState, dedupeKey: string, patch: { amountMinor?: string; relatedRef?: string; accountingDate: string }, ctx: Ctx): OpResult<{ entryId: string | null }> {
  const fee = ledger.fees.find((f) => f.dedupeKey === dedupeKey)
  if (!fee) return { ok: false, ledger, errors: ['not_found'] }
  if (fee.status !== 'estimated') return { ok: false, ledger, errors: ['not_estimated'] }
  if (patch.amountMinor !== undefined) {
    const amount = minorFromString(patch.amountMinor)
    if (amount === null || amount <= 0n) return { ok: false, ledger, errors: ['invalid_amount'] }
  }
  const confirmed: FeeRecord = { ...fee, status: 'confirmed', confirmedAt: ctx.now, amountMinor: patch.amountMinor ?? fee.amountMinor, ...(patch.relatedRef ? { relatedRef: patch.relatedRef } : {}) }
  let next: LedgerState = withAudit({ ...ledger, fees: ledger.fees.map((f) => (f.id === fee.id ? confirmed : f)) }, ctx, 'fee.confirmed', `${fee.id} confirmed`)
  const posted = postFeeEvent(next, confirmed, patch.accountingDate, ctx)
  next = posted.ledger
  if (!posted.ok) return { ok: false, ledger: next, errors: posted.errors }
  return { ok: true, ledger: next, value: { entryId: posted.entryId } }
}

/** Calcula um tributo SOMENTE com regra configurada e validada pelo usuário. Nunca assume alíquota. */
export function computeTax(
  ledger: LedgerState,
  ruleId: string,
  baseMinor: bigint,
  onDate: string,
): { ok: true; taxMinor: bigint; rule: TaxRule } | { ok: false; error: PostErrorCode } {
  const rule = ledger.taxRules.find((r) => r.id === ruleId)
  if (!rule) return { ok: false, error: 'not_found' }
  if (!rule.validated) return { ok: false, error: 'rule_not_validated' }
  if (!isDate(onDate) || onDate < rule.effectiveFrom || (rule.effectiveTo && onDate > rule.effectiveTo)) return { ok: false, error: 'rule_not_effective' }
  const tax = mulRate(baseMinor, rule.rate)
  if (tax === null) return { ok: false, error: 'invalid_rate' }
  return { ok: true, taxMinor: tax, rule }
}

// ---------------------------------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------------------------------

export interface TrialRow {
  code: string
  name: { pt: string; en: string }
  class: string
  debit: bigint
  credit: bigint
  /** Saldo no lado normal da conta (positivo = saldo natural). */
  balance: bigint
}
export interface TrialBalance {
  currency: CurrencyCode
  rows: TrialRow[]
  totalDebit: bigint
  totalCredit: bigint
  balanced: boolean
}

export function trialBalance(ledger: LedgerState, opts: { currency?: CurrencyCode; upToDate?: string } = {}): TrialBalance[] {
  const byCurrency = new Map<CurrencyCode, Map<string, { debit: bigint; credit: bigint }>>()
  for (const entry of ledger.journal) {
    if (entry.orgId !== ledger.orgId) continue
    if (opts.currency && entry.currency !== opts.currency) continue
    if (opts.upToDate && entry.accountingDate > opts.upToDate) continue
    const cur = byCurrency.get(entry.currency) ?? new Map<string, { debit: bigint; credit: bigint }>()
    for (const line of entry.lines) {
      const row = cur.get(line.accountCode) ?? { debit: 0n, credit: 0n }
      const v = BigInt(line.amountMinor)
      if (line.side === 'debit') row.debit += v
      else row.credit += v
      cur.set(line.accountCode, row)
    }
    byCurrency.set(entry.currency, cur)
  }
  const out: TrialBalance[] = []
  for (const [currency, rows] of byCurrency) {
    let totalDebit = 0n
    let totalCredit = 0n
    const list: TrialRow[] = []
    for (const acct of ledger.chart) {
      const r = rows.get(acct.code)
      if (!r) continue
      totalDebit += r.debit
      totalCredit += r.credit
      const normalDebit = NORMAL_SIDE[acct.class] === 'debit'
      list.push({ code: acct.code, name: acct.name, class: acct.class, debit: r.debit, credit: r.credit, balance: normalDebit ? r.debit - r.credit : r.credit - r.debit })
    }
    out.push({ currency, rows: list, totalDebit, totalCredit, balanced: totalDebit === totalCredit })
  }
  return out.sort((a, b) => a.currency.localeCompare(b.currency))
}

export function accountBalance(ledger: LedgerState, code: string, currency: CurrencyCode, upToDate?: string): bigint {
  const tb = trialBalance(ledger, { currency, ...(upToDate ? { upToDate } : {}) })[0]
  return tb?.rows.find((r) => r.code === code)?.balance ?? 0n
}

export const latestCashBookRevision = (ledger: LedgerState, cashEntryId: string): number => {
  let rev = -1
  const prefix = `cashbook:${cashEntryId}:r`
  for (const e of ledger.events) {
    if (e.idempotencyKey.startsWith(prefix)) {
      const n = Number(e.idempotencyKey.slice(prefix.length))
      if (Number.isInteger(n) && n > rev) rev = n
    }
  }
  return rev
}

/** Lançamento ativo (não estornado) ligado a um registro do Livro-Caixa, se houver. */
export function activeEntryForCashEntry(ledger: LedgerState, cashEntryId: string): JournalEntry | undefined {
  return ledger.journal.find((j) => j.links.cashEntryId === cashEntryId && !j.reversalOf && !isReversed(ledger, j.id))
}

// ---------------------------------------------------------------------------------------------------------------------
// Aprovações (caminho obrigatório para qualquer proposta de agente/IA)
// ---------------------------------------------------------------------------------------------------------------------

export interface PreparedEntry {
  ok: boolean
  errors: PostErrorCode[]
  lines: JournalLine[]
  memo: string
}

/** Simula um evento SEM gravar nada: devolve as linhas que seriam lançadas e os erros de validação. */
export function prepareEntry(ledger: LedgerState, draft: EventDraft): PreparedEntry {
  const errors = validateDraft(ledger, draft, { now: draft.occurredAt, actor: { id: 'preview', kind: 'system' } })
  if (errors.length > 0) return { ok: false, errors, lines: [], memo: '' }
  const probe: FinancialEvent = { ...draft, id: 'EV-PREVIEW', status: 'pending', actor: { id: 'preview', kind: 'system' }, createdAt: draft.occurredAt, updatedAt: draft.occurredAt, attempts: 0 }
  const built = buildEntry(ledger, probe)
  if ('errors' in built) return { ok: false, errors: built.errors, lines: [], memo: '' }
  return { ok: true, errors: [], lines: built.entry.lines, memo: built.entry.memo }
}

export function requestApproval(ledger: LedgerState, draft: EventDraft, requester: Actor, note: string, now: string): OpResult<{ approvalId: string }> {
  const ctx: Ctx = { now, actor: requester }
  const prepared = prepareEntry(ledger, draft)
  if (!prepared.ok) return { ok: false, ledger: withAudit(ledger, ctx, 'event.rejected', `approval request invalid:${prepared.errors.join(',')}`), errors: prepared.errors }
  const req: ApprovalRequest = { id: nextSeq(ledger.approvals, 'AP'), orgId: ledger.orgId, createdAt: now, requestedBy: requester, note: note.slice(0, 300), draft, status: 'pending' }
  const next = withAudit({ ...ledger, approvals: [...ledger.approvals, req] }, ctx, 'approval.requested', `${req.id} ${draft.type}`)
  return { ok: true, ledger: next, value: { approvalId: req.id } }
}

export function decideApproval(ledger: LedgerState, approvalId: string, approver: Actor, decision: 'approve' | 'reject', now: string, note = ''): OpResult<{ entryId: string | null }> {
  const ctx: Ctx = { now, actor: approver }
  const req = ledger.approvals.find((a) => a.id === approvalId)
  if (!req) return { ok: false, ledger, errors: ['not_found'] }
  if (approver.kind !== 'user') return { ok: false, ledger: withAudit(ledger, ctx, 'event.rejected', 'approver must be a user', {}), errors: ['approver_must_be_user'] }
  if (req.status !== 'pending') return { ok: false, ledger, errors: ['approval_not_pending'] }
  if (decision === 'reject') {
    const next = withAudit({ ...ledger, approvals: ledger.approvals.map((a) => (a.id === req.id ? { ...a, status: 'rejected' as const, decidedBy: approver, decidedAt: now, decisionNote: note } : a)) }, ctx, 'approval.rejected', req.id)
    return { ok: true, ledger: next, value: { entryId: null } }
  }
  const posted = postEvent(ledger, req.draft, ctx)
  if (!posted.ok) return { ok: false, ledger: posted.ledger, errors: posted.errors }
  const next = withAudit(
    { ...posted.ledger, approvals: posted.ledger.approvals.map((a) => (a.id === req.id ? { ...a, status: 'approved' as const, decidedBy: approver, decidedAt: now, decisionNote: note, ...(posted.entryId ? { resultEntryId: posted.entryId } : {}) } : a)) },
    ctx,
    'approval.approved',
    `${req.id} -> ${posted.entryId ?? 'none'}`,
    posted.entryId ? { entryId: posted.entryId } : {},
  )
  return { ok: true, ledger: next, value: { entryId: posted.entryId } }
}

export type AdapterFlagName = keyof LedgerState['flags']['adapters']

/** Liga/desliga um adaptador (recurso controlado por flag). Fica registrado na auditoria. */
export function setAdapterFlag(ledger: LedgerState, name: AdapterFlagName, on: boolean, ctx: Ctx): LedgerState {
  if (ledger.flags.adapters[name] === on) return ledger
  const next: LedgerState = { ...ledger, flags: { adapters: { ...ledger.flags.adapters, [name]: on } } }
  return withAudit(next, ctx, 'flag.changed', `adapter ${name} -> ${on ? 'on' : 'off'}`)
}

export { FEE_SUBTYPE }
