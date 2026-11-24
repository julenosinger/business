import type { AccountClass, AccountSubtype, LedgerAccount, LedgerState } from './types'

/**
 * Plano de contas padrão, genérico, hierárquico e configurável (não é fiscal nem específico de um país).
 * Os códigos são só rótulos de organização; as regras usam o SUBTIPO da conta. Contas `group` apenas agrupam.
 * Modelos por país (templates) poderão ser adicionados no futuro sem alterar o motor.
 */
export function defaultChart(): LedgerAccount[] {
  const a = (code: string, cls: AccountClass, subtype: AccountSubtype, pt: string, en: string, parent?: string): LedgerAccount => ({
    code,
    class: cls,
    subtype,
    name: { pt, en },
    active: true,
    ...(parent ? { parent } : {}),
  })
  return [
    a('1', 'asset', 'group', 'Ativo', 'Assets'),
    a('1000', 'asset', 'cash', 'Caixa e equivalentes', 'Cash and equivalents', '1'),
    a('1010', 'asset', 'usdc_wallet', 'USDC em carteiras', 'USDC in wallets', '1'),
    a('1020', 'asset', 'usdc_gateway', 'Saldo no Circle Gateway', 'Circle Gateway balance', '1'),
    a('1100', 'asset', 'receivable', 'Contas a receber', 'Accounts receivable', '1'),
    a('1200', 'asset', 'inventory', 'Estoque de mercadorias', 'Merchandise inventory', '1'),
    a('2', 'liability', 'group', 'Passivo', 'Liabilities'),
    a('2000', 'liability', 'payable', 'Contas a pagar', 'Accounts payable', '2'),
    a('2100', 'liability', 'payroll_payable', 'Folha a pagar', 'Payroll payable', '2'),
    a('2200', 'liability', 'tax_payable', 'Impostos a recolher', 'Taxes payable', '2'),
    a('3', 'equity', 'group', 'Patrimônio líquido', 'Equity'),
    a('3000', 'equity', 'equity', 'Patrimônio líquido', 'Owner equity', '3'),
    a('3900', 'equity', 'opening', 'Saldos iniciais e conciliação', 'Opening balances and reconciliation', '3'),
    a('4', 'revenue', 'group', 'Receitas', 'Revenue'),
    a('4000', 'revenue', 'revenue_sales', 'Receita de vendas', 'Sales revenue', '4'),
    a('4900', 'revenue', 'revenue_other', 'Outras receitas', 'Other revenue', '4'),
    a('5', 'expense', 'group', 'Custos e despesas', 'Costs and expenses'),
    a('5000', 'expense', 'cogs', 'Custo das mercadorias vendidas', 'Cost of goods sold', '5'),
    a('5100', 'expense', 'expense_operating', 'Despesas operacionais', 'Operating expenses', '5'),
    a('5110', 'expense', 'expense_payroll', 'Folha de pagamento', 'Payroll expense', '5100'),
    a('5120', 'expense', 'expense_freight', 'Frete e logística', 'Freight and logistics', '5100'),
    a('5130', 'expense', 'expense_fees', 'Taxas de gateway e processamento', 'Gateway and processing fees', '5100'),
    a('5140', 'expense', 'expense_network', 'Taxas de rede (gas)', 'Network (gas) fees', '5100'),
    a('5150', 'expense', 'expense_tax', 'Impostos e tributos', 'Taxes and levies', '5100'),
  ]
}

/** Modelos de plano de contas. Só o genérico existe; modelos por país entram em fases futuras. */
export const CHART_TEMPLATES: Record<string, () => LedgerAccount[]> = { generic: defaultChart }

/** Mapeamento padrão das categorias do Livro-Caixa para a contrapartida contábil. */
export function defaultCategoryMap(): Record<string, AccountSubtype> {
  return {
    'Serviços prestados': 'revenue_other',
    'Outras receitas': 'revenue_other',
    Rendimentos: 'revenue_other',
    Vendas: 'revenue_sales',
    'Venda de mercadorias': 'revenue_sales',
    'Venda de produtos': 'revenue_sales',
    Consultoria: 'revenue_other',
    'Assinaturas e mensalidades': 'revenue_other',
    Comissões: 'revenue_other',
    'Licenciamento e royalties': 'revenue_other',
    'Contratos recorrentes': 'revenue_other',
    'Juros recebidos': 'revenue_other',
    'Multas recebidas': 'revenue_other',
    'Descontos financeiros obtidos': 'revenue_other',
    'Aluguéis recebidos': 'revenue_other',
    Indenizações: 'revenue_other',
    'Compra de mercadorias': 'inventory',
    'Matéria-prima': 'inventory',
    Insumos: 'inventory',
    Embalagens: 'inventory',
    'Folha de pagamento': 'expense_payroll',
    Benefícios: 'expense_payroll',
    'Encargos trabalhistas': 'expense_payroll',
    Impostos: 'expense_tax',
    'Impostos e tributos': 'expense_tax',
    Logística: 'expense_freight',
    Fretes: 'expense_freight',
    Aluguel: 'expense_operating',
    Marketing: 'expense_operating',
    'Marketing e publicidade': 'expense_operating',
    'Serviços e utilidades': 'expense_operating',
    'Outras despesas': 'expense_operating',
    'Outras obrigações': 'expense_operating',
    Manutenção: 'expense_operating',
    'Serviços terceirizados': 'expense_operating',
    'Energia elétrica': 'expense_operating',
    'Água e saneamento': 'expense_operating',
    'Internet e telefonia': 'expense_operating',
    'Software e assinaturas': 'expense_operating',
    'Material de escritório': 'expense_operating',
    'Consultoria e assessoria': 'expense_operating',
    Seguros: 'expense_operating',
    'Viagens e deslocamentos': 'expense_operating',
    Treinamento: 'expense_operating',
    'Reembolsos a funcionários': 'expense_operating',
    Juros: 'expense_operating',
    Multas: 'expense_operating',
    'Taxas bancárias': 'expense_fees',
    'Tarifas financeiras': 'expense_fees',
    'Taxas de transação': 'expense_fees',
  }
}

export const NORMAL_SIDE: Record<AccountClass, 'debit' | 'credit'> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
}

export const accountByCode = (ledger: Pick<LedgerState, 'chart'>, code: string): LedgerAccount | undefined => ledger.chart.find((c) => c.code === code)

/** Primeira conta ATIVA e lançável do subtipo (a ordem do plano de contas decide quando houver mais de uma). */
export const accountBySubtype = (ledger: Pick<LedgerState, 'chart'>, subtype: AccountSubtype): LedgerAccount | undefined =>
  ledger.chart.find((c) => c.subtype === subtype && c.active && c.subtype !== 'group')

/** Contas de USDC só aceitam lançamentos em USDC (USD e USDC nunca se misturam). */
export const USDC_SUBTYPES: AccountSubtype[] = ['usdc_wallet', 'usdc_gateway']

export const isGroup = (a: Pick<LedgerAccount, 'subtype'>): boolean => a.subtype === 'group'

export function validateChart(chart: LedgerAccount[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const c of chart) {
    if (!/^[0-9A-Za-z.\-]{1,12}$/.test(c.code)) errors.push(`invalid_code:${c.code}`)
    if (seen.has(c.code)) errors.push(`duplicate_code:${c.code}`)
    seen.add(c.code)
    if (!c.name.pt.trim() || !c.name.en.trim()) errors.push(`missing_name:${c.code}`)
  }
  for (const c of chart) {
    if (c.parent !== undefined && c.parent === c.code) errors.push(`self_parent:${c.code}`)
  }
  return errors
}

/** Descendentes de uma conta (para impedir ciclos e mostrar a árvore). */
export function descendants(chart: LedgerAccount[], code: string): LedgerAccount[] {
  const out: LedgerAccount[] = []
  const walk = (parent: string) => {
    for (const c of chart) {
      if (c.parent === parent && !out.includes(c)) {
        out.push(c)
        walk(c.code)
      }
    }
  }
  walk(code)
  return out
}

/** Ordem de exibição em árvore (pais antes dos filhos), com profundidade. Pais ausentes tratam a conta como raiz. */
export function chartTree(chart: LedgerAccount[]): { account: LedgerAccount; depth: number }[] {
  const codes = new Set(chart.map((c) => c.code))
  const out: { account: LedgerAccount; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (parent: string | undefined, depth: number) => {
    for (const c of chart) {
      const isRoot = parent === undefined && (c.parent === undefined || !codes.has(c.parent))
      if ((isRoot || (parent !== undefined && c.parent === parent)) && !seen.has(c.code)) {
        seen.add(c.code)
        out.push({ account: c, depth })
        walk(c.code, depth + 1)
      }
    }
  }
  walk(undefined, 0)
  // Contas em ciclos (dados corrompidos) ainda aparecem, como raiz.
  for (const c of chart) if (!seen.has(c.code)) out.push({ account: c, depth: 0 })
  return out
}
