import { t } from '@/lib/i18n'
import type { PostErrorCode } from '@/lib/accounting/types'
import type { ReconReason } from '@/lib/accounting/reconcile-center'
import type { EventType, SourceModule } from '@/lib/accounting/types'

/** Mensagens de erro do razão para a interface (PT/EN). */
export function ledgerError(code: PostErrorCode): string {
  const m: Partial<Record<PostErrorCode, string>> = {
    not_authorized: t('Somente um usuário pode fazer esta alteração.', 'Only a user can make this change.'),
    invalid_code: t('Código inválido (até 12 letras, números, ponto ou hífen).', 'Invalid code (up to 12 letters, digits, dot or hyphen).'),
    duplicate_code: t('Já existe uma conta com este código.', 'An account with this code already exists.'),
    invalid_name: t('Informe o nome da conta.', 'Enter the account name.'),
    invalid_parent: t('Conta-pai inválida (precisa ser da mesma classe e não pode formar ciclo).', 'Invalid parent account (must share the class and cannot form a cycle).'),
    invalid_subtype: t('O tipo escolhido não combina com a classe da conta.', 'The chosen type does not match the account class.'),
    immutable_field: t('Classe e tipo não podem mudar depois que a conta tem lançamentos ou filhas.', 'Class and type cannot change once the account has entries or children.'),
    account_in_use: t('A conta tem lançamentos ou contas filhas e não pode ser excluída.', 'The account has entries or child accounts and cannot be deleted.'),
    last_active_subtype: t('É a única conta ativa deste tipo; os lançamentos automáticos dependem dela.', 'This is the only active account of its type; automatic posting depends on it.'),
    not_found: t('Registro não encontrado.', 'Record not found.'),
    invalid_review: t('Informe uma nota (mín. 3 caracteres) ou o hash da transação. Links de evidência devem usar https.', 'Enter a note (min. 3 characters) or the transaction hash. Evidence links must use https.'),
    not_pending: t('Este item não está mais pendente.', 'This item is no longer pending.'),
    invalid_fx: t('Taxa inválida: informe moedas diferentes, taxa decimal positiva, fonte e data.', 'Invalid rate: use different currencies, a positive decimal rate, a source and a date.'),
    invalid_amount: t('Valor inválido.', 'Invalid amount.'),
    invalid_date: t('Data inválida.', 'Invalid date.'),
    invalid_rate: t('Taxa inválida.', 'Invalid rate.'),
    not_estimated: t('A taxa já foi confirmada.', 'The fee is already confirmed.'),
    invalid_source: t('Informe a origem da taxa.', 'Enter the fee source.'),
    invalid_currency: t('Moeda inválida.', 'Invalid currency.'),
  }
  return m[code] ?? t(`Operação recusada (${code}).`, `Operation rejected (${code}).`)
}

export const explainLedger = (codes: PostErrorCode[]): string => [...new Set(codes.map(ledgerError))].join(' ')

export function reasonText(reason: ReconReason): string {
  const m: Record<ReconReason, string> = {
    ok: t('Conferido com o razão.', 'Matches the ledger.'),
    legacy_unledgered: t('Registro anterior ao razão (moeda não registrada): sem lançamento contábil.', 'Record created before the ledger (currency not recorded): no journal entry.'),
    amount_mismatch: t('O valor difere do lançamento contábil.', 'The amount differs from the journal entry.'),
    duplicate_posting: t('Há mais de um lançamento ativo para este registro.', 'More than one active journal entry exists for this record.'),
    duplicate_candidate: t('Possível duplicidade: mesmo dia, tipo, valor, categoria e descrição.', 'Possible duplicate: same day, type, amount, category and description.'),
    removed_record: t('O registro do Livro-Caixa não existe mais, mas o lançamento segue ativo.', 'The Cash Book record no longer exists, but its journal entry is still active.'),
    sale_canceled_unreversed: t('Venda cancelada sem estorno contábil (revisar manualmente).', 'Sale canceled without an accounting reversal (review manually).'),
    sale_missing: t('Venda sem lançamento contábil.', 'Sale without a journal entry.'),
    purchase_missing: t('Compra sem lançamento contábil.', 'Purchase without a journal entry.'),
    obligation_missing: t('Conta sem lançamento da obrigação (criada antes da integração).', 'Account without an obligation entry (created before the integration).'),
    settlement_missing: t('Conta liquidada sem lançamento da baixa.', 'Settled account without a settlement entry.'),
    pending_confirmation: t('Aguardando confirmação humana com evidência: não é liquidação confirmada.', 'Awaiting human confirmation with evidence: not a confirmed settlement.'),
    no_evidence: t('Sem hash de transação: não há evidência para lançar.', 'No transaction hash: there is no evidence to post.'),
    needs_classification: t('Envio sem conta vinculada: é preciso classificar (pagamento, transferência própria).', 'Send without a linked account: classify it (payment or own transfer).'),
    fee_estimated: t('Taxa estimada: ainda não confirmada.', 'Estimated fee: not confirmed yet.'),
    unbalanced: t('Lançamento desbalanceado (débitos ≠ créditos).', 'Unbalanced entry (debits ≠ credits).'),
    event_rejected: t('Evento rejeitado ou falho.', 'Rejected or failed event.'),
  }
  return m[reason]
}

export const SOURCE_LABELS: Record<SourceModule | 'unknown', () => string> = {
  cashbook: () => t('Livro-Caixa', 'Cash Book'),
  sales: () => t('Vendas', 'Sales'),
  purchases: () => t('Compras', 'Purchases'),
  payables: () => t('Contas a pagar', 'Payables'),
  receivables: () => t('Contas a receber', 'Receivables'),
  payroll: () => t('Folha', 'Payroll'),
  logistics: () => t('Logística', 'Logistics'),
  treasury: () => t('Tesouraria', 'Treasury'),
  fees: () => t('Taxas', 'Fees'),
  adjustment: () => t('Ajuste/estorno', 'Adjustment/reversal'),
  unknown: () => '—',
}

export const TYPE_LABELS: Record<EventType, () => string> = {
  'cashbook.income': () => t('Entrada manual', 'Manual inflow'),
  'cashbook.expense': () => t('Saída manual', 'Manual outflow'),
  'sale.recorded': () => t('Venda', 'Sale'),
  'receivable.settled': () => t('Recebimento', 'Receipt'),
  'purchase.recorded': () => t('Compra', 'Purchase'),
  'payable.settled': () => t('Pagamento', 'Payment'),
  'payroll.accrued': () => t('Folha apropriada', 'Payroll accrued'),
  'payroll.paid': () => t('Salário pago', 'Salary paid'),
  'freight.posted': () => t('Frete', 'Freight'),
  'treasury.deposit': () => t('Depósito (tesouraria)', 'Deposit (treasury)'),
  'treasury.transfer_internal': () => t('Transferência interna', 'Internal transfer'),
  'treasury.payment': () => t('Pagamento (tesouraria)', 'Payment (treasury)'),
  'fee.confirmed': () => t('Taxa', 'Fee'),
  'payable.created': () => t('Conta a pagar criada', 'Payable created'),
  'receivable.created': () => t('Conta a receber criada', 'Receivable created'),
  adjustment: () => t('Ajuste', 'Adjustment'),
}

export const CLASS_LABELS = {
  asset: () => t('Ativo', 'Asset'),
  liability: () => t('Passivo', 'Liability'),
  equity: () => t('Patrimônio', 'Equity'),
  revenue: () => t('Receita', 'Revenue'),
  expense: () => t('Despesa', 'Expense'),
} as const

export const SUBTYPE_LABELS: Record<string, () => string> = {
  group: () => t('Grupo (não recebe lançamentos)', 'Group (no postings)'),
  cash: () => t('Caixa', 'Cash'),
  usdc_wallet: () => t('USDC em carteira', 'USDC in wallet'),
  usdc_gateway: () => t('USDC no Gateway', 'USDC in Gateway'),
  receivable: () => t('Contas a receber', 'Receivables'),
  inventory: () => t('Estoque', 'Inventory'),
  payable: () => t('Contas a pagar', 'Payables'),
  payroll_payable: () => t('Folha a pagar', 'Payroll payable'),
  tax_payable: () => t('Impostos a recolher', 'Taxes payable'),
  equity: () => t('Patrimônio líquido', 'Owner equity'),
  opening: () => t('Saldos iniciais/conciliação', 'Opening/reconciliation'),
  revenue_sales: () => t('Receita de vendas', 'Sales revenue'),
  revenue_other: () => t('Outras receitas', 'Other revenue'),
  cogs: () => t('Custo das mercadorias', 'Cost of goods sold'),
  expense_operating: () => t('Despesa operacional', 'Operating expense'),
  expense_payroll: () => t('Despesa de folha', 'Payroll expense'),
  expense_freight: () => t('Frete e logística', 'Freight and logistics'),
  expense_fees: () => t('Taxas de gateway/processamento', 'Gateway/processing fees'),
  expense_network: () => t('Taxas de rede (gas)', 'Network (gas) fees'),
  expense_tax: () => t('Impostos e tributos', 'Taxes and levies'),
}
