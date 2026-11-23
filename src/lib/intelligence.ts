/**
 * Inteligência operacional (fase UI 2.4) — indicadores empresariais derivados de dados reais.
 *
 * Camada PURA e reutilizável (sem React/DOM): o chatbot e os agentes consultam aqui, e o servidor de IA
 * nunca acessa o Store diretamente. Reusa seletores e agrupamento monetário já validados — NÃO cria um
 * segundo motor financeiro.
 *
 * Regras de integridade:
 * - Nunca soma moedas diferentes: agrupa por `groupMoneyByCurrency` (registro sem moeda = "não especificada").
 * - Isolamento Mainnet/Testnet: tudo é escopado por `network` via seletores `*ForEnvironment`.
 * - Respeita cancelamentos (`canceledAt`), liquidações (`accountOutstanding`/`accountIsPartial`) e períodos.
 * - Distingue ausência de dados de erro (funções puras nunca lançam; devolvem coleções vazias).
 */
import type { AppData, Account, CurrencyCode } from './types'
import type { NetworkId } from './network'
import {
  accountIsPartial,
  accountOutstanding,
  accountsForEnvironment,
  lowStockForEnvironment,
  monthPeriod,
  purchasesForEnvironment,
  salesForEnvironment,
  stockValueForEnvironment,
  type Period,
} from './selectors'
import { groupMoneyByCurrency, type MoneyGroup } from './profile-money'
import { daysUntil, round2 } from './format'

/** Grupo monetário em formato estruturado (número + moeda), para o modelo de IA. */
export interface MoneyAmount {
  value: number
  currency: CurrencyCode | 'unspecified'
}

function groupsToAmounts(groups: MoneyGroup[]): MoneyAmount[] {
  return groups.map((g) => ({ value: g.total, currency: g.code }))
}

export interface SalesSummary {
  kind: 'sales'
  /** Período considerado (ex.: mês corrente). */
  period: { from: string; to: string; label: string }
  count: number
  total: MoneyAmount
  averageTicket: number | null
}

export interface PurchasesSummary {
  kind: 'purchases'
  period: { from: string; to: string; label: string }
  count: number
  total: MoneyAmount
}

export interface AccountsSummary {
  kind: 'receivable' | 'payable'
  /** Contas em aberto (não canceladas). */
  openCount: number
  /** Valores em aberto, agrupados por moeda. */
  open: MoneyAmount[]
  /** Valores vencidos (em aberto e com vencimento no passado). */
  overdue: MoneyAmount[]
  /** Contas parcialmente liquidadas. */
  partialCount: number
}

export interface StockSummary {
  kind: 'stock'
  totalItems: number
  /** Produtos com estoque <= mínimo. */
  lowStock: { name: string; stock: number; minStock: number }[]
  /** Valor do estoque (custo × quantidade), na moeda do app. */
  value: MoneyAmount
}

/** Resumo financeiro consolidado (usado pelo chatbot como contexto minimizado). */
export interface BusinessContext {
  company: string
  /** Moeda contábil da empresa (vendas/compras/estoque). */
  currency: CurrencyCode
  network: NetworkId
  /** Período usado para vendas/compras. */
  period: { from: string; to: string; label: string }
  sales: SalesSummary
  purchases: PurchasesSummary
  receivables: AccountsSummary
  payables: AccountsSummary
  stock: StockSummary
}

function salesSummary(data: AppData, network: NetworkId, period: Period): SalesSummary {
  const sales = salesForEnvironment(data, network).filter((s) => !s.canceledAt && s.date >= period.from && s.date <= period.to)
  const total = round2(sales.reduce((s, x) => s + x.total, 0))
  return {
    kind: 'sales',
    period: { from: period.from, to: period.to, label: period.label },
    count: sales.length,
    total: { value: total, currency: data.settings.currency },
    averageTicket: sales.length > 0 ? round2(total / sales.length) : null,
  }
}

function purchasesSummary(data: AppData, network: NetworkId, period: Period): PurchasesSummary {
  const purchases = purchasesForEnvironment(data, network).filter((p) => p.date >= period.from && p.date <= period.to)
  const total = round2(purchases.reduce((s, p) => s + p.total, 0))
  return {
    kind: 'purchases',
    period: { from: period.from, to: period.to, label: period.label },
    count: purchases.length,
    total: { value: total, currency: data.settings.currency },
  }
}

function accountsSummary(data: AppData, network: NetworkId, kind: Account['kind']): AccountsSummary {
  const open = accountsForEnvironment(data.accounts, network).filter((a) => a.kind === kind && a.status === 'open' && !a.canceledAt)
  const overdue = open.filter((a) => daysUntil(a.dueDate) < 0)
  return {
    kind,
    openCount: open.length,
    open: groupsToAmounts(groupMoneyByCurrency(open.map((a) => ({ amount: accountOutstanding(a), currency: a.currency })))),
    overdue: groupsToAmounts(groupMoneyByCurrency(overdue.map((a) => ({ amount: accountOutstanding(a), currency: a.currency })))),
    partialCount: open.filter((a) => accountIsPartial(a)).length,
  }
}

function stockSummary(data: AppData, network: NetworkId): StockSummary {
  const low = lowStockForEnvironment(data, network)
  return {
    kind: 'stock',
    totalItems: data.products.length,
    lowStock: low.map((p) => ({ name: p.name, stock: p.stock, minStock: p.minStock })),
    value: { value: round2(stockValueForEnvironment(data, network)), currency: data.settings.currency },
  }
}

/** Resumo consolidado e minimizado dos indicadores da empresa (a "ponte de leitura" enviada ao provedor). */
export function businessContext(data: AppData, network: NetworkId): BusinessContext {
  const period = monthPeriod(0)
  return {
    company: data.settings.company,
    currency: data.settings.currency,
    network,
    period: { from: period.from, to: period.to, label: period.label },
    sales: salesSummary(data, network, period),
    purchases: purchasesSummary(data, network, period),
    receivables: accountsSummary(data, network, 'receivable'),
    payables: accountsSummary(data, network, 'payable'),
    stock: stockSummary(data, network),
  }
}

/** Consultas individuais (ferramentas de leitura) — contratos explícitos, somente leitura. */
export const businessTools = {
  salesSummary: (data: AppData, network: NetworkId): SalesSummary => salesSummary(data, network, monthPeriod(0)),
  purchasesSummary: (data: AppData, network: NetworkId): PurchasesSummary => purchasesSummary(data, network, monthPeriod(0)),
  receivablesSummary: (data: AppData, network: NetworkId): AccountsSummary => accountsSummary(data, network, 'receivable'),
  payablesSummary: (data: AppData, network: NetworkId): AccountsSummary => accountsSummary(data, network, 'payable'),
  stockSummary,
  businessContext,
}
