import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  CAT_PAYROLL,
  CAT_PURCHASE,
  CAT_SALES,
  type Account,
  type AccountEnvironment,
  type AppData,
  type Contact,
  type Employee,
  type Entry,
  type Environment,
  type PayMethod,
  type PaymentRequest,
  type PaymentIntent,
  type PaymentIntentState,
  type PaymentAttempt,
  type PaymentReservation,
  type Product,
  type Sale,
  type SaleItem,
  type Settings,
  type ShipmentDocumentType,
  type ShipmentStatus,
  type TreasuryOp,
  type CurrencyCode,
} from './types'
import { addDays, round2, setCurrency, today } from './format'
import { weightedAverageFromValue } from './costing'
import { validateProduct, IMMUTABLE_PRODUCT_FIELDS, type ProductErrorCode } from './product'
import { accountOutstanding, accountPaidAmount } from './selectors'
import * as logistics from './logistics'
import * as fulfillment from './fulfillment'
import * as receiving from './receiving'
import * as carriers from './carriers'
import * as freight from './freight'
import * as international from './international'
import * as returns from './returns'
import { buildDemoData } from './demo'
import { emptyLedger, normalizeLedger, setAdapterFlag, closePeriod, reopenPeriod, setPeriodReview, isDateClosed, withAudit, type AdapterFlagName, type Ctx, type OpResult } from './accounting/engine'
import { autoPost } from './accounting/autopost'
import * as chartOps from './accounting/chart-ops'
import * as reviewOps from './accounting/reviews'
import { confirmFee, registerFee, type FeeInput } from './accounting/engine'
import { planPurchaseReconciliation, applyPurchaseReconciliation } from './accounting/purchase-reconcile'
import { reconcileTreasuryOp, allocationMinor, planAllocationMinor } from './settlement-service'
import { fromNumber, toDisplayNumber, EXPONENT, parseRate } from './accounting/money'
import { canCancel, canClassifyEnvironment, inFlightIntentEnv } from './treasury-selectors'
import { addContactTransition, addEmployeeTransition, updateContactTransition, updateEmployeeTransition, type SaveCode } from './save-transitions'
import { gatewayChainEnv, getNetwork, type NetworkId } from './network'
import { categoryById, isUnsupportedCategory } from './financial-categories'
import { gatewayConfigFor, treasuryRecipientFor, validateBeneficiary, resolveInstitutionalGatewayContext, settingsIdentityRepository } from './gateway-config'
import {
  authorizeIntentTransition,
  parseMinorUnits,
  parseExactDecimal,
  convertToUsdcMinor,
  scopedIdempotencyKey,
  intentFingerprint,
  normalizeTxHash,
  matchesIntentScope,
  availableForReservation,
  attemptBlocksRetry,
  canReleaseReservation,
  TERMINAL_INTENT_STATES,
  type IntentTransitionContext,
} from './payment-intent'
import type { AccountingStatus, TreasuryOpStatus } from './accounting/settlement'
import type { LedgerState, PostErrorCode } from './accounting/types'
import { syncAdded, syncRemoved, syncUpdated, type SyncCtx } from './accounting/cashbook-sync'
import { requiresGatewayVerification } from './gateway-charge'
import { t } from './i18n'

const STORAGE_KEY = 'gbos:v1'

/** Single-flight de verificação de liquidação (por id de operação), para evitar baixas concorrentes. */
const inflight = new Set<string>()

export const uid = (): string => crypto.randomUUID().slice(0, 12)

export const emptySettings = (): Settings => ({
  company: t('Minha Empresa', 'My Company'),
  branch: t('Matriz', 'Headquarters'),
  owner: t('Empreendedor', 'Entrepreneur'),
  // Instalações novas começam em USDC. Quem já escolheu outra moeda mantém a sua (o que está salvo prevalece).
  currency: 'USDC',
  usdcRate: null,
  approvalLimit: null,
})

/** Ator e contexto de lançamento no razão: o proprietário cadastrado nas Configurações (usuário humano). */
function ledgerCtx(d: AppData): SyncCtx {
  return { now: new Date().toISOString(), actor: { id: d.settings.owner.trim() || 'local-user', kind: 'user' }, currency: d.settings.currency }
}

/** Executa a sincronização com o razão sem nunca propagar exceção: o Livro-Caixa tem prioridade. */
export function guardLedger(d: AppData, run: (ctx: SyncCtx) => AppData['ledger']): AppData['ledger'] {
  try {
    return run(ledgerCtx(d))
  } catch {
    return d.ledger
  }
}

export function emptyData(): AppData {
  return {
    products: [],
    moves: [],
    contacts: [],
    entries: [],
    accounts: [],
    sales: [],
    employees: [],
    treasuryOps: [],
    requests: [],
    shipments: [],
  carriers: [],
  returns: [],
  purchases: [],
  receipts: [],
  paymentIntents: [],
  paymentAttempts: [],
  paymentReservations: [],
    ledger: emptyLedger(),
    settings: emptySettings(),
  }
}

/**
 * Migração auditável: para contas legadas sem `currency`, infere a moeda a partir do evento de obrigação
 * correspondente no razão (`payable.created`/`receivable.created`), que registrou a moeda na criação.
 * Sem evento, permanece desconhecida (nunca adivinhada); exige resolução do dono na alocação.
 */
function migrateAccountCurrencies(data: AppData): AppData {
  const obligationCurrency = new Map<string, CurrencyCode>()
  for (const e of data.ledger.events) {
    if ((e.type === 'payable.created' || e.type === 'receivable.created') && typeof e.payload.accountId === 'string') {
      obligationCurrency.set(e.payload.accountId, e.currency)
    }
  }
  let changed = false
  const accounts = data.accounts.map((a) => {
    if (a.currency) return a
    const cur = obligationCurrency.get(a.id)
    if (!cur) return a
    changed = true
    return { ...a, currency: cur }
  })
  return changed ? { ...data, accounts } : data
}

/**
 * Migração versionada/idempotente do ambiente financeiro de origem (fase 3.2.4).
 * - Usa `paymentNetwork` (se já preparado) ou a rede de uma operação vinculada; senão `unassigned`.
 * - Nunca atribui Mainnet/Testnet pela rede atualmente selecionada; nunca duplica obrigações.
 * Exportada para testes de migração (pura e idempotente).
 */
export function migrateAccountEnvironments(data: AppData): AppData {
  const opEnv = new Map<string, NetworkId>()
  for (const o of data.treasuryOps) {
    if (!o.accountId) continue
    const env = gatewayChainEnv(o.chain)
    if (env) opEnv.set(o.accountId, env === 'live' ? 'mainnet' : 'testnet')
  }
  let changed = false
  const accounts = data.accounts.map((a) => {
    if (a.environment) return a
    const env: AccountEnvironment = a.paymentNetwork ?? opEnv.get(a.id) ?? 'unassigned'
    changed = true
    return { ...a, environment: env }
  })
  return changed ? { ...data, accounts } : data
}

/**
 * Migração versionada/idempotente do ambiente OPERACIONAL (fase 3.3): produtos, movimentações, vendas,
 * compras, contatos, funcionários, remessas, transportadoras, devoluções e recebimentos.
 * - Vendas herdam o ambiente da obrigação (conta a receber) quando esta foi classificada; senão `unassigned`.
 * - Demais entidades sem evidência confiável ficam `unassigned` (nunca pela rede selecionada).
 * Exportada para testes (pura e idempotente).
 */
export function migrateErpEnvironments(data: AppData): AppData {
  const accountEnv = new Map<string, Environment | undefined>(data.accounts.map((a) => [a.id, a.environment]))
  let changed = false
  const withEnv = <T extends { environment?: Environment }>(rec: T, env: Environment): T => {
    changed = true
    return { ...rec, environment: env }
  }
  const sales = data.sales.map((s) => (s.environment ? s : withEnv(s, (s.accountId ? accountEnv.get(s.accountId) : undefined) ?? 'unassigned')))
  const products = data.products.map((p) => (p.environment ? p : withEnv(p, 'unassigned')))
  const moves = data.moves.map((m) => (m.environment ? m : withEnv(m, 'unassigned')))
  const contacts = data.contacts.map((c) => (c.environment ? c : withEnv(c, 'unassigned')))
  const employees = data.employees.map((e) => (e.environment ? e : withEnv(e, 'unassigned')))
  const purchases = data.purchases.map((p) => (p.environment ? p : withEnv(p, 'unassigned')))
  const shipments = data.shipments.map((s) => (s.environment ? s : withEnv(s, 'unassigned')))
  const carriers = data.carriers.map((c) => (c.environment ? c : withEnv(c, 'unassigned')))
  const returns = data.returns.map((r) => (r.environment ? r : withEnv(r, 'unassigned')))
  const receipts = data.receipts.map((r) => (r.environment ? r : withEnv(r, 'unassigned')))
  const entries = data.entries.map((e) => (e.environment ? e : withEnv(e, 'unassigned')))
  return changed ? { ...data, sales, products, moves, contacts, employees, purchases, shipments, carriers, returns, receipts, entries } : data
}

/**
 * Recuperação do ambiente de lançamentos legados (fase FIN-01.1): usa o vínculo inequívoco
 * `sourceKind`/`sourceId` para herdar o ambiente da operação de origem (venda/conta/compra).
 * Sem vínculo confiável ou com origem sem ambiente definido, permanece sem ambiente (será marcado
 * `unassigned` na migração ERP seguinte). Idempotente e não destrutiva.
 */
export function migrateEntryEnvironments(data: AppData): AppData {
  const saleEnv = new Map(data.sales.map((s) => [s.id, s.environment]))
  const accountEnv = new Map(data.accounts.map((a) => [a.id, a.environment]))
  const purchaseEnv = new Map(data.purchases.map((p) => [p.id, p.environment]))
  let changed = false
  const entries = data.entries.map((e) => {
    // Preserva registros corretamente classificados (Mainnet/Testnet); reavalia `unassigned` e ausentes.
    if (e.environment && e.environment !== 'unassigned') return e
    const id = e.sourceId ?? ''
    const env = e.sourceKind === 'sale' ? saleEnv.get(id) : e.sourceKind === 'account' ? accountEnv.get(id) : e.sourceKind === 'purchase' ? purchaseEnv.get(id) : undefined
    if (!env || env === 'unassigned') return e
    changed = true
    return { ...e, environment: env }
  })
  return changed ? { ...data, entries } : data
}

/**
 * Migração do ambiente contábil (fase FIN-02): classifica eventos e partidas legados (sem `environment`)
 * a partir de evidências inequívocas — `accountId`/`saleId`/`purchaseId`/`cashEntryId` no payload e
 * `chain` comprovada (`Arc` → Mainnet, `Arc_Testnet` → Testnet). Nunca infere por valor/descrição/data.
 * Idempotente e não destrutiva: eventos ambíguos permanecem sem ambiente (revisão).
 */
export function migrateLedgerEnvironments(data: AppData): AppData {
  const accountEnv = new Map(data.accounts.map((a) => [a.id, a.environment]))
  const saleEnv = new Map(data.sales.map((s) => [s.id, s.environment]))
  const purchaseEnv = new Map(data.purchases.map((p) => [p.id, p.environment]))
  const entryEnv = new Map(data.entries.map((e) => [e.id, e.environment]))

  const infer = (payload: Record<string, unknown> | undefined): Environment | undefined => {
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
    const pick = (env: Environment | undefined): Environment | undefined => (env && env !== 'unassigned' ? env : undefined)
    const byAccount = pick(accountEnv.get(str(payload?.accountId) ?? ''))
    if (byAccount) return byAccount
    const bySale = pick(saleEnv.get(str(payload?.saleId) ?? ''))
    if (bySale) return bySale
    const byPurchase = pick(purchaseEnv.get(str(payload?.purchaseId) ?? ''))
    if (byPurchase) return byPurchase
    const byCash = pick(entryEnv.get(str(payload?.cashEntryId) ?? ''))
    if (byCash) return byCash
    const chain = str(payload?.chain)
    if (chain === 'Arc') return 'mainnet'
    if (chain === 'Arc_Testnet') return 'testnet'
    return undefined
  }

  let changed = false
  const events = data.ledger.events.map((e) => {
    if (e.environment) return e
    const env = infer(e.payload)
    if (!env) return e
    changed = true
    return { ...e, environment: env }
  })
  const journal = data.ledger.journal.map((j) => {
    if (j.environment) return j
    const env = events.find((e) => e.id === j.eventId)?.environment
    if (!env) return j
    changed = true
    return { ...j, environment: env }
  })
  return changed ? { ...data, ledger: { ...data.ledger, events, journal } } : data
}

/** Saldo em aberto de uma conta em unidades menores (bigint); null se a moeda for desconhecida. */
function accountOutstandingMinor(acc: Account): bigint | null {
  const currency = acc.currency
  if (!currency) return null
  const amountMinor = fromNumber(acc.amount, currency)
  if (amountMinor === null) return null
  let paidMinor = 0n
  for (const s of acc.settlements ?? []) {
    const m = fromNumber(s.amount, currency)
    if (m !== null) paidMinor += m
  }
  return amountMinor - paidMinor
}

function cancelReasonText(reason: string): string {
  switch (reason) {
    case 'not_manual':
      return t('Esta obrigação vem de outro módulo e não pode ser cancelada aqui.', 'This obligation comes from another module and cannot be canceled here.')
    case 'settled':
      return t('Obrigação já liquidada: use estorno formal em vez de cancelar.', 'Obligation already settled: use a formal reversal instead of canceling.')
    case 'active_intent':
      return t('Há um pagamento em processamento para esta obrigação.', 'There is a payment in progress for this obligation.')
    default:
      return t('Não foi possível cancelar a obrigação.', 'Could not cancel the obligation.')
  }
}

function classifyReasonText(reason: string): string {
  switch (reason) {
    case 'already_classified':
      return t('Esta obrigação já tem ambiente definido e não pode ser reclassificada aqui.', 'This obligation already has an environment and cannot be reclassified here.')
    case 'settled':
      return t('Obrigação já liquidada não pode ser reclassificada.', 'A settled obligation cannot be reclassified.')
    case 'active_intent':
      return t('Há um pagamento em processamento para esta obrigação.', 'There is a payment in progress for this obligation.')
    case 'conflicting_evidence':
      return t('Há evidência on-chain de outro ambiente para esta obrigação.', 'There is on-chain evidence of another environment for this obligation.')
    default:
      return t('Não foi possível classificar a obrigação.', 'Could not classify the obligation.')
  }
}

/** Mapeia o código de rejeição de gravação para uma mensagem localizada (contatos). */
function contactSaveMessage(code: SaveCode): string {
  switch (code) {
    case 'invalid_document':
      return t('Documento inválido: revise o CPF/CNPJ.', 'Invalid document: review the CPF/CNPJ.')
    case 'duplicate':
      return t('Já existe um cadastro com este documento/código neste ambiente.', 'A record with this document/code already exists in this environment.')
    case 'not_found':
      return t('Cadastro não encontrado.', 'Record not found.')
    default:
      return t('Este cadastro pertence a outro ambiente.', 'This record belongs to another environment.')
  }
}

/** Mapeia o código de rejeição de gravação para uma mensagem localizada (funcionários). */
function employeeSaveMessage(code: SaveCode): string {
  switch (code) {
    case 'invalid_document':
      return t('Documento inválido: revise o CPF/CNPJ.', 'Invalid document: review the CPF/CNPJ.')
    case 'duplicate':
      return t('Já existe um funcionário com esta matrícula neste ambiente.', 'An employee with this ID already exists in this environment.')
    case 'not_found':
      return t('Funcionário não encontrado.', 'Employee not found.')
    default:
      return t('Este funcionário pertence a outro ambiente.', 'This employee belongs to another environment.')
  }
}

/** Mapeia o código de erro de produto para uma mensagem localizada. */
function productErrorMessage(code: ProductErrorCode): string {
  switch (code) {
    case 'name_required':
      return t('Informe o nome do produto.', 'Enter the product name.')
    case 'cost_invalid':
      return t('Custo médio inválido: informe um valor finito e não negativo.', 'Invalid average cost: enter a finite, non-negative value.')
    case 'price_invalid':
      return t('Preço de venda inválido.', 'Invalid sale price.')
    case 'stock_invalid':
      return t('Quantidade em estoque inválida.', 'Invalid stock quantity.')
    case 'minstock_invalid':
      return t('Estoque mínimo inválido.', 'Invalid minimum stock.')
    case 'maxstock_invalid':
      return t('Estoque máximo inválido.', 'Invalid maximum stock.')
    case 'reorder_invalid':
      return t('Ponto de reposição inválido.', 'Invalid reorder point.')
    case 'wholesale_invalid':
      return t('Preço de atacado inválido.', 'Invalid wholesale price.')
    case 'reference_cost_invalid':
      return t('Custo de referência inválido.', 'Invalid reference cost.')
    case 'purchase_price_invalid':
      return t('Preço de aquisição inválido.', 'Invalid purchase price.')
    case 'non_finite':
      return t('Valor inválido: use um número finito e não negativo.', 'Invalid value: use a finite, non-negative number.')
    case 'barcode_invalid':
      return t('Código de barras inválido: use GTIN/EAN/UPC com 8, 12, 13 ou 14 dígitos.', 'Invalid barcode: use a GTIN/EAN/UPC with 8, 12, 13 or 14 digits.')
    case 'barcode_check':
      return t('Código de barras com dígito verificador inválido.', 'Barcode with an invalid check digit.')
    case 'sku_duplicate':
      return t('Já existe um produto com este SKU neste ambiente.', 'A product with this SKU already exists in this environment.')
    default:
      return t('Produto inválido.', 'Invalid product.')
  }
}

/** Busca um registro operacional (com campo `environment`) por tipo e id. */
function entityRecord(d: AppData, kind: EntityKind, id: string): { environment?: Environment } | undefined {
  switch (kind) {
    case 'product':
      return d.products.find((x) => x.id === id)
    case 'sale':
      return d.sales.find((x) => x.id === id)
    case 'purchase':
      return d.purchases.find((x) => x.id === id)
    case 'contact':
      return d.contacts.find((x) => x.id === id)
    case 'employee':
      return d.employees.find((x) => x.id === id)
    case 'shipment':
      return d.shipments.find((x) => x.id === id)
    case 'carrier':
      return d.carriers.find((x) => x.id === id)
    case 'return':
      return d.returns.find((x) => x.id === id)
    case 'receipt':
      return d.receipts.find((x) => x.id === id)
  }
}

/** Aplica o ambiente a um registro operacional (retorna um novo AppData). */
function setEntityRecord(d: AppData, kind: EntityKind, id: string, environment: NetworkId): AppData {
  switch (kind) {
    case 'product':
      return { ...d, products: d.products.map((x) => (x.id === id ? { ...x, environment } : x)) }
    case 'sale':
      return { ...d, sales: d.sales.map((x) => (x.id === id ? { ...x, environment } : x)) }
    case 'purchase':
      return { ...d, purchases: d.purchases.map((x) => (x.id === id ? { ...x, environment } : x)) }
    case 'contact':
      return { ...d, contacts: d.contacts.map((x) => (x.id === id ? { ...x, environment } : x)) }
    case 'employee':
      return { ...d, employees: d.employees.map((x) => (x.id === id ? { ...x, environment } : x)) }
    case 'shipment':
      return { ...d, shipments: d.shipments.map((x) => (x.id === id ? { ...x, environment } : x)) }
    case 'carrier':
      return { ...d, carriers: d.carriers.map((x) => (x.id === id ? { ...x, environment } : x)) }
    case 'return':
      return { ...d, returns: d.returns.map((x) => (x.id === id ? { ...x, environment } : x)) }
    case 'receipt':
      return { ...d, receipts: d.receipts.map((x) => (x.id === id ? { ...x, environment } : x)) }
  }
}

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyData()
    const parsed = JSON.parse(raw) as Partial<AppData>
    const base = emptyData()
    const data: AppData = { ...base, ...parsed, ledger: normalizeLedger(parsed.ledger), settings: { ...base.settings, ...(parsed.settings ?? {}) } }
    return migrateLedgerEnvironments(migrateErpEnvironments(migrateEntryEnvironments(migrateAccountEnvironments(migrateAccountCurrencies(data)))))
  } catch {
    return emptyData()
  }
}

export type LedgerResult<T> = { ok: true; value: T } | { ok: false; errors: PostErrorCode[] }

export type VerifyOutcome = { ok: true; status: TreasuryOpStatus } | { ok: false; error: 'not_found' }

export type AccountingOutcome = { ok: true; status: AccountingStatus } | { ok: false; error: 'not_found' | 'not_confirmed' }

export type CancelResult = { ok: true } | { ok: false; reason: string }
export type BatchCancelResult = { canceled: string[]; refused: { id: string; reason: string }[] }
export type ClassifyResult = { ok: true } | { ok: false; reason: string }
/** Resultado explícito de operações sobre lançamentos (criação/edição/exclusão). */
export type EntryResult = { ok: true } | { ok: false; reason: string }
/** Resultado de operações do Sandbox (carregar demonstração / limpar Testnet). */
export type SandboxResult = { ok: true } | { ok: false; reason: 'wrong_environment' }

/** Resultado explícito de gravação de cadastro (fase UI 2.1.1). */
export type SaveResult = { ok: true; id: string } | { ok: false; code: 'invalid_document' | 'duplicate' | 'not_found' | 'wrong_environment'; message: string }

export type EntityKind = 'product' | 'sale' | 'purchase' | 'contact' | 'employee' | 'shipment' | 'carrier' | 'return' | 'receipt'

export interface SaleInput {
  customerId?: string
  method: PayMethod
  dueDate?: string
  items: { productId: string; qty: number; price: number }[]
  /** Intenção estável da operação (idempotência). Reenvios com a mesma chave não duplicam. */
  intentId?: string
}

/** Resultado explícito do registro de venda. `accountId` presente quando a venda gera uma obrigação a receber. */
export type SaleResult = { ok: true; saleId: string; accountId?: string } | { ok: false }

export interface PaymentIntentInput {
  saleId?: string
  accountId: string
  customerId?: string
  /** Valor na moeda do negócio (legado, apenas apresentação). Nunca fonte de cálculo on-chain. */
  amount: number
  /** Decimal textual autoritativo na moeda do negócio (ex.: "15.00"). Fonte exata, sem float. */
  amountDecimal?: string
  /** Unidades mínimas USDC (6 casas) para a transação on-chain. */
  usdcMinor: string
  currency: CurrencyCode
  /** Cotação: unidades da moeda original por 1 USDC (decimal textual). */
  rate?: string
  expiresAt: string
  /** Chave de idempotência (opcional, recomendada): mesma chave retorna a intenção existente. */
  idempotencyKey?: string
  /** Referência pública opaca do checkout (ou seu hash). */
  checkoutToken?: string
}

export type IntentResult =
  | { ok: true; intentId: string }
  | { ok: false; reason: 'not_found' | 'invalid_amount' | 'not_configured' | 'invalid_expiration' | 'conflict' }

/** Entrada da cobrança Gateway (Gate D): cria obrigação avulsa + intenção + reserva atomicamente. */
export interface GatewayChargeInput {
  accountId?: string
  description?: string
  amount: number
  amountDecimal: string
  usdcMinor: string
  currency: CurrencyCode
  rate?: string
  expiresAt: string
  idempotencyKey?: string
  checkoutToken?: string
}

export type GatewayChargeResult =
  | { ok: true; intentId: string; configPending: boolean }
  | { ok: false; reason: 'not_found' | 'invalid_amount' | 'not_configured' | 'invalid_expiration' | 'conflict' }

export interface PurchaseInput {
  supplierId?: string
  paidNow: boolean
  dueDate: string
  items: { productId: string; qty: number; cost: number }[]
  /** Registra a compra sem somar o estoque: ele só entra no recebimento de mercadorias (aba Logística). */
  awaitReceipt?: boolean
  /** Intenção estável da operação (idempotência). Reenvios com a mesma chave não duplicam. */
  intentId?: string
}

/** Resultado de uma operação de logística para a interface (sem o estado interno). */
export type LogisticsResult<T> = { ok: true; value: T } | { ok: false; errors: logistics.ErrorCode[] }

export interface Store {
  data: AppData
  addProduct: (p: Omit<Product, 'id'>) => string
  updateProduct: (id: string, patch: Partial<Product>) => boolean
  removeProduct: (id: string) => void
  moveStock: (productId: string, kind: 'in' | 'out' | 'adjust', qty: number, note: string) => void
  addContact: (c: Omit<Contact, 'id'>) => SaveResult
  updateContact: (id: string, patch: Partial<Contact>) => SaveResult
  removeContact: (id: string) => void
  addEntry: (e: Omit<Entry, 'id'>) => EntryResult
  /** Classifica manualmente um lançamento sem ambiente (`unassigned`), com auditoria. */
  setEntryEnvironment: (id: string, environment: NetworkId) => ClassifyResult
  /** Liga/desliga um adaptador do razão contábil. Cada um só trata registros criados DEPOIS de ligado. */
  setLedgerAdapter: (name: AdapterFlagName, on: boolean) => void
  createLedgerAccount: (input: chartOps.AccountInput) => LedgerResult<{ code: string }>
  updateLedgerAccount: (code: string, patch: chartOps.AccountPatch) => LedgerResult<{ code: string }>
  setLedgerAccountActive: (code: string, active: boolean) => LedgerResult<{ code: string }>
  deleteLedgerAccount: (code: string) => LedgerResult<{ code: string }>
  /** Decisão humana na conciliação (confirmar/falhar uma liquidação pendente com evidência, ou dispensar um item). */
  reviewLedgerItem: (input: reviewOps.ReviewInput) => LedgerResult<{ reviewId: string; entryId: string | null }>
  recordLedgerFxRate: (input: reviewOps.FxInput) => LedgerResult<{ id: string }>
  registerLedgerFee: (input: FeeInput) => LedgerResult<{ feeId: string; duplicate: boolean; entryId: string | null }>
  confirmLedgerFee: (dedupeKey: string, patch: { amountMinor?: string; relatedRef?: string; accountingDate: string }) => LedgerResult<{ entryId: string | null }>
  /** Fechamento de período contábil (bloqueia lançamentos no mês, com auditoria). */
  closeAccountingPeriod: (key: string) => LedgerResult<{ key: string }>
  reopenAccountingPeriod: (key: string, reason: string) => LedgerResult<{ key: string }>
  setAccountingPeriodReview: (key: string) => LedgerResult<{ key: string }>
  /** Reconciliação histórica de compras: aplica os lançamentos propostos (dry-run), com aprovação humana. */
  reconcilePurchases: (ids: string[]) => LedgerResult<{ posted: number; duplicates: number; rejected: number }>
  updateEntry: (id: string, patch: Partial<Entry>) => EntryResult
  removeEntry: (id: string) => EntryResult
  addAccount: (a: Omit<Account, 'id' | 'status' | 'source'> & { source?: Account['source'] }) => string
  updateAccount: (id: string, patch: Partial<Account>) => boolean
  /** Reclassifica manualmente o ambiente de uma obrigação legada (`unassigned`), com auditoria. */
  setAccountEnvironment: (id: string, environment: NetworkId) => ClassifyResult
  /** Reclassifica manualmente o ambiente de um registro operacional legado (`unassigned`), com auditoria. */
  setRecordEnvironment: (kind: EntityKind, id: string, environment: NetworkId) => ClassifyResult
  settleAccount: (id: string, treasuryTx?: string) => void
  /** Liquidação parcial: reduz o saldo em aberto sem fechar a conta. Recusa valor acima do saldo. */
  settleAccountPartial: (id: string, amount: number, treasuryTx?: string) => void
  removeAccount: (id: string) => void
  /** Associa EXPLICITAMENTE uma obrigação a um ambiente de pagamento (preparação). */
  preparePayment: (id: string, network: NetworkId) => void
  /** Cancela logicamente (auditável) uma obrigação manual sem pagamentos/vínculos. Retorna resultado. */
  cancelAccount: (id: string) => CancelResult
  /** Cancelamento em lote com resultado por item. */
  cancelAccounts: (ids: string[]) => BatchCancelResult
  recordSale: (input: SaleInput) => SaleResult
  cancelSale: (id: string) => void
  recordPurchase: (input: PurchaseInput) => boolean
  addEmployee: (e: Omit<Employee, 'id'>) => SaveResult
  updateEmployee: (id: string, patch: Partial<Employee>) => SaveResult
  removeEmployee: (id: string) => void
  runPayroll: (month: string, dueDate: string) => number
  addRequest: (r: Omit<PaymentRequest, 'id' | 'status' | 'createdAt'>) => string
  updateRequest: (id: string, patch: Partial<PaymentRequest>) => void
  receiveRequest: (id: string, txHash: string, payer: string, explorerUrl: string) => void
  addTreasuryOp: (op: Omit<TreasuryOp, 'id' | 'date'>) => void
  /** Verifica a liquidação de uma operação de tesouraria e, se confirmada, baixa a conta uma única vez. */
  verifyAndSettle: (opId: string) => Promise<VerifyOutcome>
  /** Reconcilia APENAS a contabilidade de uma operação já confirmada on-chain (sem re-verificar nem reenviar). */
  reconcileAccounting: (opId: string) => AccountingOutcome
  createShipment: (input: logistics.ShipmentInput) => LogisticsResult<{ id: string }>
  updateShipment: (id: string, input: logistics.ShipmentInput) => LogisticsResult<{ changed: string[] }>
  transitionShipment: (id: string, to: ShipmentStatus, opts?: logistics.TransitionOptions) => LogisticsResult<{ status: ShipmentStatus }>
  addShipmentEvent: (id: string, input: logistics.TrackingInput) => LogisticsResult<{ eventId: string }>
  addShipmentDocument: (id: string, input: { type: ShipmentDocumentType; reference: string }) => LogisticsResult<{ documentId: string }>
  removeShipmentDraft: (id: string) => LogisticsResult<{ id: string }>
  pickShipmentItem: (id: string, itemId: string, qty: number) => LogisticsResult<{ picked: number }>
  packShipment: (id: string) => LogisticsResult<{ mode: 'sale_deducted' | 'on_hand' }>
  recordShipmentPod: (id: string, input: fulfillment.PodInput) => LogisticsResult<{ id: string }>
  closeShipmentFulfillment: (id: string) => LogisticsResult<{ id: string }>
  receiveShipmentGoods: (id: string, input: receiving.ReceiptInput) => LogisticsResult<receiving.ReceiptResult>
  createCarrier: (input: carriers.CarrierInput) => LogisticsResult<{ id: string }>
  updateCarrier: (id: string, input: carriers.CarrierInput) => LogisticsResult<{ id: string }>
  setCarrierActive: (id: string, active: boolean) => LogisticsResult<{ id: string }>
  removeCarrier: (id: string) => LogisticsResult<{ id: string }>
  setShipmentFreight: (id: string, input: freight.FreightInput) => LogisticsResult<{ total: number }>
  postShipmentFreight: (id: string, dueDate: string) => LogisticsResult<{ accountId: string; amount: number }>
  setShipmentInternational: (id: string, input: international.InternationalInput) => LogisticsResult<{ id: string }>
  requestReturn: (input: returns.ReturnRequestInput) => LogisticsResult<{ id: string }>
  authorizeReturn: (id: string, note?: string) => LogisticsResult<{ id: string }>
  rejectReturn: (id: string, note: string) => LogisticsResult<{ id: string }>
  cancelReturn: (id: string, note?: string) => LogisticsResult<{ id: string }>
  createReturnShipment: (id: string) => LogisticsResult<{ shipmentId: string }>
  inspectReturn: (id: string, input: returns.InspectionInput) => LogisticsResult<{ restocked: { productId: string; qty: number }[] }>
  resolveReturn: (id: string, input: returns.ResolutionInput) => LogisticsResult<{ id: string }>
  updateSettings: (patch: Partial<Settings>) => void
  importData: (next: AppData) => void
  resetAll: () => void
  /** Limpa apenas os dados da Testnet (Sandbox), preservando Mainnet, unassigned, configurações e o Ledger. */
  clearSandboxData: () => void
  /** Adiciona dados demonstrativos SOMENTE à Testnet, preservando Mainnet, unassigned, configurações e o Ledger. */
  loadSandboxDemo: () => SandboxResult
  /** Cria uma intenção de pagamento USDC (checkout nativo), vinculada a uma obrigação e, opcionalmente, a uma venda. */
  createPaymentIntent: (input: PaymentIntentInput) => IntentResult
  /** Cria cobrança Gateway (obrigação avulsa opcional + intenção + reserva) atomicamente. */
  createGatewayCharge: (input: GatewayChargeInput) => GatewayChargeResult
  /** Transiciona o estado de uma intenção (campos financeiros imutáveis) com encerramento atômico de reserva. */
  transitionPaymentIntent: (intentId: string, state: PaymentIntentState, note?: string) => boolean
  /** Cria uma tentativa de pagamento para uma intenção (com validação de ciclo de vida). */
  createPaymentAttempt: (intentId: string, payer?: string) => { ok: true; attemptId: string } | { ok: false; reason: string }
  /** Inicia a submissão (persiste AWAITING_SIGNATURE + pagador) ANTES da chamada à carteira. */
  beginPaymentSubmission: (attemptId: string, payer: string) => { ok: true } | { ok: false; reason: string }
  /** Registra a submissão do depósito (hash) em uma tentativa (hash imutável, replay idempotente). */
  registerDepositSubmission: (attemptId: string, txHash: string) => boolean
  /** Marca uma tentativa como ambígua (submissão sem resultado comprovado). */
  markAttemptAmbiguous: (attemptId: string, reason?: string) => boolean
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(load)
  // Snapshot autoritativo sincronizado: toda mutação o atualiza sincronicamente (fase UI 2.1.3).
  const dataRef = useRef(data)

  setCurrency(data.settings.currency)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      toast.error(t('Não foi possível salvar os dados neste navegador. Exporte um backup agora.', 'Could not save data in this browser. Export a backup now.'))
    }
  }, [data])

  // Pede ao navegador para não apagar os dados automaticamente quando faltar espaço.
  useEffect(() => {
    void navigator.storage?.persist?.()
  }, [])

  const store = useMemo<Store>(() => {
    /**
     * Commit autoritativo (fase UI 2.1.3): `fn` é avaliado UMA vez contra o snapshot sincronizado
     * (`dataRef.current`), o resultado é aplicado ao snapshot e agendado no React. O razão contábil
     * acompanha na MESMA atualização (atômico na memória). `auto: false` é só para substituição total.
     */
    const apply = (fn: (d: AppData) => AppData, auto = true): void => {
      const d = dataRef.current
      const n = fn(d)
      const final = !auto || n === d ? n : autoPost(d, n, { today: today(), actorId: n.settings.owner.trim() || 'local-user', now: new Date().toISOString() })
      dataRef.current = final
      setData(final)
    }
    const set = (fn: (d: AppData) => AppData) => apply(fn)
    /** Substituição direta do estado (backup/demonstração/apagar tudo), mantendo o snapshot sincronizado. */
    const replace = (next: AppData): void => {
      dataRef.current = next
      setData(next)
    }

    /** Operações do razão (plano de contas, revisões, câmbio, taxas): valida e aplica sobre o snapshot sincronizado. */
    const runLedger = <T,>(op: (l: LedgerState, ctx: Ctx) => OpResult<T>): LedgerResult<T> => {
      const mk = (d: AppData): Ctx => ({ now: new Date().toISOString(), actor: { id: d.settings.owner.trim() || 'local-user', kind: 'user' } })
      const d0 = dataRef.current
      const out = op(d0.ledger, mk(d0))
      replace({ ...d0, ledger: out.ledger })
      return out.ok ? { ok: true, value: out.value } : { ok: false, errors: out.errors }
    }

    /** Aplica uma mudança destrutiva e oferece desfazer por alguns segundos. */
    const undoable = (fn: (d: AppData) => AppData, message: string, auto = true) => {
      const snapshot = dataRef.current
      apply(fn, auto)
      const after = dataRef.current
      toast(message, {
        duration: 8000,
        action: {
          label: t('Desfazer', 'Undo'),
          onClick: () => {
            // Impede restaurar um snapshot completo quando houve alterações posteriores (evita perda de dados).
            if (dataRef.current !== after) {
              toast.info(t('Não foi possível desfazer: houve alterações posteriores.', 'Could not undo: later changes occurred.'))
              return
            }
            replace(snapshot)
          },
        },
      })
    }

    const actor = (): string => data.settings.owner || 'user'

    /** Executa a operação de logística UMA vez contra o snapshot autoritativo e integra o resultado ao commit. */
    const runShipmentOp = <T,>(op: (d: AppData, now: string) => logistics.Outcome<T>): LogisticsResult<T> => {
      const now = new Date().toISOString()
      const out = op(dataRef.current, now)
      if (!out.ok) return out
      // Integra o estado já calculado (com autoPost) — sem reexecutar a operação.
      apply(() => out.data)
      return { ok: true, value: out.value }
    }

    const settle = (d: AppData, id: string, amount: number, treasuryTx?: string, verified?: boolean): AppData => {
      const acc = d.accounts.find((a) => a.id === id)
      if (!acc || acc.status === 'paid') return d
      const date = today()
      const seq = (acc.settlements?.length ?? 0) + 1
      const settlement = { id: uid(), sequence: seq, amount: round2(amount), date, ...(treasuryTx ? { treasuryTx } : {}), ...(verified ? { verified } : {}) }
      const settlements = [...(acc.settlements ?? []), settlement]
      const paid = round2(settlements.reduce((s, x) => s + x.amount, 0))
      const fullyPaid = paid >= acc.amount - 1e-9
      const entry: Entry = {
        id: uid(),
        date,
        type: acc.kind === 'payable' ? 'out' : 'in',
        category: acc.category,
        description: acc.description,
        amount: round2(amount),
        environment: acc.environment ?? 'unassigned',
        sourceKind: 'account',
        sourceId: acc.id,
        settlementId: settlement.id,
      }
      return {
        ...d,
        entries: [entry, ...d.entries],
        accounts: d.accounts.map((a) => (a.id === id ? { ...a, settlements, status: fullyPaid ? 'paid' : 'open', paidAt: fullyPaid ? date : undefined, treasuryTx: treasuryTx ?? a.treasuryTx } : a)),
      }
    }

    /**
     * Aplica a alocação contábil de uma operação JÁ confirmada on-chain (idempotente).
     * - Depósito (sem `accountId`): só marca o crédito confirmado (sem obrigação).
     * - Pagamento (com `accountId`): baixa exatamente o valor verificado (parcial), com moeda/FX da conta.
     * - Obrigação ausente/já paga: NUNCA fabrica liquidação (revisão). Excesso é preservado como não-alocado.
     * Nunca reenvia transação; só posta contabilidade. Aritmética em unidades menores (bigint).
     */
    const applyConfirmedAccounting = (d: AppData, opId: string): AppData => {
      const cur = d.treasuryOps.find((o) => o.id === opId)
      if (!cur) return d
      const patch = (partial: Partial<TreasuryOp>): AppData => ({
        ...d,
        treasuryOps: d.treasuryOps.map((o) => (o.id === opId ? { ...o, status: 'confirmed' as const, settledAt: new Date().toISOString(), ...partial } : o)),
      })
      if (!cur.accountId) return patch({}) // depósito: sem obrigação.
      const acc = d.accounts.find((a) => a.id === cur.accountId)
      if (!acc) return patch({ accountingStatus: 'requires_review' as const, reviewReason: 'obligation_missing' })
      const alloc = allocationMinor(d.ledger, acc.currency, cur.amount, cur.date.slice(0, 10))
      if (!alloc.ok) return patch({ accountingStatus: 'requires_review' as const, reviewReason: alloc.reason })
      if (acc.status !== 'open') {
        // Obrigação já paga: o pagamento vira não-alocado explícito (não baixa de novo, não fabrica liquidação).
        return patch({ accountingStatus: 'requires_review' as const, reviewReason: 'already_settled', unallocatedAmount: toDisplayNumber(alloc.amountMinor, alloc.currency) })
      }
      const outstandingMinor = accountOutstandingMinor(acc)
      if (outstandingMinor === null) return patch({ accountingStatus: 'requires_review' as const, reviewReason: 'unknown_currency' })
      const plan = planAllocationMinor(alloc.amountMinor, outstandingMinor)
      let next = d
      if (plan.amountMinor > 0n) next = settle(next, cur.accountId, toDisplayNumber(plan.amountMinor, alloc.currency), cur.explorerUrl, true)
      const hasExcess = plan.excessMinor > 0n
      return {
        ...next,
        treasuryOps: next.treasuryOps.map((o) =>
          o.id === opId
            ? {
                ...o,
                status: 'confirmed' as const,
                settledAt: new Date().toISOString(),
                accountingStatus: hasExcess ? ('requires_review' as const) : plan.accountingStatus,
                allocatedAmount: toDisplayNumber(plan.amountMinor, alloc.currency),
                ...(hasExcess ? { unallocatedAmount: toDisplayNumber(plan.excessMinor, alloc.currency), reviewReason: 'excess_unallocated' as const } : {}),
              }
            : o,
        ),
      }
    }

    return {
      data,
      addProduct: (p) => {
        const env = getNetwork()
        const sku = p.sku.trim()
        const skuTaken = dataRef.current.products.some((x) => sku !== '' && x.sku === sku && x.environment === env)
        const { ok, errors } = validateProduct({ ...p, sku }, env, skuTaken)
        if (!ok) {
          toast.error(productErrorMessage(errors[0]))
          return ''
        }
        // Vínculos de fornecedor devem ser fornecedores do MESMO ambiente.
        const linked = [p.primarySupplierId, ...(p.alternateSupplierIds ?? [])].filter((x): x is string => !!x)
        for (const sid of linked) {
          const c = dataRef.current.contacts.find((x) => x.id === sid)
          if (!c || c.kind !== 'supplier' || (c.environment && c.environment !== env)) {
            toast.error(t('Fornecedor inválido ou de outro ambiente.', 'Invalid supplier or from another environment.'))
            return ''
          }
        }
        const id = uid()
        set((d) => {
          const envNow = getNetwork()
          const first = p.stock > 0 ? [{ id: uid(), productId: id, kind: 'in' as const, qty: p.stock, date: today(), note: t('Estoque inicial', 'Opening stock'), environment: envNow }] : []
          return { ...d, products: [{ ...p, sku, id, environment: envNow }, ...d.products], moves: [...first, ...d.moves] }
        })
        return id
      },
      updateProduct: (id, patch) => {
        const cur = dataRef.current.products.find((p) => p.id === id)
        if (!cur) {
          toast.error(t('Produto não encontrado.', 'Product not found.'))
          return false
        }
        // Ambiente imutável em edições comuns; não editar produto de outro ambiente.
        if (patch.environment !== undefined && patch.environment !== cur.environment) {
          toast.error(t('O ambiente do produto não pode ser alterado aqui.', 'The product environment cannot be changed here.'))
          return false
        }
        if (cur.environment && cur.environment !== 'unassigned' && cur.environment !== getNetwork()) {
          toast.error(t('Este produto pertence a outro ambiente e não pode ser editado aqui.', 'This product belongs to another environment and cannot be edited here.'))
          return false
        }
        // Custo médio e estoque são imutáveis via cadastro (atualizados por compras/movimentações).
        for (const f of IMMUTABLE_PRODUCT_FIELDS) {
          if (f === 'environment') continue
          if (patch[f] !== undefined && patch[f] !== cur[f]) {
            toast.error(t('Custo médio e estoque não podem ser alterados diretamente; use compras ou movimentações de estoque.', 'Average cost and stock cannot be changed directly; use purchases or stock movements.'))
            return false
          }
        }
        const merged = { ...cur, ...patch, environment: cur.environment }
        const skuTaken = dataRef.current.products.some((x) => x.id !== id && merged.sku.trim() !== '' && x.sku === merged.sku.trim() && x.environment === cur.environment)
        const { ok, errors } = validateProduct(merged, getNetwork(), skuTaken)
        if (!ok) {
          toast.error(productErrorMessage(errors[0]))
          return false
        }
        // Vínculos de fornecedor devem ser fornecedores do MESMO ambiente.
        const linked = [merged.primarySupplierId, ...(merged.alternateSupplierIds ?? [])].filter((x): x is string => !!x)
        for (const sid of linked) {
          const c = dataRef.current.contacts.find((x) => x.id === sid)
          if (!c || c.kind !== 'supplier' || (c.environment && c.environment !== cur.environment)) {
            toast.error(t('Fornecedor inválido ou de outro ambiente.', 'Invalid supplier or from another environment.'))
            return false
          }
        }
        set((d) => ({ ...d, products: d.products.map((p) => (p.id === id ? { ...p, ...patch, environment: cur.environment } : p)) }))
        return true
      },
      removeProduct: (id) => undoable((d) => ({ ...d, products: d.products.filter((p) => p.id !== id) }), t('Produto removido.', 'Product removed.')),
      moveStock: (productId, kind, qty, note) =>
        set((d) => {
          const delta = kind === 'in' ? qty : kind === 'out' ? -qty : 0
          return {
            ...d,
            products: d.products.map((p) =>
              p.id === productId ? { ...p, stock: kind === 'adjust' ? qty : Math.max(0, p.stock + delta) } : p,
            ),
            moves: [{ id: uid(), productId, kind, qty, date: today(), note, environment: getNetwork() }, ...d.moves],
          }
        }),
      addContact: (c) => {
        const env = getNetwork()
        const id = uid()
        const { result, nextState } = addContactTransition(dataRef.current, c, env, id)
        if (!result.ok) return { ok: false, code: result.code, message: contactSaveMessage(result.code) }
        replace(nextState)
        return { ok: true, id }
      },
      updateContact: (id, patch) => {
        const env = getNetwork()
        const { result, nextState } = updateContactTransition(dataRef.current, id, patch, env)
        if (!result.ok) return { ok: false, code: result.code, message: contactSaveMessage(result.code) }
        replace(nextState)
        return { ok: true, id: result.id }
      },
      removeContact: (id) => undoable((d) => ({ ...d, contacts: d.contacts.filter((c) => c.id !== id) }), t('Cadastro removido.', 'Record removed.')),
      // Livro-Caixa continua sendo a fonte do caixa. O razão acompanha na MESMA atualização de estado
      // (atômico dentro da memória) e nunca derruba o lançamento manual: erros viram eventos rejeitados na auditoria.
      addEntry: (e) => {
        if (isDateClosed(dataRef.current.ledger, e.date, getNetwork())) {
          toast.error(t('Período fechado: este mês está fechado e não aceita novos lançamentos. Reabra o período para lançar.', 'Closed period: this month is closed and does not accept new entries. Reopen the period to post.'))
          return { ok: false, reason: 'period_closed' }
        }
        // Defesa em profundidade (P4): categorias com supported: false não podem ser lançadas.
        if (isUnsupportedCategory(e.category)) {
          toast.error(t('Esta categoria não tem suporte contábil e não pode ser lançada. Escolha uma categoria válida.', 'This category has no accounting support and cannot be posted. Choose a valid category.'))
          return { ok: false, reason: 'unsupported_category' }
        }
        set((d) => {
          const entry = { ...e, id: uid(), environment: getNetwork() }
          return { ...d, entries: [entry, ...d.entries], ledger: guardLedger(d, (ctx) => syncAdded(d.ledger, entry, ctx)) }
        })
        return { ok: true }
      },
      createLedgerAccount: (input) => runLedger((l, ctx) => chartOps.createAccount(l, input, ctx)),
      updateLedgerAccount: (code, patch) => runLedger((l, ctx) => chartOps.updateAccount(l, code, patch, ctx)),
      setLedgerAccountActive: (code, active) => runLedger((l, ctx) => chartOps.setAccountActive(l, code, active, ctx)),
      deleteLedgerAccount: (code) => runLedger((l, ctx) => chartOps.deleteAccount(l, code, ctx)),
      reviewLedgerItem: (input) => runLedger((l, ctx) => reviewOps.recordReview(l, input, ctx)),
      recordLedgerFxRate: (input) => runLedger((l, ctx) => reviewOps.recordFxRate(l, input, ctx)),
      registerLedgerFee: (input) => runLedger((l, ctx) => registerFee(l, input, ctx)),
      confirmLedgerFee: (dedupeKey, patch) => runLedger((l, ctx) => confirmFee(l, dedupeKey, patch, ctx)),
      closeAccountingPeriod: (key) => runLedger((l, ctx) => closePeriod(l, key, getNetwork(), ctx)),
      reopenAccountingPeriod: (key, reason) => runLedger((l, ctx) => reopenPeriod(l, key, reason, getNetwork(), ctx)),
      setAccountingPeriodReview: (key) => runLedger((l, ctx) => setPeriodReview(l, key, getNetwork(), ctx)),
      reconcilePurchases: (ids) => {
        const wanted = new Set(ids)
        const mk = (d: AppData): Ctx => ({ now: new Date().toISOString(), actor: { id: d.settings.owner.trim() || 'local-user', kind: 'user' } })
        const plan = planPurchaseReconciliation(data).filter((i) => wanted.has(i.purchaseId))
        const out = applyPurchaseReconciliation(data.ledger, plan, mk(data))
        apply((d) => {
          const again = planPurchaseReconciliation(d).filter((i) => wanted.has(i.purchaseId))
          return { ...d, ledger: applyPurchaseReconciliation(d.ledger, again, mk(d)).ledger }
        }, false)
        return { ok: true as const, value: { posted: out.posted, duplicates: out.duplicates, rejected: out.rejected } }
      },
      setLedgerAdapter: (name, on) => set((d) => ({ ...d, ledger: setAdapterFlag(d.ledger, name, on, ledgerCtx(d)) })),
      updateEntry: (id, patch) => {
        const before = dataRef.current.entries.find((e) => e.id === id)
        if (!before) return { ok: false, reason: 'not_found' }
        // Proteção (FIN-01.1): não editar lançamento de outro ambiente.
        if (before.environment && before.environment !== 'unassigned' && before.environment !== getNetwork()) {
          toast.error(t('Este lançamento pertence a outro ambiente e não pode ser editado aqui.', 'This entry belongs to another environment and cannot be edited here.'))
          return { ok: false, reason: 'wrong_environment' }
        }
        const after = { ...before, ...patch }
        // O ambiente de origem não pode ser alterado por patch comum (classificação é via setEntryEnvironment).
        if (after.environment !== before.environment) {
          toast.error(t('O ambiente do lançamento não pode ser alterado aqui.', 'The entry environment cannot be changed here.'))
          return { ok: false, reason: 'env_immutable' }
        }
        const financial = (['type', 'amount', 'date', 'category'] as const).some((k) => before[k] !== after[k])
        if (financial && (isDateClosed(dataRef.current.ledger, before.date, before.environment) || isDateClosed(dataRef.current.ledger, after.date, before.environment))) {
          toast.error(t('Período fechado: edições financeiras neste mês estão bloqueadas. Reabra o período para ajustar.', 'Closed period: financial edits in this month are blocked. Reopen the period to adjust.'))
          return { ok: false, reason: 'period_closed' }
        }
        set((d) => {
          const b = d.entries.find((e) => e.id === id)
          if (!b) return d
          const a = { ...b, ...patch }
          return { ...d, entries: d.entries.map((e) => (e.id === id ? a : e)), ledger: guardLedger(d, (ctx) => syncUpdated(d.ledger, b, a, ctx)) }
        })
        return { ok: true }
      },
      removeEntry: (id) => {
        const gone = dataRef.current.entries.find((e) => e.id === id)
        if (!gone) return { ok: false, reason: 'not_found' }
        if (gone.environment && gone.environment !== 'unassigned' && gone.environment !== getNetwork()) {
          toast.error(t('Este lançamento pertence a outro ambiente e não pode ser removido aqui.', 'This entry belongs to another environment and cannot be removed here.'))
          return { ok: false, reason: 'wrong_environment' }
        }
        if (isDateClosed(dataRef.current.ledger, gone.date, gone.environment)) {
          toast.error(t('Período fechado: este lançamento não pode ser removido. Reabra o período para ajustar.', 'Closed period: this entry cannot be removed. Reopen the period to adjust.'))
          return { ok: false, reason: 'period_closed' }
        }
        undoable((d) => {
          const g = d.entries.find((e) => e.id === id)
          return { ...d, entries: d.entries.filter((e) => e.id !== id), ledger: g ? guardLedger(d, (ctx) => syncRemoved(d.ledger, g, ctx)) : d.ledger }
        }, t('Lançamento removido.', 'Entry removed.'))
        return { ok: true }
      },
      setEntryEnvironment: (id, environment) => {
        const cur = dataRef.current.entries.find((e) => e.id === id)
        if (!cur) return { ok: false, reason: 'not_found' }
        if (cur.environment && cur.environment !== 'unassigned') return { ok: false, reason: 'already_classified' }
        // Rejeita classificação incompatível com a origem comprovada (vínculo inequívoco).
        const src = dataRef.current
        const srcEnv = cur.sourceKind === 'sale' ? src.sales.find((s) => s.id === cur.sourceId)?.environment : cur.sourceKind === 'account' ? src.accounts.find((a) => a.id === cur.sourceId)?.environment : cur.sourceKind === 'purchase' ? src.purchases.find((p) => p.id === cur.sourceId)?.environment : undefined
        if (srcEnv && srcEnv !== 'unassigned' && srcEnv !== environment) return { ok: false, reason: 'conflicting_evidence' }
        let applied = false
        set((d) => {
          const e = d.entries.find((x) => x.id === id)
          if (!e || (e.environment && e.environment !== 'unassigned')) return d
          applied = true
          return {
            ...d,
            entries: d.entries.map((x) => (x.id === id ? { ...x, environment } : x)),
            ledger: withAudit(d.ledger, ledgerCtx(d), 'record.classified', `entry ${id} classified as ${environment}`),
          }
        })
        return applied ? { ok: true } : { ok: false, reason: 'already_classified' }
      },
      addAccount: (a) => {
        if (isUnsupportedCategory(a.category)) {
          toast.error(t('Esta categoria não tem suporte contábil e não pode ser usada nesta conta. Escolha uma categoria válida.', 'This category has no accounting support and cannot be used in this bill. Choose a valid category.'))
          return ''
        }
        const id = uid()
        set((d) => ({ ...d, accounts: [{ ...a, id, status: 'open', source: a.source ?? 'manual', currency: a.currency ?? d.settings.currency, environment: getNetwork() }, ...d.accounts] }))
        return id
      },
      updateAccount: (id, patch) => {
        const cur = dataRef.current.accounts.find((a) => a.id === id)
        if (!cur) {
          toast.error(t('Conta não encontrada.', 'Bill not found.'))
          return false
        }
        // O ambiente de origem é imutável em edições comuns (classificação é via setAccountEnvironment).
        if (patch.environment !== undefined && patch.environment !== cur.environment) {
          toast.error(t('O ambiente da conta não pode ser alterado aqui.', 'The bill environment cannot be changed here.'))
          return false
        }
        // Não editar obrigação de outro ambiente.
        if (cur.environment && cur.environment !== 'unassigned' && cur.environment !== getNetwork()) {
          toast.error(t('Esta conta pertence a outro ambiente e não pode ser editada aqui.', 'This bill belongs to another environment and cannot be edited here.'))
          return false
        }
        // Categoria válida e compatível com o tipo da obrigação (P8).
        if (patch.category !== undefined) {
          if (isUnsupportedCategory(patch.category)) {
            toast.error(t('Esta categoria não tem suporte contábil e não pode ser usada nesta conta.', 'This category has no accounting support and cannot be used in this bill.'))
            return false
          }
          const cat = categoryById(patch.category)
          const expectedKind = cur.kind === 'payable' ? 'expense' : 'income'
          if (cat && cat.kind !== expectedKind) {
            toast.error(t('A categoria não é compatível com o tipo desta conta.', 'The category is incompatible with this bill type.'))
            return false
          }
        }
        set((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, ...patch, environment: cur.environment } : a)) }))
        return true
      },
      setAccountEnvironment: (id, environment) => {
        const decision = canClassifyEnvironment(data.accounts.find((a) => a.id === id), data.treasuryOps, environment)
        if (!decision.ok) {
          toast.error(classifyReasonText(decision.reason))
          return { ok: false, reason: decision.reason }
        }
        // Revalida no estado mais recente e registra a decisão na trilha de auditoria do razão.
        set((d) => {
          const recheck = canClassifyEnvironment(d.accounts.find((a) => a.id === id), d.treasuryOps, environment)
          if (!recheck.ok) return d
          return {
            ...d,
            ledger: withAudit(d.ledger, ledgerCtx(d), 'account.classified', `account ${id} classified as ${environment}`),
            accounts: d.accounts.map((a) => (a.id === id ? { ...a, environment } : a)),
          }
        })
        return { ok: true }
      },
      setRecordEnvironment: (kind, id, environment) => {
        const record = entityRecord(data, kind, id)
        if (!record) {
          toast.error(t('Registro não encontrado.', 'Record not found.'))
          return { ok: false, reason: 'not_found' }
        }
        if (record.environment && record.environment !== 'unassigned') {
          toast.error(t('Este registro já tem ambiente definido.', 'This record already has an environment.'))
          return { ok: false, reason: 'already_classified' }
        }
        // Evidência conflitante: venda vinculada a uma conta de outro ambiente.
        if (kind === 'sale') {
          const sale = record as Sale
          const accEnv = sale.accountId ? data.accounts.find((a) => a.id === sale.accountId)?.environment : undefined
          if (accEnv && accEnv !== 'unassigned' && accEnv !== environment) {
            toast.error(t('Há evidência de outro ambiente para esta venda.', 'There is evidence of another environment for this sale.'))
            return { ok: false, reason: 'conflicting_evidence' }
          }
        }
        set((d) => {
          const cur = entityRecord(d, kind, id)
          if (!cur || (cur.environment && cur.environment !== 'unassigned')) return d
          const next = setEntityRecord(d, kind, id, environment)
          return { ...next, ledger: withAudit(next.ledger, ledgerCtx(next), 'record.classified', `${kind} ${id} classified as ${environment}`) }
        })
        return { ok: true }
      },
      settleAccount: (id, treasuryTx) => {
        const acc = data.accounts.find((a) => a.id === id)
        if (!acc || acc.status === 'paid') return
        set((d) => settle(d, id, accountOutstanding(acc), treasuryTx))
      },
      settleAccountPartial: (id, amount, treasuryTx) => {
        const acc = data.accounts.find((a) => a.id === id)
        if (!acc || acc.status === 'paid') return
        if (!(amount > 0)) {
          toast.error(t('Informe um valor positivo.', 'Enter a positive amount.'))
          return
        }
        if (amount > accountOutstanding(acc)) {
          toast.error(t('Valor acima do saldo em aberto. Pagamento recusado.', 'Amount exceeds the outstanding balance. Payment rejected.'))
          return
        }
        set((d) => settle(d, id, amount, treasuryTx))
      },
      removeAccount: (id) => undoable((d) => ({ ...d, accounts: d.accounts.filter((a) => a.id !== id) }), t('Conta removida.', 'Bill removed.')),
      preparePayment: (id, network) => {
        const acc = data.accounts.find((a) => a.id === id)
        if (!acc || acc.paymentNetwork === network) return
        // Bloqueia mudança de ambiente quando há intenção ativa (pendente/ambígua/revisão) em QUALQUER rede.
        if (inFlightIntentEnv(id, data.treasuryOps) !== null) {
          toast.error(t('Há um pagamento em processamento para esta obrigação. Acompanhe na reconciliação antes de trocar a rede.', 'There is a payment in progress for this obligation. Track it in reconciliation before changing the network.'))
          return
        }
        // A preparação respeita o ambiente de ORIGEM: uma obrigação Mainnet não pode ser preparada para Testnet
        // (e vice-versa) apenas alterando paymentNetwork. Obrigações sem ambiente definido não podem ser pagas.
        if (acc.environment && acc.environment !== 'unassigned' && acc.environment !== network) {
          toast.error(t('Esta obrigação pertence a outro ambiente financeiro e não pode ser preparada aqui.', 'This obligation belongs to another financial environment and cannot be prepared here.'))
          return
        }
        if (!acc.environment || acc.environment === 'unassigned') {
          toast.error(t('Esta obrigação ainda não tem ambiente financeiro definido. Revise a classificação antes de pagar.', 'This obligation has no financial environment defined yet. Review its classification before paying.'))
          return
        }
        set((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, paymentNetwork: network } : a)) }))
      },
      cancelAccount: (id) => {
        const decision = canCancel(data.accounts.find((a) => a.id === id), data.treasuryOps)
        if (!decision.ok) {
          toast.error(cancelReasonText(decision.reason))
          return { ok: false, reason: decision.reason }
        }
        // Revalida no estado mais recente dentro do updater (defesa contra corrida entre renders).
        undoable((d) => {
          const recheck = canCancel(d.accounts.find((a) => a.id === id), d.treasuryOps)
          if (!recheck.ok) return d
          return { ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, canceledAt: today() } : a)) }
        }, t('Obrigação cancelada (arquivada).', 'Obligation canceled (archived).'))
        return { ok: true }
      },
      cancelAccounts: (ids) => {
        const canceled: string[] = []
        const refused: { id: string; reason: string }[] = []
        for (const id of ids) {
          const decision = canCancel(data.accounts.find((a) => a.id === id), data.treasuryOps)
          if (decision.ok) canceled.push(id)
          else refused.push({ id, reason: decision.reason })
        }
        set((d) => {
          const valid = new Set(canceled)
          return { ...d, accounts: d.accounts.map((a) => (valid.has(a.id) && canCancel(a, d.treasuryOps).ok ? { ...a, canceledAt: today() } : a)) }
        })
        return { canceled, refused }
      },
      cancelSale: (id) =>
        undoable((d) => {
          const sale = d.sales.find((s) => s.id === id)
          if (!sale || sale.canceledAt) return d
          const date = today()
          const acc = sale.accountId ? d.accounts.find((a) => a.id === sale.accountId) : undefined
          // Valor efetivamente recebido: venda a prazo/USDC → soma das liquidações; demais → caixa imediato (total).
          const received = acc ? accountPaidAmount(acc) : sale.total
          const next: AppData = {
            ...d,
            sales: d.sales.map((s) => (s.id === id ? { ...s, canceledAt: date } : s)),
            products: d.products.map((p) => {
              const it = sale.items.find((i) => i.productId === p.id)
              return it ? { ...p, stock: p.stock + it.qty } : p
            }),
            moves: [
              ...sale.items.map((i) => ({
                id: uid(),
                productId: i.productId,
                kind: 'in' as const,
                qty: i.qty,
                date,
                note: t(`Cancelamento da venda ${sale.id}`, `Sale ${sale.id} canceled`),
              })),
              ...d.moves,
            ],
          }
          if (acc && acc.status === 'open') next.accounts = d.accounts.filter((a) => a.id !== acc.id)
          if (received > 0) {
            next.entries = [
              {
                id: uid(),
                date,
                type: 'out',
                category: CAT_SALES,
                description: t(`Estorno da venda para ${sale.customerName}`, `Refund of sale to ${sale.customerName}`),
                amount: received,
                environment: sale.environment ?? 'unassigned',
                sourceKind: 'sale',
                sourceId: sale.id,
              },
              ...d.entries,
            ]
          }
          return next
        }, t('Venda cancelada. Estoque e caixa foram ajustados.', 'Sale canceled. Stock and cash were adjusted.')),
      recordSale: (input) => {
        const env = getNetwork()
        let result: SaleResult = { ok: false }
        // Toda a validação e a mutação acontecem DENTRO do updater, contra o estado autoritativo
        // (dataRef.current via `apply`): nada de snapshot desatualizado. Execução atômica.
        set((d) => {
          // Idempotência por intenção: a mesma chave não gera duas vendas.
          if (input.intentId && d.sales.some((s) => s.intentId === input.intentId)) {
            toast.error(t('Operação já registrada.', 'Operation already recorded.'))
            return d
          }
          // Consolida produtos repetidos: a quantidade TOTAL por produto é validada contra o estoque.
          const byProduct = new Map<string, number>()
          const priceOf = new Map<string, number>()
          for (const it of input.items) {
            byProduct.set(it.productId, (byProduct.get(it.productId) ?? 0) + it.qty)
            if (!priceOf.has(it.productId)) priceOf.set(it.productId, it.price)
          }
          const customer = d.contacts.find((c) => c.id === input.customerId)
          if (customer && customer.environment && customer.environment !== env) {
            toast.error(t('Há cliente de outro ambiente neste pedido. Revalide o carrinho.', 'This order has a customer from another environment. Revalidate the cart.'))
            return d
          }
          const items: SaleItem[] = []
          for (const [productId, qty] of byProduct) {
            const p = d.products.find((x) => x.id === productId)
            if (!p) {
              toast.error(t('Produto não encontrado neste ambiente. Revise o carrinho.', 'Product not found in this environment. Review the cart.'))
              return d
            }
            if (p.environment && p.environment !== env) {
              toast.error(t('Há produtos de outro ambiente neste pedido. Revalide o carrinho.', 'This order has products from another environment. Revalidate the cart.'))
              return d
            }
            if (!Number.isSafeInteger(qty) || qty <= 0) {
              toast.error(t('Quantidade inválida no pedido. Revise o carrinho.', 'Invalid quantity in the order. Review the cart.'))
              return d
            }
            if (qty > p.stock) {
              toast.error(t(`Estoque insuficiente para "${p.name}". Disponíveis: ${p.stock}.`, `Insufficient stock for "${p.name}". Available: ${p.stock}.`))
              return d
            }
            items.push({ productId: p.id, name: p.name, qty, price: priceOf.get(productId) ?? p.price, cost: p.cost })
          }
          const date = today()
          const saleId = uid()
          const total = round2(items.reduce((s, i) => s + i.qty * i.price, 0))
          const cogs = round2(items.reduce((s, i) => s + i.qty * i.cost, 0))
          const customerName = customer?.name ?? t('Consumidor final', 'Walk-in customer')
          const next: AppData = {
            ...d,
            products: d.products.map((p) => {
              const it = items.find((i) => i.productId === p.id)
              return it ? { ...p, stock: Math.max(0, p.stock - it.qty) } : p
            }),
            moves: [...items.map((i) => ({ id: uid(), productId: i.productId, kind: 'out' as const, qty: i.qty, date, note: t(`Venda ${saleId}`, `Sale ${saleId}`), environment: env })), ...d.moves],
          }
          let accountId: string | undefined
          // USDC e a prazo geram uma OBRIGAÇÃO a receber (não caixa imediato). USDC aguarda a Treasury confirmar o recebimento.
          if (input.method === 'prazo' || input.method === 'usdc') {
            accountId = uid()
            const acc: Account = {
              id: accountId,
              kind: 'receivable',
              description: t(`Venda ${input.method === 'usdc' ? 'em USDC' : 'a prazo'} (${items.length} ${items.length === 1 ? 'item' : 'itens'})`, `Sale ${input.method === 'usdc' ? 'in USDC' : 'on credit'} (${items.length} ${items.length === 1 ? 'item' : 'items'})`),
              contactId: customer?.id,
              contactName: customerName,
              amount: total,
              dueDate: input.dueDate ?? addDays(date, input.method === 'usdc' ? 1 : 30),
              category: CAT_SALES,
              status: 'open',
              source: 'sale',
              sourceId: saleId,
              currency: d.settings.currency,
              environment: env,
            }
            next.accounts = [acc, ...d.accounts]
          } else {
            next.entries = [
              { id: uid(), date, type: 'in', category: CAT_SALES, description: t(`Venda para ${customerName} (${input.method})`, `Sale to ${customerName} (${input.method})`), amount: total, environment: env, sourceKind: 'sale', sourceId: saleId },
              ...d.entries,
            ]
          }
          const sale: Sale = { id: saleId, date, customerId: customer?.id, customerName, items, total, cogs, method: input.method, accountId, environment: env, ...(input.intentId ? { intentId: input.intentId } : {}) }
          next.sales = [sale, ...d.sales]
          result = { ok: true, saleId, ...(accountId ? { accountId } : {}) }
          return next
        })
        return result
      },
      recordPurchase: (input) => {
        const env = getNetwork()
        let recorded = false
        // Validação e mutação DENTRO do updater (estado autoritativo) — nada de snapshot desatualizado.
        set((d) => {
          // Idempotência por intenção: a mesma chave não gera duas compras.
          if (input.intentId && d.purchases.some((p) => p.intentId === input.intentId)) {
            toast.error(t('Operação já registrada.', 'Operation already recorded.'))
            return d
          }
          const supplier = d.contacts.find((c) => c.id === input.supplierId)
          if (supplier && supplier.environment && supplier.environment !== env) {
            toast.error(t('Fornecedor de outro ambiente nesta compra.', 'Supplier from another environment in this purchase.'))
            return d
          }
          if (input.items.length === 0) {
            toast.error(t('A compra não possui itens.', 'The purchase has no items.'))
            return d
          }
          // Valida cada linha — nunca converte valor inválido em zero.
          for (const it of input.items) {
            const p = d.products.find((x) => x.id === it.productId)
            if (!p) {
              toast.error(t('Produto não encontrado neste ambiente. Revise a compra.', 'Product not found in this environment. Review the purchase.'))
              return d
            }
            if (p.environment && p.environment !== env) {
              toast.error(t('Produto de outro ambiente nesta compra.', 'Product from another environment in this purchase.'))
              return d
            }
            if (!Number.isFinite(it.qty) || it.qty <= 0) {
              toast.error(t('Quantidade inválida na compra.', 'Invalid quantity in the purchase.'))
              return d
            }
            if (!Number.isFinite(it.cost) || it.cost < 0) {
              toast.error(t('Custo inválido na compra.', 'Invalid cost in the purchase.'))
              return d
            }
          }
          const date = today()
          const total = round2(input.items.reduce((s, i) => s + i.qty * i.cost, 0))
          const name = supplier?.name ?? t('Fornecedor avulso', 'One-off supplier')
          const awaiting = !!input.awaitReceipt
          const purchaseId = receiving.nextPurchaseId(d.purchases)
          // Consolida produtos repetidos: soma quantidade e valor total por produto (integridade do estoque/custo).
          const consolidated = new Map<string, { qty: number; value: number }>()
          for (const it of input.items) {
            const cur = consolidated.get(it.productId) ?? { qty: 0, value: 0 }
            cur.qty += it.qty
            cur.value += it.qty * it.cost
            consolidated.set(it.productId, cur)
          }
          const next: AppData = {
            ...d,
            // Fluxo padrão: a compra soma o estoque na hora. Aguardando recebimento: o estoque só entra no recebimento.
            products: awaiting
              ? d.products
              : d.products.map((p) => {
                  const c = consolidated.get(p.id)
                  // Custo médio ponderado móvel (nunca o último custo; consolida linhas repetidas).
                  return c ? { ...p, stock: p.stock + c.qty, cost: weightedAverageFromValue(p.stock, p.cost, c.qty, c.value) } : p
                }),
            moves: awaiting
              ? d.moves
              : [
                  ...input.items.map((i) => ({ id: uid(), productId: i.productId, kind: 'in' as const, qty: i.qty, date, note: t(`Compra de ${name}`, `Purchase from ${name}`), environment: env })),
                  ...d.moves,
                ],
            purchases: [
              {
                id: purchaseId,
                date,
                supplierId: supplier?.id,
                supplierName: name,
                items: input.items.map((i) => {
                  const p = d.products.find((x) => x.id === i.productId)
                  return { productId: i.productId, name: p?.name ?? '', sku: p?.sku ?? '', qty: i.qty, cost: i.cost }
                }),
                total,
                stockPosted: !awaiting,
                createdAt: new Date().toISOString(),
                environment: env,
                ...(input.intentId ? { intentId: input.intentId } : {}),
              },
              ...d.purchases,
            ],
          }
          const description = t(`Compra de mercadorias - ${name}`, `Merchandise purchase - ${name}`)
          if (input.paidNow) {
            next.entries = [{ id: uid(), date, type: 'out', category: CAT_PURCHASE, description, amount: total, environment: env, sourceKind: 'purchase', sourceId: purchaseId }, ...d.entries]
          } else {
            next.accounts = [
              {
                id: uid(),
                kind: 'payable',
                description,
                contactId: supplier?.id,
                contactName: name,
                amount: total,
                dueDate: input.dueDate,
                category: CAT_PURCHASE,
                status: 'open',
                source: 'purchase',
                sourceId: purchaseId,
                currency: d.settings.currency,
                environment: env,
              },
              ...d.accounts,
            ]
          }
          recorded = true
          return next
        })
        return recorded
      },
      addEmployee: (e) => {
        const env = getNetwork()
        const id = uid()
        const { result, nextState } = addEmployeeTransition(dataRef.current, e, env, id)
        if (!result.ok) return { ok: false, code: result.code, message: employeeSaveMessage(result.code) }
        replace(nextState)
        return { ok: true, id }
      },
      updateEmployee: (id, patch) => {
        const env = getNetwork()
        const { result, nextState } = updateEmployeeTransition(dataRef.current, id, patch, env)
        if (!result.ok) return { ok: false, code: result.code, message: employeeSaveMessage(result.code) }
        replace(nextState)
        return { ok: true, id: result.id }
      },
      removeEmployee: (id) => undoable((d) => ({ ...d, employees: d.employees.filter((e) => e.id !== id) }), t('Funcionário removido.', 'Employee removed.')),
      runPayroll: (month, dueDate) => {
        const pending = (d: AppData) =>
          d.employees
            .filter((e) => e.active && e.environment === getNetwork())
            .filter((e) => !d.accounts.some((a) => a.source === 'payroll' && a.employeeId === e.id && a.description.endsWith(month)))
        const created = pending(data).length
        apply((d) => {
          const accs: Account[] = pending(d).map((e) => ({
            id: uid(),
            kind: 'payable',
            description: t(`Salário ${e.name} - ${month}`, `Salary ${e.name} - ${month}`),
            contactName: e.name,
            amount: e.salary,
            dueDate,
            category: CAT_PAYROLL,
            status: 'open',
            source: 'payroll',
            currency: d.settings.currency,
            environment: getNetwork(),
            employeeId: e.id,
          }))
          return { ...d, accounts: [...accs, ...d.accounts] }
        })
        return created
      },
      addRequest: (r) => {
        const id = uid()
        set((d) => ({ ...d, requests: [{ ...r, id, status: 'open', createdAt: new Date().toISOString() }, ...d.requests] }))
        return id
      },
      updateRequest: (id, patch) => set((d) => ({ ...d, requests: d.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      receiveRequest: (id, txHash, payer, explorerUrl) =>
        set((d) => {
          const r = d.requests.find((x) => x.id === id)
          if (!r || r.status !== 'open') return d
          // Cobrança Circle Gateway (ou antiga apontando para o GatewayWallet) exige verificação independente.
          if (requiresGatewayVerification(r)) return d
          let next: AppData = {
            ...d,
            requests: d.requests.map((x) => (x.id === id ? { ...x, status: 'paid', txHash, payer, explorerUrl, paidAt: new Date().toISOString() } : x)),
          }
          // Liquida exatamente o valor recebido (r.fiatAmount), nunca o saldo em aberto inteiro.
          const acc = d.accounts.find((a) => a.id === r.accountId && a.status === 'open')
          if (acc) {
            next = settle(next, r.accountId, r.fiatAmount, explorerUrl)
          }
          // Sem obrigação aberta: o recebimento fica preservado na cobrança (paga) e vai para a conciliação
          // — nenhuma entrada de caixa genérica é fabricada.
          return next
        }),
      // Logística: as regras ficam em lib/logistics.ts. Aqui só se valida no estado atual e aplica no próximo.
      // Remessas não alteram estoque nem financeiro.
      createShipment: (input) => runShipmentOp((d, now) => logistics.createShipment(d, input, now, actor(), getNetwork())),
      updateShipment: (id, input) => runShipmentOp((d, now) => logistics.updateShipment(d, id, input, now, actor())),
      transitionShipment: (id, to, opts = {}) => runShipmentOp((d, now) => logistics.transitionShipment(d, id, to, opts, now, today(), actor())),
      addShipmentEvent: (id, input) => runShipmentOp((d, now) => logistics.addTrackingEvent(d, id, input, now, actor())),
      addShipmentDocument: (id, input) => runShipmentOp((d, now) => logistics.addDocument(d, id, input, now, actor())),
      pickShipmentItem: (id, itemId, qty) => runShipmentOp((d, now) => fulfillment.pickItem(d, id, itemId, qty, now, actor())),
      packShipment: (id) => runShipmentOp((d, now) => fulfillment.packShipment(d, id, now, actor())),
      recordShipmentPod: (id, input) => runShipmentOp((d, now) => fulfillment.recordPod(d, id, input, now, actor())),
      closeShipmentFulfillment: (id) => runShipmentOp((d, now) => fulfillment.closeFulfillment(d, id, now, actor())),
      // Único ponto da logística que soma estoque: só depois da conferência do recebimento e uma única vez.
      receiveShipmentGoods: (id, input) => runShipmentOp((d, now) => receiving.receiveGoods(d, id, input, now, today(), actor(), getNetwork())),
      createCarrier: (input) => runShipmentOp((d, now) => carriers.createCarrier(d, input, now, getNetwork())),
      updateCarrier: (id, input) => runShipmentOp((d, now) => carriers.updateCarrier(d, id, input, now)),
      setCarrierActive: (id, active) => runShipmentOp((d, now) => carriers.setCarrierActive(d, id, active, now)),
      removeCarrier: (id) => runShipmentOp((d) => carriers.removeCarrier(d, id)),
      setShipmentFreight: (id, input) => runShipmentOp((d, now) => freight.setFreight(d, id, input, now, actor())),
      // Cria uma conta a pagar (Logística) uma única vez, na moeda do app. O pagamento segue pelo financeiro normal.
      postShipmentFreight: (id, dueDate) => runShipmentOp((d, now) => freight.postFreight(d, id, { dueDate }, now, d.settings.currency, actor())),
      setShipmentInternational: (id, input) => runShipmentOp((d, now) => international.setInternational(d, id, input, now, actor())),
      requestReturn: (input) => runShipmentOp((d, now) => returns.requestReturn(d, input, now, actor(), getNetwork())),
      authorizeReturn: (id, note = '') => runShipmentOp((d, now) => returns.authorizeReturn(d, id, note, now, actor())),
      rejectReturn: (id, note) => runShipmentOp((d, now) => returns.rejectReturn(d, id, note, now, actor())),
      cancelReturn: (id, note = '') => runShipmentOp((d, now) => returns.cancelReturn(d, id, note, now, actor())),
      createReturnShipment: (id) => runShipmentOp((d, now) => returns.createReturnShipment(d, id, now, actor(), getNetwork())),
      // Único ponto da devolução que mexe no estoque: só itens inspecionados em bom estado e com decisão de reestocar.
      inspectReturn: (id, input) => runShipmentOp((d, now) => returns.inspectReturn(d, id, input, now, today(), actor())),
      resolveReturn: (id, input) => runShipmentOp((d, now) => returns.resolveReturn(d, id, input, now, actor())),
      removeShipmentDraft: (id) => {
        const out = logistics.removeDraft(data, id)
        if (!out.ok) return out
        undoable((d) => {
          const again = logistics.removeDraft(d, id)
          return again.ok ? again.data : d
        }, t('Rascunho de remessa removido.', 'Draft shipment removed.'))
        return { ok: true, value: out.value }
      },
      addTreasuryOp: (op) => set((d) => ({ ...d, treasuryOps: [{ ...op, id: uid(), date: new Date().toISOString(), status: op.status ?? 'pending' }, ...d.treasuryOps] })),
      createPaymentIntent: (input) => {
        const env = getNetwork()
        const orgId = dataRef.current.ledger.orgId
        // Resolve a configuração AUTORITATIVA (não confia nos campos do chamador).
        const cfg = gatewayConfigFor(env)
        // Destino do depósito é SEMPRE o GatewayWallet oficial (registry). Sem configuração → falha explícita.
        const configured = treasuryRecipientFor(dataRef.current.settings, env)
        if (!configured) return { ok: false, reason: 'not_configured' }
        // Depositor = conta institucional CREDITADA, resolvida pela identidade autorizada (nunca o GatewayWallet).
        const identity = resolveInstitutionalGatewayContext(orgId, env, settingsIdentityRepository(dataRef.current.settings))
        const beneficiary = identity.ok ? (identity.context.depositor ?? '') : ''

        // usdcMinor (on-chain) exato: inteiro positivo ≤ uint256, sem float.
        let usdcMinor: bigint
        try {
          usdcMinor = parseMinorUnits(input.usdcMinor)
        } catch {
          return { ok: false, reason: 'invalid_amount' }
        }

        // amountMinor (moeda contábil da obrigação) — SEPARADO de usdcMinor.
        let amountMinor: bigint
        if (input.currency === 'USDC') {
          amountMinor = usdcMinor
          // Divergência monetária exata: amountDecimal deve casar com usdcMinor (sem arredondamento).
          if (input.amountDecimal !== undefined) {
            try {
              if (parseExactDecimal(input.amountDecimal, EXPONENT.USDC) !== usdcMinor) return { ok: false, reason: 'invalid_amount' }
            } catch {
              return { ok: false, reason: 'invalid_amount' }
            }
          }
        } else {
          // Moeda não-USDC: exige decimal textual autoritativo e cotação exata (sem conversão 1:1).
          if (input.amountDecimal === undefined || input.rate === undefined) return { ok: false, reason: 'invalid_amount' }
          const exp = EXPONENT[input.currency]
          try {
            amountMinor = parseExactDecimal(input.amountDecimal, exp)
          } catch {
            return { ok: false, reason: 'invalid_amount' }
          }
          const rateText = input.rate.trim()
          const r = parseRate(rateText)
          if (!r) return { ok: false, reason: 'invalid_amount' }
          const rateDecimals = (rateText.split('.')[1] ?? '').length
          let converted: bigint
          try {
            converted = convertToUsdcMinor(amountMinor, exp, r.num, rateDecimals)
          } catch {
            return { ok: false, reason: 'invalid_amount' }
          }
          if (converted !== usdcMinor) return { ok: false, reason: 'invalid_amount' }
        }

        // Fingerprint canônico dos parâmetros imutáveis (computado antes da busca idempotente).
        const fingerprint = intentFingerprint({
          organizationId: orgId,
          environment: env,
          accountId: input.accountId,
          ...(input.saleId ? { saleId: input.saleId } : {}),
          ...(input.customerId ? { customerId: input.customerId } : {}),
          currency: input.currency,
          amountMinor: String(amountMinor),
          usdcMinor: input.usdcMinor,
          ...(input.rate !== undefined ? { rate: input.rate } : {}),
          beneficiary,
          gatewayWallet: cfg.gatewayWallet,
          token: cfg.usdcToken,
          chainId: cfg.chainId,
          expiresAt: input.expiresAt,
        })

        // Idempotência segregada: chave composta por organização + ambiente + chave.
        let scopedKey: string | undefined
        if (input.idempotencyKey) {
          try {
            scopedKey = scopedIdempotencyKey({ organizationId: orgId, environment: env }, input.idempotencyKey)
          } catch {
            return { ok: false, reason: 'invalid_amount' }
          }
          const existing = dataRef.current.paymentIntents.find((i) => i.idempotencyKey === scopedKey)
          // Mesma chave + mesmo fingerprint → retorna a intenção existente; parâmetros divergentes → conflito.
          if (existing) return existing.fingerprint === fingerprint ? { ok: true, intentId: existing.intentId } : { ok: false, reason: 'conflict' }
        }

        const account = dataRef.current.accounts.find((a) => a.id === input.accountId)
        if (!account || account.kind !== 'receivable' || account.status !== 'open' || account.canceledAt) return { ok: false, reason: 'not_found' }
        if (account.environment !== env) return { ok: false, reason: 'not_found' }
        // Moeda original da obrigação: nunca misturar moedas distintas na reserva.
        if (account.currency !== input.currency) return { ok: false, reason: 'invalid_amount' }

        if (input.saleId) {
          const sale = dataRef.current.sales.find((s) => s.id === input.saleId)
          if (!sale || sale.canceledAt || sale.accountId !== input.accountId) return { ok: false, reason: 'not_found' }
        }
        // Reserva em unidades mínimas da moeda original (aritmética exata, sem float).
        const reservedMinor = dataRef.current.paymentReservations
          .filter((r) => r.accountId === input.accountId && (r.state === 'HELD' || r.state === 'REQUIRES_REVIEW'))
          .reduce((s, r) => s + BigInt(r.amountMinor), 0n)
        const outstandingMinor = accountOutstandingMinor(account)
        if (outstandingMinor === null) return { ok: false, reason: 'invalid_amount' }
        if (amountMinor > availableForReservation(outstandingMinor, reservedMinor)) return { ok: false, reason: 'invalid_amount' }
        // Expiração futura válida.
        const expires = Date.parse(input.expiresAt)
        if (!Number.isFinite(expires) || expires <= Date.now()) return { ok: false, reason: 'invalid_expiration' }

        const intentId = uid()
        const now = new Date().toISOString()
        const intent: PaymentIntent = {
          intentId,
          organizationId: orgId,
          ...(input.saleId ? { saleId: input.saleId } : {}),
          accountId: input.accountId,
          ...(input.customerId ? { customerId: input.customerId } : {}),
          environment: env,
          chainId: cfg.chainId,
          token: cfg.usdcToken,
          gatewayWallet: cfg.gatewayWallet,
          beneficiary,
          amount: input.amount,
          ...(input.amountDecimal !== undefined ? { amountDecimal: input.amountDecimal } : {}),
          currency: input.currency,
          amountMinor: String(amountMinor),
          usdcMinor: input.usdcMinor,
          ...(input.rate !== undefined ? { rate: input.rate } : {}),
          ...(scopedKey ? { idempotencyKey: scopedKey } : {}),
          ...(input.checkoutToken ? { checkoutToken: input.checkoutToken } : {}),
          fingerprint,
          createdAt: now,
          expiresAt: input.expiresAt,
          state: 'CREATED',
          txHashes: [],
          history: [{ at: now, state: 'CREATED' }],
        }
        const reservation: PaymentReservation = {
          reservationId: uid(),
          intentId,
          accountId: input.accountId,
          organizationId: orgId,
          environment: env,
          currency: input.currency,
          amountMinor: String(amountMinor),
          state: 'HELD',
          createdAt: now,
        }
        set((d) => ({ ...d, paymentIntents: [intent, ...d.paymentIntents], paymentReservations: [reservation, ...d.paymentReservations] }))
        return { ok: true, intentId }
      },
      createGatewayCharge: (input) => {
        const env = getNetwork()
        const orgId = dataRef.current.ledger.orgId
        const cfg = gatewayConfigFor(env)
        const configured = treasuryRecipientFor(dataRef.current.settings, env)
        if (!configured) return { ok: false, reason: 'not_configured' }
        const identity = resolveInstitutionalGatewayContext(orgId, env, settingsIdentityRepository(dataRef.current.settings))
        const beneficiary = identity.ok ? (identity.context.depositor ?? '') : ''

        // usdcMinor (on-chain) exato.
        let usdcMinor: bigint
        try {
          usdcMinor = parseMinorUnits(input.usdcMinor)
        } catch {
          return { ok: false, reason: 'invalid_amount' }
        }
        // amountMinor (moeda contábil) separado de usdcMinor.
        let amountMinor: bigint
        if (input.currency === 'USDC') {
          amountMinor = usdcMinor
          if (input.amountDecimal !== undefined) {
            try {
              if (parseExactDecimal(input.amountDecimal, EXPONENT.USDC) !== usdcMinor) return { ok: false, reason: 'invalid_amount' }
            } catch {
              return { ok: false, reason: 'invalid_amount' }
            }
          }
        } else {
          if (input.amountDecimal === undefined || input.rate === undefined) return { ok: false, reason: 'invalid_amount' }
          const exp = EXPONENT[input.currency]
          try {
            amountMinor = parseExactDecimal(input.amountDecimal, exp)
          } catch {
            return { ok: false, reason: 'invalid_amount' }
          }
          const rateText = input.rate.trim()
          const r = parseRate(rateText)
          if (!r) return { ok: false, reason: 'invalid_amount' }
          const rateDecimals = (rateText.split('.')[1] ?? '').length
          let converted: bigint
          try {
            converted = convertToUsdcMinor(amountMinor, exp, r.num, rateDecimals)
          } catch {
            return { ok: false, reason: 'invalid_amount' }
          }
          if (converted !== usdcMinor) return { ok: false, reason: 'invalid_amount' }
        }

        // Idempotência: mesma chave retorna a intenção existente (estável durante retries).
        let scopedKey: string | undefined
        if (input.idempotencyKey) {
          try {
            scopedKey = scopedIdempotencyKey({ organizationId: orgId, environment: env }, input.idempotencyKey)
          } catch {
            return { ok: false, reason: 'invalid_amount' }
          }
          const existing = dataRef.current.paymentIntents.find((i) => i.idempotencyKey === scopedKey)
          if (existing) return { ok: true, intentId: existing.intentId, configPending: !existing.beneficiary }
        }

        const now = new Date().toISOString()
        const intentId = uid()
        const fingerprint = intentFingerprint({
          organizationId: orgId,
          environment: env,
          accountId: input.accountId ?? '',
          currency: input.currency,
          amountMinor: String(amountMinor),
          usdcMinor: input.usdcMinor,
          ...(input.rate !== undefined ? { rate: input.rate } : {}),
          beneficiary,
          gatewayWallet: cfg.gatewayWallet,
          token: cfg.usdcToken,
          chainId: cfg.chainId,
          expiresAt: input.expiresAt,
        })

        // Criação atômica: obrigação avulsa (se houver) + intenção + reserva na MESMA mutação.
        let result: GatewayChargeResult = { ok: false, reason: 'invalid_amount' }
        set((d) => {
          let account = input.accountId ? d.accounts.find((a) => a.id === input.accountId) : undefined
          let accounts = d.accounts
          if (!account) {
            if (!input.description) {
              result = { ok: false, reason: 'not_found' }
              return d
            }
            const accId = uid()
            account = {
              id: accId,
              kind: 'receivable',
              description: input.description,
              contactName: t('Cobrança avulsa', 'One-off charge'),
              amount: input.amount,
              dueDate: today(),
              category: 'Serviços prestados',
              status: 'open',
              source: 'manual',
              currency: input.currency,
              environment: env,
            }
            accounts = [account, ...d.accounts]
          }
          if (account.kind !== 'receivable' || account.status !== 'open' || account.canceledAt || account.environment !== env) {
            result = { ok: false, reason: 'not_found' }
            return d
          }
          if (account.currency !== input.currency) {
            result = { ok: false, reason: 'invalid_amount' }
            return d
          }
          const reservedMinor = d.paymentReservations
            .filter((r) => r.accountId === account.id && (r.state === 'HELD' || r.state === 'REQUIRES_REVIEW'))
            .reduce((s, r) => s + BigInt(r.amountMinor), 0n)
          const outstandingMinor = accountOutstandingMinor(account)
          if (outstandingMinor === null || amountMinor > availableForReservation(outstandingMinor, reservedMinor)) {
            result = { ok: false, reason: 'invalid_amount' }
            return d
          }
          const expires = Date.parse(input.expiresAt)
          if (!Number.isFinite(expires) || expires <= Date.now()) {
            result = { ok: false, reason: 'invalid_expiration' }
            return d
          }
          const intent: PaymentIntent = {
            intentId,
            organizationId: orgId,
            accountId: account.id,
            environment: env,
            chainId: cfg.chainId,
            token: cfg.usdcToken,
            gatewayWallet: cfg.gatewayWallet,
            beneficiary,
            amount: input.amount,
            ...(input.amountDecimal !== undefined ? { amountDecimal: input.amountDecimal } : {}),
            currency: input.currency,
            amountMinor: String(amountMinor),
            usdcMinor: input.usdcMinor,
            ...(input.rate !== undefined ? { rate: input.rate } : {}),
            ...(scopedKey ? { idempotencyKey: scopedKey } : {}),
            ...(input.checkoutToken ? { checkoutToken: input.checkoutToken } : {}),
            fingerprint,
            createdAt: now,
            expiresAt: input.expiresAt,
            state: 'CREATED',
            txHashes: [],
            history: [{ at: now, state: 'CREATED' }],
          }
          const reservation: PaymentReservation = {
            reservationId: uid(),
            intentId,
            accountId: account.id,
            organizationId: orgId,
            environment: env,
            currency: input.currency,
            amountMinor: String(amountMinor),
            state: 'HELD',
            createdAt: now,
          }
          result = { ok: true, intentId, configPending: !beneficiary }
          return { ...d, accounts, paymentIntents: [intent, ...d.paymentIntents], paymentReservations: [reservation, ...d.paymentReservations] }
        })
        return result
      },
      transitionPaymentIntent: (intentId, state, note) => {
        const cur = dataRef.current.paymentIntents.find((i) => i.intentId === intentId)
        if (!cur) return false
        // Contexto de evidência derivado de registros autoritativos (nunca recebido da interface).
        const attempts = dataRef.current.paymentAttempts.filter((a) => a.intentId === intentId)
        const ctx: IntentTransitionContext = {
          source: 'system',
          sameOrganization: cur.organizationId === dataRef.current.ledger.orgId,
          sameEnvironment: cur.environment === getNetwork(),
          expired: Date.parse(cur.expiresAt) <= Date.now(),
          hasActiveAttempt: attempts.some((a) => !['CANCELED', 'REVERTED', 'REQUIRES_REVIEW'].includes(a.state)),
          hasDepositHash: attempts.some((a) => !!a.depositTxHash),
          submissionUnresolved: attempts.some((a) => a.state === 'AMBIGUOUS' || (a.state === 'SUBMITTED' && !a.confirmedAt)),
          hasVerifiedReceipt: false, // verificador independente ainda não implementado
          hasVerifiedRevert: false,
          // Cancelamento/expiração só é seguro quando NENHUMA tentativa transmitiu (sem início de submissão/hash).
          safeCancellation: !attempts.some((a) => a.submissionStartedAt || a.depositTxHash || a.state === 'AMBIGUOUS' || a.state === 'REQUIRES_REVIEW'),
        }
        if (!authorizeIntentTransition(cur.state, state, ctx)) return false
        // Idempotência: repetir o mesmo estado não duplica histórico.
        if (cur.state === state) return true
        const now = new Date().toISOString()
        const releasing = TERMINAL_INTENT_STATES.includes(state)
        const releaseReservation = releasing && canReleaseReservation(attempts)
        set((d) => ({
          ...d,
          paymentIntents: d.paymentIntents.map((i) =>
            i.intentId === intentId ? { ...i, state, history: [...i.history, { at: now, state, ...(note ? { note } : {}) }] } : i,
          ),
          // Encerramento atômico: tentativas nunca transmitidas são canceladas; reserva é liberada (com motivo/timestamp).
          paymentAttempts: releasing
            ? d.paymentAttempts.map((a) =>
                a.intentId === intentId && !a.submissionStartedAt && !a.depositTxHash && ['CREATED', 'READY', 'APPROVAL_PENDING', 'AWAITING_SIGNATURE'].includes(a.state)
                  ? { ...a, state: 'CANCELED' as const, updatedAt: now, history: [...a.history, { eventId: uid(), at: now, from: a.state, to: 'CANCELED' as const, source: 'system' as const, reason: `intent_${state.toLowerCase()}` }] }
                  : a,
              )
            : d.paymentAttempts,
          paymentReservations: releaseReservation
            ? d.paymentReservations.map((r) =>
                r.intentId === intentId && r.state === 'HELD' ? { ...r, state: 'RELEASED' as const, releasedAt: now, releaseReason: state } : r,
              )
            : d.paymentReservations,
        }))
        return true
      },
      createPaymentAttempt: (intentId, payer = '') => {
        const intent = dataRef.current.paymentIntents.find((i) => i.intentId === intentId)
        if (!intent) return { ok: false, reason: 'not_found' }
        const env = getNetwork()
        // Isolamento operacional centralizado: organização + ambiente + chain id.
        if (!matchesIntentScope(intent, { organizationId: dataRef.current.ledger.orgId, environment: env })) return { ok: false, reason: 'scope' }
        // Intenção terminal/expirada não gera nova tentativa.
        if (intent.state === 'CANCELED' || intent.state === 'EXPIRED' || intent.state === 'FAILED') return { ok: false, reason: 'intent_terminal' }
        if (Date.parse(intent.expiresAt) <= Date.now()) return { ok: false, reason: 'intent_expired' }
        // Reserva existente e não liberada/consumida.
        const reservation = dataRef.current.paymentReservations.find((r) => r.intentId === intentId)
        if (!reservation || reservation.state === 'RELEASED' || reservation.state === 'CONSUMED') return { ok: false, reason: 'reservation_unavailable' }
        // Obrigação aberta e não cancelada.
        const account = dataRef.current.accounts.find((a) => a.id === intent.accountId)
        if (!account || account.status !== 'open' || account.canceledAt) return { ok: false, reason: 'obligation_unavailable' }
        // Configuração institucional ainda válida.
        const beneficiary = treasuryRecipientFor(dataRef.current.settings, env)
        if (!validateBeneficiary(beneficiary, env).ok) return { ok: false, reason: 'not_configured' }
        // Tentativa anterior não resolvida bloqueia nova tentativa.
        if (dataRef.current.paymentAttempts.some((a) => a.intentId === intentId && attemptBlocksRetry(a))) return { ok: false, reason: 'attempt_unresolved' }
        const attemptId = uid()
        const now = new Date().toISOString()
        const attempt: PaymentAttempt = {
          attemptId,
          intentId,
          organizationId: intent.organizationId,
          environment: env,
          chainId: intent.chainId,
          payer,
          beneficiary: intent.beneficiary,
          gatewayWallet: intent.gatewayWallet,
          token: intent.token,
          usdcMinor: intent.usdcMinor,
          state: 'CREATED',
          createdAt: now,
          updatedAt: now,
          history: [{ eventId: uid(), at: now, from: null, to: 'CREATED', source: 'system' }],
        }
        set((d) => ({ ...d, paymentAttempts: [attempt, ...d.paymentAttempts] }))
        return { ok: true, attemptId }
      },
      beginPaymentSubmission: (attemptId, payer) => {
        const attempt = dataRef.current.paymentAttempts.find((a) => a.attemptId === attemptId)
        if (!attempt) return { ok: false, reason: 'not_found' }
        if (!matchesIntentScope(attempt, { organizationId: dataRef.current.ledger.orgId, environment: getNetwork() })) return { ok: false, reason: 'scope' }
        // Pagador obrigatório no caminho executável.
        if (typeof payer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(payer)) return { ok: false, reason: 'invalid_payer' }
        // Apenas tentativas preparadas podem iniciar submissão.
        if (attempt.state !== 'CREATED' && attempt.state !== 'READY') return { ok: false, reason: 'invalid_attempt_state' }
        const intent = dataRef.current.paymentIntents.find((i) => i.intentId === attempt.intentId)
        if (!intent || Date.parse(intent.expiresAt) <= Date.now()) return { ok: false, reason: 'intent_expired' }
        const now = new Date().toISOString()
        // Persistir o início da submissão ANTES da chamada externa à carteira.
        set((d) => ({
          ...d,
          paymentAttempts: d.paymentAttempts.map((a) =>
            a.attemptId === attemptId
              ? { ...a, payer, submissionStartedAt: now, state: 'AWAITING_SIGNATURE' as const, updatedAt: now, history: [...a.history, { eventId: uid(), at: now, from: a.state, to: 'AWAITING_SIGNATURE' as const, source: 'system' as const }] }
              : a,
          ),
        }))
        return { ok: true }
      },
      registerDepositSubmission: (attemptId, txHash) => {
        const attempt = dataRef.current.paymentAttempts.find((a) => a.attemptId === attemptId)
        if (!attempt) return false
        let hash: string
        try {
          hash = normalizeTxHash(txHash)
        } catch {
          return false
        }
        // Isolamento operacional centralizado (organização + ambiente + chain id).
        if (!matchesIntentScope(attempt, { organizationId: dataRef.current.ledger.orgId, environment: getNetwork() })) return false
        // Hash imutável: repetição idempotente não sobrescreve nem duplica histórico.
        if (attempt.depositTxHash) {
          return attempt.depositTxHash.toLowerCase() === hash
        }
        // Exige submissão iniciada (AWAITING_SIGNATURE) ou recuperação ambígua; nunca sobrescreve hash diferente.
        if (attempt.state !== 'AWAITING_SIGNATURE' && attempt.state !== 'AMBIGUOUS') return false
        if (!attempt.submissionStartedAt) return false
        // Hash não pode ser reutilizado entre tentativas.
        const reused = dataRef.current.paymentAttempts.some((a) => a.attemptId !== attemptId && a.depositTxHash === hash)
        if (reused) return false
        set((d) => ({
          ...d,
          paymentAttempts: d.paymentAttempts.map((a) =>
            a.attemptId === attemptId
              ? { ...a, depositTxHash: hash, state: 'SUBMITTED' as const, submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [...a.history, { eventId: uid(), at: new Date().toISOString(), from: a.state, to: 'SUBMITTED' as const, source: 'user' as const }] }
              : a,
          ),
        }))
        return true
      },
      markAttemptAmbiguous: (attemptId, reason) => {
        const attempt = dataRef.current.paymentAttempts.find((a) => a.attemptId === attemptId)
        if (!attempt) return false
        if (!matchesIntentScope(attempt, { organizationId: dataRef.current.ledger.orgId, environment: getNetwork() })) return false
        if (attempt.state === 'CONFIRMED' || attempt.state === 'REVERTED') return false
        set((d) => ({
          ...d,
          paymentAttempts: d.paymentAttempts.map((a) =>
            a.attemptId === attemptId
              ? { ...a, state: 'AMBIGUOUS', updatedAt: new Date().toISOString(), history: [...a.history, { eventId: uid(), at: new Date().toISOString(), from: a.state, to: 'AMBIGUOUS', source: 'system', ...(reason ? { reason } : {}) }] }
              : a,
          ),
        }))
        return true
      },
      verifyAndSettle: async (opId) => {
        const op = data.treasuryOps.find((o) => o.id === opId)
        if (!op) return { ok: false, error: 'not_found' as const }
        // Estados terminais: idempotente, não re-verifica nem re-baixa.
        if (op.status === 'confirmed' || op.status === 'failed') return { ok: true, status: op.status }
        // Single-flight: evita verificações/baixas concorrentes para a mesma operação.
        if (inflight.has(opId)) return { ok: true, status: op.status ?? 'pending' }
        inflight.add(opId)
        try {
          const { status } = await reconcileTreasuryOp(op)
          const finalStatus: TreasuryOpStatus = status
          apply((d) => {
            const cur = d.treasuryOps.find((o) => o.id === opId)
            if (!cur || cur.status === 'confirmed' || cur.status === 'failed') return d
            if (finalStatus !== 'confirmed') {
              return { ...d, treasuryOps: d.treasuryOps.map((o) => (o.id === opId ? { ...o, status: finalStatus, accountingStatus: 'unallocated' as const } : o)) }
            }
            // Confirmado on-chain: aplica a alocação contábil (ou só confirma o crédito, para depósito).
            return applyConfirmedAccounting(d, opId)
          }, false)
          return { ok: true, status: finalStatus }
        } finally {
          inflight.delete(opId)
        }
      },
      reconcileAccounting: (opId) => {
        const op = data.treasuryOps.find((o) => o.id === opId)
        if (!op) return { ok: false, error: 'not_found' as const }
        if (op.status !== 'confirmed') return { ok: false, error: 'not_confirmed' as const }
        // Já liquidado (total ou parcial): idempotente, não realoca.
        if (op.accountingStatus === 'settled' || op.accountingStatus === 'partially_settled') return { ok: true, status: op.accountingStatus }
        if (inflight.has(opId)) return { ok: true, status: op.accountingStatus ?? 'requires_review' }
        inflight.add(opId)
        try {
          // Resultado determinístico a partir do snapshot atual (nunca reenvia transação).
          const preview = applyConfirmedAccounting(data, opId)
          const outcome: AccountingStatus = preview.treasuryOps.find((o) => o.id === opId)?.accountingStatus ?? 'requires_review'
          apply((d) => {
            const cur = d.treasuryOps.find((o) => o.id === opId)
            if (!cur || cur.status !== 'confirmed') return d
            if (cur.accountingStatus === 'settled' || cur.accountingStatus === 'partially_settled') return d
            return applyConfirmedAccounting(d, opId)
          }, false)
          return { ok: true, status: outcome }
        } finally {
          inflight.delete(opId)
        }
      },
      updateSettings: (patch) => set((d) => ({ ...d, settings: { ...d.settings, ...patch } })),
      importData: (next) => undoable(() => next, t('Backup restaurado.', 'Backup restored.'), false),
      resetAll: () => undoable(() => emptyData(), t('Todos os dados foram apagados.', 'All data was deleted.'), false),
      clearSandboxData: () => {
        if (getNetwork() !== 'testnet') {
          toast.error(t('A limpeza de dados de teste só está disponível na Testnet (Sandbox).', 'Test data clearing is only available on Testnet (Sandbox).'))
          return
        }
        undoable(
          (d) => {
            const keep = <T extends { environment?: Environment }>(list: T[]): T[] => list.filter((x) => x.environment !== 'testnet')
            // Operações Testnet REAIS (transmitidas ou ambíguas) e seus registros relacionados são preservadas,
            // preservando a integridade referencial obrigação → intenção → tentativa → reserva.
            const realAttemptIds = new Set(
              d.paymentAttempts
                .filter((a) => a.environment === 'testnet' && (a.depositTxHash || a.submissionStartedAt || ['SUBMITTED', 'AMBIGUOUS', 'CONFIRMED', 'REVERTED'].includes(a.state)))
                .map((a) => a.attemptId),
            )
            const realIntentIds = new Set(d.paymentAttempts.filter((a) => realAttemptIds.has(a.attemptId)).map((a) => a.intentId))
            const realAccountIds = new Set(d.paymentIntents.filter((i) => realIntentIds.has(i.intentId)).map((i) => i.accountId))
            // Preserva Mainnet, unassigned, configurações compartilhadas, tesouraria e o Ledger (histórico global).
            return {
              ...d,
              products: keep(d.products),
              moves: keep(d.moves),
              contacts: keep(d.contacts),
              employees: keep(d.employees),
              sales: keep(d.sales),
              purchases: keep(d.purchases),
              shipments: keep(d.shipments),
              carriers: keep(d.carriers),
              returns: keep(d.returns),
              receipts: keep(d.receipts),
              paymentIntents: d.paymentIntents.filter((i) => i.environment !== 'testnet' || realIntentIds.has(i.intentId)),
              paymentAttempts: d.paymentAttempts.filter((a) => a.environment !== 'testnet' || realAttemptIds.has(a.attemptId)),
              paymentReservations: d.paymentReservations.filter((r) => r.environment !== 'testnet' || realIntentIds.has(r.intentId)),
              accounts: d.accounts.filter((a) => a.environment !== 'testnet' || realAccountIds.has(a.id)),
              entries: keep(d.entries),
            }
          },
          t('Dados de teste da Testnet removidos.', 'Testnet test data cleared.'),
        )
      },
      loadSandboxDemo: () => {
        if (getNetwork() !== 'testnet') {
          toast.error(t('Os dados demonstrativos do Sandbox só podem ser carregados na Testnet.', 'Sandbox demo data can only be loaded on Testnet.'))
          return { ok: false, reason: 'wrong_environment' }
        }
        // Prefixo único por chamada: evita colisão de IDs entre cargas consecutivas.
        const prefix = `demo-${uid()}-`
        const demo = buildDemoData(dataRef.current.settings.currency, prefix)
        // Adiciona os dados demonstrativos SOMENTE à Testnet; preserva Mainnet, unassigned, configurações e o Ledger.
        undoable(
          (d) => {
            const tag = <T extends { environment?: Environment }>(list: T[]): T[] => list.map((x) => ({ ...x, environment: 'testnet' as const }))
            return {
              ...d,
              products: [...tag(demo.products), ...d.products],
              contacts: [...tag(demo.contacts), ...d.contacts],
              employees: [...tag(demo.employees), ...d.employees],
              sales: [...tag(demo.sales), ...d.sales],
              entries: [...tag(demo.entries), ...d.entries],
              accounts: [...tag(demo.accounts), ...d.accounts],
              shipments: [...tag(demo.shipments), ...d.shipments],
              carriers: [...tag(demo.carriers), ...d.carriers],
              returns: [...tag(demo.returns), ...d.returns],
              purchases: [...tag(demo.purchases), ...d.purchases],
              receipts: [...tag(demo.receipts), ...d.receipts],
              moves: [...tag(demo.moves), ...d.moves],
            }
          },
          t('Dados demonstrativos carregados na Testnet.', 'Demo data loaded into Testnet.'),
          false,
        )
        return { ok: true }
      },
    }
  }, [data])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore deve ser usado dentro de StoreProvider')
  return ctx
}
