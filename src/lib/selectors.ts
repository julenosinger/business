import { CAT_PURCHASE, CAT_SALES, type Account, type AppData } from './types'
import { addDays, daysUntil, iso, monthKey, monthLabel, round2, today } from './format'
import { locale } from './i18n'
import type { NetworkId } from './network'

export interface Period {
  from: string
  to: string
  label: string
}

export function monthPeriod(offset = 0): Period {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: iso(start), to: iso(end), label: start.toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) }
}

export const inPeriod = (date: string, p: Period): boolean => date >= p.from && date <= p.to

export interface Kpis {
  revenue: number
  cogs: number
  opex: number
  grossProfit: number
  profit: number
  inflow: number
  outflow: number
}

export function kpis(data: AppData, p: Period): Kpis {
  const sales = data.sales.filter((s) => !s.canceledAt && inPeriod(s.date, p))
  const otherIncome = data.entries.filter((e) => e.type === 'in' && e.category !== CAT_SALES && inPeriod(e.date, p))
  const revenue = round2(sales.reduce((s, x) => s + x.total, 0) + otherIncome.reduce((s, x) => s + x.amount, 0))
  const cogs = round2(sales.reduce((s, x) => s + x.cogs, 0))
  const opex = round2(
    data.entries.filter((e) => e.type === 'out' && e.category !== CAT_PURCHASE && e.category !== CAT_SALES && inPeriod(e.date, p)).reduce((s, x) => s + x.amount, 0),
  )
  const inRange = data.entries.filter((e) => inPeriod(e.date, p))
  return {
    revenue,
    cogs,
    opex,
    grossProfit: round2(revenue - cogs),
    profit: round2(revenue - cogs - opex),
    inflow: round2(inRange.filter((e) => e.type === 'in').reduce((s, x) => s + x.amount, 0)),
    outflow: round2(inRange.filter((e) => e.type === 'out').reduce((s, x) => s + x.amount, 0)),
  }
}

export const cashBalance = (data: AppData): number =>
  round2(data.entries.reduce((s, e) => s + (e.type === 'in' ? e.amount : -e.amount), 0))

export const stockValue = (data: AppData): number => round2(data.products.reduce((s, p) => s + p.stock * p.cost, 0))

export const lowStock = (data: AppData) => data.products.filter((p) => p.stock <= p.minStock)

export function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
}

export interface MonthPoint {
  key: string
  label: string
  revenue: number
  profit: number
  inflow: number
  outflow: number
}

export function monthlySeries(data: AppData, months = 6): MonthPoint[] {
  const out: MonthPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const p = monthPeriod(-i)
    const k = kpis(data, p)
    const key = monthKey(p.from)
    out.push({ key, label: monthLabel(key), revenue: k.revenue, profit: k.profit, inflow: k.inflow, outflow: k.outflow })
  }
  return out
}

export interface Totals {
  receivable: number
  payable: number
  overduePayable: number
  overdueReceivable: number
}

/** Valor já liquidado de uma conta (soma das liquidações parciais). */
export function accountPaidAmount(a: Account): number {
  return round2((a.settlements ?? []).reduce((s, x) => s + x.amount, 0))
}

/** Saldo em aberto de uma conta (valor original menos o já liquidado). */
export function accountOutstanding(a: Account): number {
  return round2(a.amount - accountPaidAmount(a))
}

/** Conta parcialmente liquidada (tem liquidações, mas ainda não está paga). */
export function accountIsPartial(a: Account): boolean {
  return a.status === 'open' && (a.settlements?.length ?? 0) > 0
}

/** Obrigações pertencentes ao ambiente financeiro de origem (exclui `unassigned`). */
export function accountsForEnvironment(accounts: Account[], network: NetworkId): Account[] {
  return accounts.filter((a) => a.environment === network)
}

export function accountTotals(data: AppData): Totals {
  const open = data.accounts.filter((a) => a.status === 'open' && !a.canceledAt)
  const sum = (list: Account[]) => round2(list.reduce((s, a) => s + accountOutstanding(a), 0))
  const rec = open.filter((a) => a.kind === 'receivable')
  const pay = open.filter((a) => a.kind === 'payable')
  return {
    receivable: sum(rec),
    payable: sum(pay),
    overduePayable: sum(pay.filter((a) => daysUntil(a.dueDate) < 0)),
    overdueReceivable: sum(rec.filter((a) => daysUntil(a.dueDate) < 0)),
  }
}

/** Totais isolados por ambiente (usado por Dashboard, Finance e assistente). */
export function accountTotalsForEnvironment(data: AppData, network: NetworkId): Totals {
  return accountTotals({ ...data, accounts: accountsForEnvironment(data.accounts, network) })
}

export function upcoming(data: AppData, limit = 5): Account[] {
  return data.accounts
    .filter((a) => a.status === 'open' && !a.canceledAt)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, limit)
}

/** Próximas obrigações isoladas por ambiente. */
export function upcomingForEnvironment(data: AppData, network: NetworkId, limit = 5): Account[] {
  return upcoming({ ...data, accounts: accountsForEnvironment(data.accounts, network) }, limit)
}

export function dueSoon(data: AppData, kind: Account['kind'], days: number): Account[] {
  const limit = addDays(today(), days)
  return data.accounts.filter((a) => a.kind === kind && a.status === 'open' && !a.canceledAt && a.dueDate <= limit)
}

/** Obrigações a vencer em breve, isoladas por ambiente. */
export function dueSoonForEnvironment(data: AppData, network: NetworkId, kind: Account['kind'], days: number): Account[] {
  return dueSoon({ ...data, accounts: accountsForEnvironment(data.accounts, network) }, kind, days)
}

export interface Ranked {
  name: string
  qty: number
  revenue: number
  profit: number
}

export function topProducts(data: AppData, p: Period, limit = 8): Ranked[] {
  const map = new Map<string, Ranked>()
  for (const s of data.sales.filter((x) => !x.canceledAt && inPeriod(x.date, p))) {
    for (const it of s.items) {
      const cur = map.get(it.productId) ?? { name: it.name, qty: 0, revenue: 0, profit: 0 }
      cur.qty += it.qty
      cur.revenue += it.qty * it.price
      cur.profit += it.qty * (it.price - it.cost)
      map.set(it.productId, cur)
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit)
}

export interface CategoryTotal {
  category: string
  total: number
}

export function expensesByCategory(data: AppData, p: Period): CategoryTotal[] {
  const map = new Map<string, number>()
  for (const e of data.entries.filter((x) => x.type === 'out' && x.category !== CAT_SALES && inPeriod(x.date, p))) {
    map.set(e.category, (map.get(e.category) ?? 0) + e.amount)
  }
  return [...map.entries()].map(([category, total]) => ({ category, total: round2(total) })).sort((a, b) => b.total - a.total)
}
