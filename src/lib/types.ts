export interface Product {
  id: string
  sku: string
  name: string
  category: string
  unit: string
  cost: number
  price: number
  stock: number
  minStock: number
}

export interface StockMove {
  id: string
  productId: string
  kind: 'in' | 'out' | 'adjust'
  qty: number
  date: string
  note: string
}

export interface Contact {
  id: string
  kind: 'customer' | 'supplier'
  name: string
  doc: string
  email: string
  phone: string
  wallet: string
}

export interface Entry {
  id: string
  date: string
  type: 'in' | 'out'
  category: string
  description: string
  amount: number
}

export type AccountSource = 'manual' | 'sale' | 'purchase' | 'payroll'

/** Ambiente financeiro de ORIGEM de uma obrigação. `unassigned` = legado sem classificação. */
export type AccountEnvironment = NetworkId | 'unassigned'

/** Liquidação parcial (ou total) de uma conta. Várias liquidações por conta são permitidas. */
export interface AccountSettlement {
  id: string
  /** Sequência da liquidação na conta (1, 2, ...): garante idempotência no razão. */
  sequence: number
  amount: number
  date: string
  /** Link do explorer da transação em USDC que liquidou (quando via tesouraria). */
  treasuryTx?: string
  /** True quando a liquidação já foi verificada on-chain (não nasce pendente no razão). */
  verified?: boolean
}

export interface Account {
  id: string
  kind: 'payable' | 'receivable'
  description: string
  contactId?: string
  contactName: string
  amount: number
  dueDate: string
  category: string
  status: 'open' | 'paid'
  paidAt?: string
  source: AccountSource
  /** Moeda da obrigação. Ausente em registros legados (tratada como desconhecida, nunca adivinhada). */
  currency?: CurrencyCode
  /** Ambiente financeiro de ORIGEM da obrigação (mainnet/testnet/unassigned). */
  environment?: AccountEnvironment
  /** Ambiente escolhido EXPLICITAMENTE para pagar esta obrigação. Ausente = não preparada. */
  paymentNetwork?: NetworkId
  /** Cancelamento lógico (auditável). A obrigação deixa de ser executável sem ser apagada. */
  canceledAt?: string
  /** Link do explorer da transação em USDC que liquidou a conta. */
  treasuryTx?: string
  employeeId?: string
  /** Liquidações parciais. Vazio/ausente = nada pago (comportamento legado preservado). */
  settlements?: AccountSettlement[]
}

export type PayMethod = 'dinheiro' | 'pix' | 'cartao' | 'usdc' | 'prazo'

export interface SaleItem {
  productId: string
  name: string
  qty: number
  price: number
  cost: number
}

export interface Sale {
  id: string
  date: string
  customerId?: string
  customerName: string
  items: SaleItem[]
  total: number
  cogs: number
  method: PayMethod
  accountId?: string
  /** Data do cancelamento (YYYY-MM-DD). Vendas canceladas não contam nos indicadores. */
  canceledAt?: string
}

export interface Employee {
  id: string
  name: string
  role: string
  salary: number
  wallet: string
  admission: string
  active: boolean
}

export interface TreasuryOp {
  id: string
  date: string
  kind: 'deposit' | 'spend'
  chain: string
  destChain?: string
  amount: string
  txHash?: string
  explorerUrl?: string
  recipient?: string
  accountId?: string
  note: string
  /** Carteira conectada (origem dos fundos). Usada na verificação de depósito. */
  wallet?: string
  /** Identificador da transferência no Gateway (para consulta de status via provider). */
  transferId?: string
  /** Estado de liquidação. Ausente (registros antigos) = legado/desconhecido (tratar como pendente). */
  status?: TreasuryOpStatus
  /** Estado contábil (separado do on-chain): settled / partially_settled / requires_review / unallocated. */
  accountingStatus?: AccountingStatus
  /** Valor (na moeda da conta) efetivamente alocado a esta obrigação. */
  allocatedAmount?: number
  /** Excesso não alocado (na moeda da conta) quando o pagamento supera o saldo em aberto. */
  unallocatedAmount?: number
  /** Quando a liquidação foi confirmada (verificada on-chain). */
  settledAt?: string
  /** Id da liquidação (AccountSettlement) criada ao confirmar. */
  settlementId?: string
  /** Motivo de revisão/falha (ex.: fx_required, no_evidence, destination_unverified). */
  reviewReason?: string
}

/** USDC é uma moeda do app como as outras: nunca é tratado como equivalente de USD (não há conversão automática). */
export type CurrencyCode = 'USDC' | 'BRL' | 'USD' | 'EUR'

export interface PaymentRequest {
  id: string
  accountId: string
  description: string
  /** Valor da conta na moeda do negócio, no momento da cobrança. */
  fiatAmount: number
  /** Valor exato em USDC (inclui uma pequena marca única para identificar o pagamento). */
  amount: string
  chainKey: string
  chainId: number
  /** Carteira que recebe. */
  recipient: string
  createdAt: string
  /** Bloco da rede quando a cobrança foi criada; a conciliação começa daqui. */
  fromBlock: string
  scannedTo?: string
  status: 'open' | 'paid' | 'canceled'
  txHash?: string
  payer?: string
  explorerUrl?: string
  paidAt?: string
}

export interface Settings {
  company: string
  branch: string
  owner: string
  currency: CurrencyCode
  /** Quantas unidades da moeda do negócio valem 1 USDC. Definido pelo usuário. */
  usdcRate: number | null
  /** Acima deste total em USDC, a tesouraria exige uma confirmação extra. */
  approvalLimit: number | null
}

// ---------- Logística (fase 1A: remessas e rastreamento manual) ----------

export type ShipmentDirection = 'inbound' | 'outbound' | 'transfer'

export type ShipmentStatus =
  | 'draft'
  | 'ready'
  | 'dispatched'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'delayed'
  | 'exception'

export interface ShipmentParty {
  /** Nome do local ou da empresa (ex.: Armazém central). */
  name: string
  city: string
  /** País (nome ou código ISO). Texto livre nesta fase. */
  country: string
}

export interface ShipmentPackage {
  id: string
  weightKg: number
  lengthCm: number
  widthCm: number
  heightCm: number
}

export interface ShipmentItem {
  /** Código HS/NCM do item (remessas internacionais). */
  hsCode?: string
  id: string
  /** Produto do estoque, quando houver. O estoque NÃO é alterado por remessas nesta fase. */
  productId?: string
  name: string
  sku: string
  qty: number
}

export type ShipmentDocumentType = 'invoice' | 'packing_list' | 'bill_of_lading' | 'proof_of_delivery' | 'other'

/** Referência a um documento de apoio (número e tipo). Arquivos ainda não são armazenados. */
export interface ShipmentDocument {
  id: string
  type: ShipmentDocumentType
  reference: string
  addedAt: string
  addedBy: string
}

export type ShipmentEventKind = 'created' | 'status' | 'tracking' | 'edit' | 'document' | 'fulfillment' | 'receipt' | 'freight'

/** Registro de auditoria. Eventos nunca são editados nem apagados. */
export interface ShipmentEvent {
  id: string
  kind: ShipmentEventKind
  /** Quando o registro foi feito no sistema (ISO). */
  at: string
  /** Quando o fato ocorreu, informado pelo usuário (ISO). Usado em eventos de rastreio. */
  occurredAt?: string
  fromStatus?: ShipmentStatus
  toStatus?: ShipmentStatus
  location?: string
  description: string
  /** Campos alterados (kind 'edit'), tipo do documento (kind 'document'), etapa (kind 'fulfillment': pick, pack, pod, close) ou modo de estoque (kind 'receipt'). */
  fields?: string[]
  /** Origem da informação: 'manual' (digitada por uma pessoa) ou 'carrier' (webhook assinado e verificado de uma transportadora). Hoje só existem eventos manuais. */
  source: 'manual' | 'carrier'
  /** Identificador do evento na transportadora (idempotência dos eventos 'carrier'). */
  externalId?: string
  actor: string
}

/** Hoje só existe o adaptador manual (modelo de URL de rastreio). Integrações reais com transportadoras entram como novos adaptadores. */
export type CarrierAdapterId = 'manual'

export interface CarrierServiceLevel {
  id: string
  name: string
  minDays: number
  maxDays: number
}

/** Estrutura de custo informada pelo usuário. Serve só para estimar o frete, nunca é uma cotação da transportadora. */
export interface CarrierCostStructure {
  currency: CurrencyCode
  baseFee: number
  perKg: number
}

export interface Carrier {
  id: string
  orgId: string
  name: string
  adapter: CarrierAdapterId
  /** Países atendidos (código ou nome, como digitado). */
  countries: string[]
  methods: string[]
  contactName: string
  email: string
  phone: string
  /** Modelo de URL de rastreio com {tracking}. Vazio = sem link. */
  trackingUrlTemplate: string
  serviceLevels: CarrierServiceLevel[]
  cost?: CarrierCostStructure
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface FreightFee {
  id: string
  label: string
  amount: number
}

/**
 * Detalhes de custo da remessa. O frete base continua em `Shipment.freightCost`; o custo total é
 * frete + seguro + taxas. `postedAccountId` liga o custo à conta a pagar já criada (evita lançar duas vezes).
 */
export interface FreightDetail {
  estimated?: number
  insurance: number
  fees: FreightFee[]
  postedAccountId?: string
  postedAt?: string
}

export type Incoterm = 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP'

/** Dados de remessa internacional informados manualmente. Nada aqui é calculado nem atesta conformidade aduaneira. */
export interface InternationalInfo {
  incoterm?: Incoterm
  customsRef: string
  importExportRef: string
  dutiesAmount: number
  taxesAmount: number
}

export interface ShipmentOrderRef {
  kind: 'sale' | 'purchase'
  /** Id da venda ou da compra registrada (validado). Sem id, é só uma referência de texto. */
  id?: string
  label: string
}

/** Item de uma compra registrada. */
export interface PurchaseRefItem {
  productId: string
  name: string
  sku: string
  qty: number
  cost: number
}

/**
 * Registro leve de cada compra feita na aba Compras (a partir da fase 1B).
 * `stockPosted` diz se o estoque já foi somado: true no fluxo padrão (a compra soma na hora) e false quando a compra
 * aguarda o recebimento físico. Garante que o estoque seja somado uma única vez, no registro ou no recebimento.
 */
export interface PurchaseRef {
  id: string
  date: string
  supplierId?: string
  supplierName: string
  items: PurchaseRefItem[]
  total: number
  stockPosted: boolean
  /** Recebimento que somou o estoque (só quando a compra aguardava recebimento). */
  receiptId?: string
  createdAt: string
}

/** Expedição de uma remessa de saída: separação, embalagem, conferência de estoque, comprovante e fechamento. */
export interface Fulfillment {
  /** Quantidade separada por item da remessa (id do item → quantidade). */
  picks: Record<string, number>
  packedAt?: string
  packedBy?: string
  /**
   * Como o estoque foi validado. 'sale_deducted': a venda ligada já baixou o estoque, nada é baixado de novo.
   * 'on_hand': remessa sem venda, apenas conferido que há saldo (sem baixa).
   */
  stockCheck?: { mode: 'sale_deducted' | 'on_hand'; checkedAt: string }
  pod?: { receivedBy: string; reference: string; note: string; at: string; recordedBy: string }
  closedAt?: string
}

export type ReturnStatus = 'requested' | 'authorized' | 'rejected' | 'inspected' | 'closed' | 'cancelled'
export type ReturnCondition = 'good' | 'damaged' | 'defective'
export type ReturnDecision = 'restock' | 'discard' | 'return_to_supplier'

export interface ReturnLine {
  /** Item da remessa de saída original. */
  itemId: string
  productId?: string
  name: string
  sku: string
  qty: number
}

export interface ReturnInspectionLine {
  itemId: string
  receivedQty: number
  condition: ReturnCondition
  /** Só 'restock' devolve ao estoque, e só para itens em bom estado. */
  decision?: ReturnDecision
}

export interface ReturnEvent {
  id: string
  at: string
  actor: string
  action: 'requested' | 'authorized' | 'rejected' | 'shipment_created' | 'inspected' | 'closed' | 'cancelled'
  note: string
}

/** Autorização de devolução (RMA): logística reversa de uma remessa de saída já entregue. */
export interface ReturnAuthorization {
  id: string
  orgId: string
  shipmentId: string
  saleId?: string
  lines: ReturnLine[]
  reason: string
  status: ReturnStatus
  returnShipmentId?: string
  inspection?: { lines: ReturnInspectionLine[]; notes: string; at: string; by: string; restocked: { productId: string; qty: number }[] }
  resolution?: { kind: 'refund' | 'replacement' | 'none'; reference: string; note: string; at: string; by: string }
  events: ReturnEvent[]
  createdAt: string
  updatedAt: string
}

export type ReceiptStockMode = 'posted' | 'already_counted'

export interface ReceiptLine {
  itemId: string
  productId?: string
  name: string
  sku: string
  expectedQty: number
  receivedQty: number
  damagedQty: number
  /** Recebido menos danificado: é o que entra no estoque quando o modo é 'posted'. */
  acceptedQty: number
  discrepancy: 'none' | 'short' | 'over' | 'damaged'
}

export interface GoodsReceipt {
  id: string
  orgId: string
  shipmentId: string
  purchaseId?: string
  lines: ReceiptLine[]
  stockMode: ReceiptStockMode
  notes: string
  receivedAt: string
  receivedBy: string
}

export interface Shipment {
  /** Código único e legível (SHP-0001). */
  id: string
  /** Referência de organização, preparada para multiempresa. */
  orgId: string
  direction: ShipmentDirection
  status: ShipmentStatus
  orderRef?: ShipmentOrderRef
  origin: ShipmentParty
  destination: ShipmentParty
  senderName: string
  recipientName: string
  carrier: string
  trackingNumber: string
  method: string
  packages: ShipmentPackage[]
  items: ShipmentItem[]
  declaredValue: number
  currency: CurrencyCode
  freightCost: number
  /** Data estimada de entrega (YYYY-MM-DD). */
  estimatedDelivery?: string
  /** Data real de entrega (YYYY-MM-DD). */
  deliveredAt?: string
  documents: ShipmentDocument[]
  events: ShipmentEvent[]
  carrierId?: string
  freight?: FreightDetail
  international?: InternationalInfo
  /** Devolução (RMA) à qual esta remessa de retorno pertence. Ela não passa pelo recebimento comum. */
  returnId?: string
  /** Expedição (só remessas de saída com itens do estoque). */
  fulfillment?: Fulfillment
  /** Recebimento de mercadorias (só remessas de entrada). Impede receber duas vezes. */
  receiptId?: string
  createdAt: string
  updatedAt: string
}

import type { LedgerState } from './accounting/types'
import type { AccountingStatus, TreasuryOpStatus } from './accounting/settlement'
import type { NetworkId } from './network'

export interface AppData {
  products: Product[]
  moves: StockMove[]
  contacts: Contact[]
  entries: Entry[]
  accounts: Account[]
  sales: Sale[]
  employees: Employee[]
  treasuryOps: TreasuryOp[]
  requests: PaymentRequest[]
  shipments: Shipment[]
  carriers: Carrier[]
  returns: ReturnAuthorization[]
  purchases: PurchaseRef[]
  receipts: GoodsReceipt[]
  /** Razão contábil (motor de partida dobrada). Ver docs/accounting-engine.md. */
  ledger: LedgerState
  settings: Settings
}

export const CAT_SALES = 'Vendas'
export const CAT_PURCHASE = 'Compra de mercadorias'
export const CAT_PAYROLL = 'Folha de pagamento'
export const CAT_LOGISTICS = 'Logística'
export const INCOME_CATEGORIES = ['Serviços prestados', 'Outras receitas', 'Rendimentos'] as const
export const EXPENSE_CATEGORIES = [
  CAT_PURCHASE,
  CAT_PAYROLL,
  'Aluguel',
  'Impostos',
  'Marketing',
  'Serviços e utilidades',
  'Logística',
  'Outras despesas',
] as const
