import { CAT_SALES, type Account, type AppData, type Environment } from './types'
import { addDays, daysUntil, iso, monthKey, monthLabel, round2, today } from './format'
import { locale } from './i18n'
import { categoryRequiresCogs, natureOfCategory } from './financial-categories'
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
  /** Há receita de mercadorias (venda externa ao PDV) cujo CMV não foi apurado: o lucro não é definitivo. */
  cogsIncomplete: boolean
}

/**
 * Indicadores econômicos e de caixa por período.
 *
 * Distingue RESULTADO ECONÔMICO de FLUXO DE CAIXA:
 * - `revenue`: vendas do PDV + entradas de NATUREZA "receita" (não toda entrada é receita).
 * - `cogs`: custo das mercadorias vendidas, apenas das VENDAS (nunca inferido de pagamentos a fornecedores).
 * - `opex`: saídas de NATUREZA "despesa" (compras de estoque/ativos e amortização de principal NÃO são despesa).
 * - `inflow`/`outflow`: todas as entradas/saídas (caixa), independentemente da natureza.
 * Categorias históricas desconhecidas seguem a regra legada (entrada=receita, saída=despesa) para não perder dados.
 */
export function kpis(data: AppData, p: Period): Kpis {
  const sales = data.sales.filter((s) => !s.canceledAt && inPeriod(s.date, p))
  const inRange = data.entries.filter((e) => inPeriod(e.date, p))
  const otherIncome = inRange.filter((e) => e.type === 'in' && e.category !== CAT_SALES && (natureOfCategory(e.category) ?? 'revenue') === 'revenue')
  const revenue = round2(sales.reduce((s, x) => s + x.total, 0) + otherIncome.reduce((s, x) => s + x.amount, 0))
  const cogs = round2(sales.reduce((s, x) => s + x.cogs, 0))
  const opex = round2(inRange.filter((e) => e.type === 'out' && e.category !== CAT_SALES && (natureOfCategory(e.category) ?? 'expense') === 'expense').reduce((s, x) => s + x.amount, 0))
  const cogsIncomplete = inRange.some((e) => e.type === 'in' && categoryRequiresCogs(e.category) && e.sourceKind !== 'sale')
  return {
    revenue,
    cogs,
    opex,
    cogsIncomplete,
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

// -----------------------------------------------------------------------------------------------------------
// Isolamento operacional por ambiente (fase 3.3): entidades do ERP + indicadores derivados.
// -----------------------------------------------------------------------------------------------------------

/** Filtra uma lista de registros pelo ambiente de origem (exclui `unassigned`). */
export function scopedByEnvironment<T extends { environment?: Environment }>(list: T[], network: NetworkId): T[] {
  return list.filter((x) => x.environment === network)
}

export const productsForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.products, network)
export const movesForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.moves, network)
export const salesForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.sales, network)
export const purchasesForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.purchases, network)
export const contactsForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.contacts, network)
export const employeesForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.employees, network)
export const shipmentsForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.shipments, network)
export const carriersForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.carriers, network)
export const returnsForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.returns, network)
export const receiptsForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.receipts, network)
export const entriesForEnvironment = (data: AppData, network: NetworkId) => scopedByEnvironment(data.entries, network)

/** KPIs com receita/custo/estoque isolados por ambiente (lançamentos do razão permanecem globais). */
export function kpisForEnvironment(data: AppData, network: NetworkId, p: Period): Kpis {
  return kpis({ ...data, sales: salesForEnvironment(data, network), entries: entriesForEnvironment(data, network) }, p)
}

/** Saldo de caixa isolado por ambiente (lançamentos do ambiente de origem). */
export const cashBalanceForEnvironment = (data: AppData, network: NetworkId): number =>
  cashBalance({ ...data, entries: entriesForEnvironment(data, network) })

export const stockValueForEnvironment = (data: AppData, network: NetworkId): number =>
  stockValue({ ...data, products: productsForEnvironment(data, network) })

export const lowStockForEnvironment = (data: AppData, network: NetworkId) => lowStock({ ...data, products: productsForEnvironment(data, network) })

export function topProductsForEnvironment(data: AppData, network: NetworkId, p: Period, limit = 8): Ranked[] {
  return topProducts({ ...data, sales: salesForEnvironment(data, network) }, p, limit)
}

export function monthlySeriesForEnvironment(data: AppData, network: NetworkId, months = 6): MonthPoint[] {
  return monthlySeries({ ...data, sales: salesForEnvironment(data, network), entries: entriesForEnvironment(data, network) }, months)
}

/** Despesas por categoria isoladas por ambiente. */
export function expensesByCategoryForEnvironment(data: AppData, network: NetworkId, p: Period): CategoryTotal[] {
  return expensesByCategory({ ...data, entries: entriesForEnvironment(data, network) }, p)
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
  // Apenas despesas de natureza "despesa": compras de estoque (cogs), ativos e amortização de principal não entram aqui.
  for (const e of data.entries.filter((x) => x.type === 'out' && x.category !== CAT_SALES && (natureOfCategory(x.category) ?? 'expense') === 'expense' && inPeriod(x.date, p))) {
    map.set(e.category, (map.get(e.category) ?? 0) + e.amount)
  }
  return [...map.entries()].map(([category, total]) => ({ category, total: round2(total) })).sort((a, b) => b.total - a.total)
}
