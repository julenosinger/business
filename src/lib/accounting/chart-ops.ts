/**
 * Gestão do plano de contas. Apenas usuários humanos alteram o plano (nunca agentes/sistema).
 * Regras de integridade: código único e imutável; classe/subtipo imutáveis depois de haver lançamentos;
 * conta com lançamentos (mesmo estornados) ou com filhas nunca é excluída; o último subtipo ativo que as regras
 * usam não pode ser desativado nem removido (senão os lançamentos automáticos deixariam de funcionar).
 */
import { descendants, validateChart } from './chart'
import { withAudit, type Ctx, type OpResult } from './engine'
import type { AccountClass, AccountSubtype, LedgerAccount, LedgerState, PostErrorCode } from './types'

export interface AccountInput {
  code: string
  class: AccountClass
  subtype: AccountSubtype
  name: { pt: string; en: string }
  parent?: string
}

const SUBTYPE_CLASS: Record<AccountSubtype, AccountClass | 'any'> = {
  group: 'any',
  cash: 'asset',
  usdc_wallet: 'asset',
  usdc_gateway: 'asset',
  receivable: 'asset',
  inventory: 'asset',
  payable: 'liability',
  payroll_payable: 'liability',
  tax_payable: 'liability',
  equity: 'equity',
  opening: 'equity',
  revenue_sales: 'revenue',
  revenue_other: 'revenue',
  cogs: 'expense',
  expense_operating: 'expense',
  expense_payroll: 'expense',
  expense_freight: 'expense',
  expense_fees: 'expense',
  expense_network: 'expense',
  expense_tax: 'expense',
}

export const SUBTYPES = Object.keys(SUBTYPE_CLASS) as AccountSubtype[]
export const classOfSubtype = (s: AccountSubtype): AccountClass | 'any' => SUBTYPE_CLASS[s]

const CODE_RE = /^[0-9A-Za-z.\-]{1,12}$/
const clean = (s: string, max = 80): string => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** Quantidade de linhas de lançamento (inclusive estornadas) que usam a conta. */
export const accountUsage = (ledger: LedgerState, code: string): number => ledger.journal.reduce((n, j) => n + j.lines.filter((l) => l.accountCode === code).length, 0)

const fail = (ledger: LedgerState, ctx: Ctx, ...errors: PostErrorCode[]): { ok: false; ledger: LedgerState; errors: PostErrorCode[] } => ({
  ok: false,
  ledger: errors.includes('not_authorized') ? withAudit(ledger, ctx, 'event.rejected', 'chart change denied: actor is not a user') : ledger,
  errors,
})

const allowed = (ctx: Ctx): boolean => ctx.actor.kind === 'user'

function checkShape(ledger: LedgerState, input: AccountInput, selfCode?: string): PostErrorCode[] {
  const errors: PostErrorCode[] = []
  const compat = SUBTYPE_CLASS[input.subtype]
  if (compat === undefined) errors.push('invalid_subtype')
  else if (compat !== 'any' && compat !== input.class) errors.push('invalid_subtype')
  const pt = clean(input.name.pt)
  const en = clean(input.name.en) || pt
  if (!pt && !en) errors.push('invalid_name')
  if (input.parent !== undefined && input.parent !== '') {
    const parent = ledger.chart.find((c) => c.code === input.parent)
    if (!parent || parent.class !== input.class) errors.push('invalid_parent')
    else if (selfCode && (parent.code === selfCode || descendants(ledger.chart, selfCode).some((d) => d.code === parent.code))) errors.push('invalid_parent')
  }
  return errors
}

export function createAccount(ledger: LedgerState, input: AccountInput, ctx: Ctx): OpResult<{ code: string }> {
  if (!allowed(ctx)) return fail(ledger, ctx, 'not_authorized')
  const code = input.code.trim()
  if (!CODE_RE.test(code)) return fail(ledger, ctx, 'invalid_code')
  if (ledger.chart.some((c) => c.code === code)) return fail(ledger, ctx, 'duplicate_code')
  const errors = checkShape(ledger, input)
  if (errors.length > 0) return fail(ledger, ctx, ...errors)
  const pt = clean(input.name.pt) || clean(input.name.en)
  const account: LedgerAccount = {
    code,
    class: input.class,
    subtype: input.subtype,
    name: { pt, en: clean(input.name.en) || pt },
    active: true,
    ...(input.parent ? { parent: input.parent } : {}),
  }
  const chart = [...ledger.chart, account]
  if (validateChart(chart).length > 0) return fail(ledger, ctx, 'invalid_code')
  return { ok: true, ledger: withAudit({ ...ledger, chart }, ctx, 'chart.changed', `account ${code} created`), value: { code } }
}

export interface AccountPatch {
  name?: { pt: string; en: string }
  parent?: string | null
  class?: AccountClass
  subtype?: AccountSubtype
}

export function updateAccount(ledger: LedgerState, code: string, patch: AccountPatch, ctx: Ctx): OpResult<{ code: string }> {
  if (!allowed(ctx)) return fail(ledger, ctx, 'not_authorized')
  const current = ledger.chart.find((c) => c.code === code)
  if (!current) return fail(ledger, ctx, 'not_found')
  const used = accountUsage(ledger, code) > 0
  const nextClass = patch.class ?? current.class
  const nextSubtype = patch.subtype ?? current.subtype
  if ((nextClass !== current.class || nextSubtype !== current.subtype) && (used || descendants(ledger.chart, code).length > 0 && nextSubtype !== 'group')) return fail(ledger, ctx, 'immutable_field')
  const nextParent = patch.parent === null ? undefined : (patch.parent ?? current.parent)
  const input: AccountInput = { code, class: nextClass, subtype: nextSubtype, name: patch.name ?? current.name, ...(nextParent ? { parent: nextParent } : {}) }
  const errors = checkShape(ledger, input, code)
  if (errors.length > 0) return fail(ledger, ctx, ...errors)
  // Trocar o subtipo de uma conta ativa pode deixar um subtipo exigido sem conta lançável.
  if (nextSubtype !== current.subtype && current.active && current.subtype !== 'group' && !ledger.chart.some((c) => c.code !== code && c.active && c.subtype === current.subtype)) {
    return fail(ledger, ctx, 'last_active_subtype')
  }
  const pt = clean(input.name.pt) || clean(input.name.en)
  const updated: LedgerAccount = {
    ...current,
    class: nextClass,
    subtype: nextSubtype,
    name: { pt, en: clean(input.name.en) || pt },
    ...(nextParent ? { parent: nextParent } : {}),
  }
  if (!nextParent) delete updated.parent
  return { ok: true, ledger: withAudit({ ...ledger, chart: ledger.chart.map((c) => (c.code === code ? updated : c)) }, ctx, 'chart.changed', `account ${code} updated`), value: { code } }
}

export function setAccountActive(ledger: LedgerState, code: string, active: boolean, ctx: Ctx): OpResult<{ code: string }> {
  if (!allowed(ctx)) return fail(ledger, ctx, 'not_authorized')
  const current = ledger.chart.find((c) => c.code === code)
  if (!current) return fail(ledger, ctx, 'not_found')
  if (current.active === active) return { ok: true, ledger, value: { code } }
  if (!active && current.subtype !== 'group' && !ledger.chart.some((c) => c.code !== code && c.active && c.subtype === current.subtype)) {
    return fail(ledger, ctx, 'last_active_subtype')
  }
  const next: LedgerState = { ...ledger, chart: ledger.chart.map((c) => (c.code === code ? { ...c, active } : c)) }
  return { ok: true, ledger: withAudit(next, ctx, 'chart.changed', `account ${code} ${active ? 'activated' : 'deactivated'}`), value: { code } }
}

export function deleteAccount(ledger: LedgerState, code: string, ctx: Ctx): OpResult<{ code: string }> {
  if (!allowed(ctx)) return fail(ledger, ctx, 'not_authorized')
  const current = ledger.chart.find((c) => c.code === code)
  if (!current) return fail(ledger, ctx, 'not_found')
  if (accountUsage(ledger, code) > 0) return fail(ledger, ctx, 'account_in_use')
  if (ledger.chart.some((c) => c.parent === code)) return fail(ledger, ctx, 'account_in_use')
  if (current.subtype !== 'group' && !ledger.chart.some((c) => c.code !== code && c.subtype === current.subtype && c.active)) return fail(ledger, ctx, 'last_active_subtype')
  return { ok: true, ledger: withAudit({ ...ledger, chart: ledger.chart.filter((c) => c.code !== code) }, ctx, 'chart.changed', `account ${code} deleted`), value: { code } }
}
