/**
 * Catálogo central de categorias financeiras (fase FIN-03) — fonte única da taxonomia.
 *
 * O campo `Account.category` continua sendo a string canônica (pt) usada pelos registros;
 * este catálogo acrescenta METADADOS (grupo, natureza financeira, mapeamento contábil) sem
 * alterar os contratos existentes. Categorias com `supported: false` exigem suporte contábil
 * específico ainda não certificado e NÃO aparecem nos seletores (nunca classificadas como
 * receita/despesa indevidamente).
 */
import type { AccountSubtype } from './accounting/types'

export type FinancialNature = 'revenue' | 'cogs' | 'expense' | 'asset' | 'liability'

export type FinancialGroup =
  | 'operational_revenue'
  | 'financial_revenue'
  | 'other_revenue'
  | 'receivable_rights'
  | 'operational_cost'
  | 'administrative'
  | 'personnel'
  | 'financial_fiscal'
  | 'investments_obligations'

export interface FinancialCategory {
  /** String canônica (pt) usada em `Account.category`. */
  id: string
  labelEn: string
  kind: 'income' | 'expense'
  group: FinancialGroup
  nature: FinancialNature
  accounting: AccountSubtype
  supported: boolean
  system: boolean
}

export const GROUP_LABELS: Record<FinancialGroup, { pt: string; en: string }> = {
  operational_revenue: { pt: 'Receitas operacionais', en: 'Operating revenue' },
  financial_revenue: { pt: 'Receitas financeiras', en: 'Financial revenue' },
  other_revenue: { pt: 'Outras receitas', en: 'Other revenue' },
  receivable_rights: { pt: 'Outros direitos a receber', en: 'Other receivables' },
  operational_cost: { pt: 'Custos operacionais', en: 'Operating costs' },
  administrative: { pt: 'Despesas administrativas', en: 'Administrative expenses' },
  personnel: { pt: 'Despesas com pessoal', en: 'Personnel expenses' },
  financial_fiscal: { pt: 'Despesas financeiras e fiscais', en: 'Financial and tax expenses' },
  investments_obligations: { pt: 'Investimentos e outras obrigações', en: 'Investments and other obligations' },
}

export const FINANCIAL_CATEGORIES: FinancialCategory[] = [
  // --- Receitas operacionais ---
  { id: 'Venda de mercadorias', labelEn: 'Merchandise sales', kind: 'income', group: 'operational_revenue', nature: 'revenue', accounting: 'revenue_sales', supported: true, system: true },
  { id: 'Venda de produtos', labelEn: 'Product sales', kind: 'income', group: 'operational_revenue', nature: 'revenue', accounting: 'revenue_sales', supported: true, system: true },
  { id: 'Serviços prestados', labelEn: 'Services rendered', kind: 'income', group: 'operational_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  { id: 'Consultoria', labelEn: 'Consulting', kind: 'income', group: 'operational_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  { id: 'Assinaturas e mensalidades', labelEn: 'Subscriptions and fees', kind: 'income', group: 'operational_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  { id: 'Comissões', labelEn: 'Commissions', kind: 'income', group: 'operational_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  { id: 'Licenciamento e royalties', labelEn: 'Licensing and royalties', kind: 'income', group: 'operational_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  { id: 'Contratos recorrentes', labelEn: 'Recurring contracts', kind: 'income', group: 'operational_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  // --- Receitas financeiras ---
  { id: 'Juros recebidos', labelEn: 'Interest received', kind: 'income', group: 'financial_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  { id: 'Rendimentos', labelEn: 'Investment income', kind: 'income', group: 'financial_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  { id: 'Multas recebidas', labelEn: 'Fines received', kind: 'income', group: 'financial_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  { id: 'Descontos financeiros obtidos', labelEn: 'Financial discounts obtained', kind: 'income', group: 'financial_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  // --- Outras receitas ---
  { id: 'Aluguéis recebidos', labelEn: 'Rent received', kind: 'income', group: 'other_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  { id: 'Indenizações', labelEn: 'Indemnities', kind: 'income', group: 'other_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  { id: 'Outras receitas', labelEn: 'Other income', kind: 'income', group: 'other_revenue', nature: 'revenue', accounting: 'revenue_other', supported: true, system: true },
  // --- Outros direitos a receber (não-receita; suporte contábil pendente) ---
  { id: 'Reembolsos', labelEn: 'Reimbursements', kind: 'income', group: 'receivable_rights', nature: 'asset', accounting: 'receivable', supported: false, system: true },
  { id: 'Restituições', labelEn: 'Refunds', kind: 'income', group: 'receivable_rights', nature: 'asset', accounting: 'receivable', supported: false, system: true },
  { id: 'Créditos a recuperar', labelEn: 'Credits to recover', kind: 'income', group: 'receivable_rights', nature: 'asset', accounting: 'receivable', supported: false, system: true },
  { id: 'Empréstimos concedidos a receber', labelEn: 'Loans receivable', kind: 'income', group: 'receivable_rights', nature: 'asset', accounting: 'receivable', supported: false, system: true },
  { id: 'Adiantamentos a recuperar', labelEn: 'Advances to recover', kind: 'income', group: 'receivable_rights', nature: 'asset', accounting: 'receivable', supported: false, system: true },

  // --- Custos operacionais ---
  { id: 'Compra de mercadorias', labelEn: 'Merchandise purchases', kind: 'expense', group: 'operational_cost', nature: 'cogs', accounting: 'inventory', supported: true, system: true },
  { id: 'Matéria-prima', labelEn: 'Raw materials', kind: 'expense', group: 'operational_cost', nature: 'cogs', accounting: 'inventory', supported: true, system: true },
  { id: 'Insumos', labelEn: 'Supplies', kind: 'expense', group: 'operational_cost', nature: 'cogs', accounting: 'inventory', supported: true, system: true },
  { id: 'Embalagens', labelEn: 'Packaging', kind: 'expense', group: 'operational_cost', nature: 'cogs', accounting: 'inventory', supported: true, system: true },
  { id: 'Fretes', labelEn: 'Freight', kind: 'expense', group: 'operational_cost', nature: 'expense', accounting: 'expense_freight', supported: true, system: true },
  { id: 'Manutenção', labelEn: 'Maintenance', kind: 'expense', group: 'operational_cost', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Serviços terceirizados', labelEn: 'Outsourced services', kind: 'expense', group: 'operational_cost', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  // --- Despesas administrativas ---
  { id: 'Aluguel', labelEn: 'Rent', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Energia elétrica', labelEn: 'Electricity', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Água e saneamento', labelEn: 'Water and sanitation', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Internet e telefonia', labelEn: 'Internet and phone', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Software e assinaturas', labelEn: 'Software and subscriptions', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Material de escritório', labelEn: 'Office supplies', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Marketing', labelEn: 'Marketing', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Marketing e publicidade', labelEn: 'Marketing and advertising', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Consultoria e assessoria', labelEn: 'Consulting and advisory', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Seguros', labelEn: 'Insurance', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Viagens e deslocamentos', labelEn: 'Travel and commuting', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Serviços e utilidades', labelEn: 'Services and utilities', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  // --- Despesas com pessoal ---
  { id: 'Folha de pagamento', labelEn: 'Payroll', kind: 'expense', group: 'personnel', nature: 'expense', accounting: 'expense_payroll', supported: true, system: true },
  { id: 'Benefícios', labelEn: 'Benefits', kind: 'expense', group: 'personnel', nature: 'expense', accounting: 'expense_payroll', supported: true, system: true },
  { id: 'Encargos trabalhistas', labelEn: 'Labor charges', kind: 'expense', group: 'personnel', nature: 'expense', accounting: 'expense_payroll', supported: true, system: true },
  { id: 'Treinamento', labelEn: 'Training', kind: 'expense', group: 'personnel', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Reembolsos a funcionários', labelEn: 'Employee reimbursements', kind: 'expense', group: 'personnel', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  // --- Despesas financeiras e fiscais ---
  { id: 'Impostos', labelEn: 'Taxes', kind: 'expense', group: 'financial_fiscal', nature: 'expense', accounting: 'expense_tax', supported: true, system: true },
  { id: 'Impostos e tributos', labelEn: 'Taxes and levies', kind: 'expense', group: 'financial_fiscal', nature: 'expense', accounting: 'expense_tax', supported: true, system: true },
  { id: 'Taxas bancárias', labelEn: 'Bank fees', kind: 'expense', group: 'financial_fiscal', nature: 'expense', accounting: 'expense_fees', supported: true, system: true },
  { id: 'Juros', labelEn: 'Interest', kind: 'expense', group: 'financial_fiscal', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Multas', labelEn: 'Fines', kind: 'expense', group: 'financial_fiscal', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Tarifas financeiras', labelEn: 'Financial fees', kind: 'expense', group: 'financial_fiscal', nature: 'expense', accounting: 'expense_fees', supported: true, system: true },
  { id: 'Taxas de transação', labelEn: 'Transaction fees', kind: 'expense', group: 'financial_fiscal', nature: 'expense', accounting: 'expense_fees', supported: true, system: true },
  // --- Investimentos e outras obrigações (não-despesa; suporte contábil pendente) ---
  { id: 'Equipamentos', labelEn: 'Equipment', kind: 'expense', group: 'investments_obligations', nature: 'asset', accounting: 'expense_operating', supported: false, system: true },
  { id: 'Máquinas', labelEn: 'Machinery', kind: 'expense', group: 'investments_obligations', nature: 'asset', accounting: 'expense_operating', supported: false, system: true },
  { id: 'Infraestrutura', labelEn: 'Infrastructure', kind: 'expense', group: 'investments_obligations', nature: 'asset', accounting: 'expense_operating', supported: false, system: true },
  { id: 'Empréstimos e financiamentos', labelEn: 'Loans and financing', kind: 'expense', group: 'investments_obligations', nature: 'liability', accounting: 'payable', supported: false, system: true },
  { id: 'Adiantamentos', labelEn: 'Advances', kind: 'expense', group: 'investments_obligations', nature: 'liability', accounting: 'payable', supported: false, system: true },
  { id: 'Outras obrigações', labelEn: 'Other obligations', kind: 'expense', group: 'investments_obligations', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  { id: 'Outras despesas', labelEn: 'Other expenses', kind: 'expense', group: 'administrative', nature: 'expense', accounting: 'expense_operating', supported: true, system: true },
  // Logística (categoria existente do sistema)
  { id: 'Logística', labelEn: 'Logistics', kind: 'expense', group: 'operational_cost', nature: 'expense', accounting: 'expense_freight', supported: true, system: true },
]

export const categoriesFor = (kind: 'income' | 'expense'): FinancialCategory[] => FINANCIAL_CATEGORIES.filter((c) => c.kind === kind && c.supported)

export const categoryById = (id: string): FinancialCategory | undefined => FINANCIAL_CATEGORIES.find((c) => c.id === id)

export const groupLabelOf = (group: FinancialGroup, lang: 'pt' | 'en'): string => GROUP_LABELS[group][lang]

export const supportedCategoryIds = (kind: 'income' | 'expense'): string[] => categoriesFor(kind).map((c) => c.id)
