/** Ambiente operacional/financeiro de origem de um registro. `unassigned` = legado sem classificação. */
export type Environment = NetworkId | 'unassigned'

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
  /** Ambiente de origem do produto. Imutável após criação (salvo migração auditada). */
  environment?: Environment
  // --- Campos opcionais (fase INV-1.0) — retrocompatíveis ---
  /** Marca. */
  brand?: string
  /** Fabricante. */
  manufacturer?: string
  /** Subcategoria. */
  subcategory?: string
  /** Código de barras GTIN/EAN/UPC. */
  barcode?: string
  /** Descrição. */
  description?: string
  /** Status. Ausente = ativo (comportamento legado). */
  active?: boolean
  /** Custo de referência comercial (≠ `cost`, que é o custo médio contábil). */
  referenceCost?: number
  /** Preço de atacado (opcional). */
  wholesalePrice?: number
  /** Estoque máximo (referência cadastral). */
  maxStock?: number
  /** Ponto de reposição. */
  reorderPoint?: number
  /** Localização no depósito. */
  location?: string
  /** Unidade de armazenamento (ex.: pallet, caixa). */
  storageUnit?: string
  /** Fornecedor principal (ID no mesmo ambiente). */
  primarySupplierId?: string
  /** Fornecedores alternativos (IDs no mesmo ambiente). */
  alternateSupplierIds?: string[]
  /** Código do produto no fornecedor. */
  supplierSku?: string
  /** Preço de referência de aquisição (≠ custo efetivo da compra). */
  purchasePrice?: number
  /** Prazo estimado de entrega (dias). */
  leadTimeDays?: number
  /** Quantidade mínima do pedido. */
  minOrderQty?: number
  // --- Logística (cadastral) ---
  netWeight?: number
  grossWeight?: number
  height?: number
  width?: number
  depth?: number
  unitsPerPackage?: number
  storageConditions?: string
  // --- Fiscal (cadastral, internacional) ---
  originCountry?: string
  hsCode?: string
  ncm?: string
  taxRef?: string
}

export interface StockMove {
  id: string
  productId: string
  kind: 'in' | 'out' | 'adjust'
  qty: number
  date: string
  note: string
  /** Ambiente da movimentação. Deve coincidir com o ambiente do produto. */
  environment?: Environment
}

/** Tipo de pessoa (física ou jurídica) — define a máscara/validação de CPF/CNPJ. */
export type PersonType = 'fisica' | 'juridica'

export interface ContactAddress {
  cep: string
  street: string
  number: string
  complement: string
  neighborhood: string
  city: string
  state: string
  country: string
}

export interface Contact {
  id: string
  kind: 'customer' | 'supplier'
  name: string
  doc: string
  email: string
  phone: string
  wallet: string
  /** Ambiente operacional do cadastro. */
  environment?: Environment
  // --- Campos opcionais (fase UI 2.0) ---
  /** Tipo de pessoa (física/jurídica). Ausente = legado (máscara não aplicada). */
  personType?: PersonType
  /** Razão social (pessoa jurídica). */
  legalName?: string
  /** Código interno de referência. */
  internalCode?: string
  /** Telefone secundário. */
  secondaryPhone?: string
  /** Nome da pessoa de contato. */
  contactPersonName?: string
  /** Cargo da pessoa de contato. */
  contactPersonRole?: string
  /** Endereço (preenchimento manual). */
  address?: ContactAddress
  /** Observações internas. */
  notes?: string
  /** Condições de pagamento (texto livre). */
  paymentTerms?: string
  /** Status ativo/inativo. Ausente = ativo (comportamento legado). */
  active?: boolean
}

export interface Entry {
  id: string
  date: string
  type: 'in' | 'out'
  category: string
  description: string
  amount: number
  /** Ambiente financeiro de ORIGEM do lançamento. `unassigned`/ausente = legado sem classificação. */
  environment?: Environment
  /** Tipo da operação de origem (vínculo inequívoco para recuperação do ambiente). */
  sourceKind?: 'sale' | 'account' | 'purchase'
  /** ID da operação de origem (venda/conta/compra), quando aplicável. */
  sourceId?: string
  /** ID da liquidação individual (vínculo inequívoco quando há múltiplas liquidações na mesma conta). */
  settlementId?: string
}

export type AccountSource = 'manual' | 'sale' | 'purchase' | 'payroll'

/** Ambiente financeiro de ORIGEM de uma obrigação. `unassigned` = legado sem classificação. */
export type AccountEnvironment = Environment

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
  /** Vínculo determinístico com a operação de origem (sale/purchase/payroll). Ausente em registros legados. */
  sourceId?: string
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
  // --- Campos opcionais (fase UI 2.0) ---
  /** Número do documento ou referência. */
  documentNumber?: string
  /** Data de emissão (YYYY-MM-DD). */
  issuedAt?: string
  /** Competência (mês/ano, ex.: "2026-11"). */
  competence?: string
  /** Observações internas. */
  notes?: string
  /** Referência externa (ex.: número no sistema de origem). */
  externalRef?: string
  /** Indicador INFORMATIVO de recorrência — não gera agendamento automático. */
  recurring?: boolean
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
  /** Ambiente de origem da venda. Imutável após criação. */
  environment?: Environment
  /** Intenção estável da operação (idempotência). Reenvios com a mesma chave não duplicam. */
  intentId?: string
}

export interface Employee {
  id: string
  name: string
  role: string
  salary: number
  wallet: string
  admission: string
  active: boolean
  /** Ambiente operacional do funcionário. */
  environment?: Environment
  // --- Campos opcionais (fase UI 2.0) ---
  /** Matrícula interna. */
  registration?: string
  /** Departamento. */
  department?: string
  /** Email profissional. */
  email?: string
  /** Telefone. */
  phone?: string
  /** Tipo de vínculo (texto livre: CLT, PJ, estágio…). */
  contractType?: string
  /** Centro de custo (referência informativa, sem vínculo contábil nesta fase). */
  costCenter?: string
  /** Observações administrativas. */
  notes?: string
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

// ---------- Payment Intent (FIN-04.1B.2.2: checkout nativo Circle Gateway) ----------

export type PaymentIntentState =
  | 'CREATED'
  | 'AWAITING_WALLET'
  | 'AWAITING_APPROVAL'
  | 'APPROVAL_PENDING'
  | 'READY_TO_DEPOSIT'
  | 'AWAITING_SIGNATURE'
  | 'SUBMITTED'
  | 'ONCHAIN_CONFIRMED'
  | 'AWAITING_GATEWAY_VERIFICATION'
  | 'EXPIRED'
  | 'FAILED'
  | 'CANCELED'
  | 'REQUIRES_REVIEW'

export interface PaymentIntentEvent {
  at: string
  state: PaymentIntentState
  note?: string
}

/**
 * Intenção comercial de pagamento USDC via Gateway. Os campos financeiros fundamentais são IMUTÁVEIS
 * após a emissão (valor, beneficiário, ambiente, token); alterações exigem uma nova intenção.
 */
export interface PaymentIntent {
  intentId: string
  organizationId: string
  saleId?: string
  accountId: string
  customerId?: string
  environment: Environment
  chainId: number
  token: string
  gatewayWallet: string
  beneficiary: string
  /** Valor na moeda contábil. */
  amount: number
  currency: CurrencyCode
  /** Valor USDC em unidades mínimas (string BigInt). */
  usdcMinor: string
  /** Cotação usada na conversão (quando a moeda contábil não é USDC). */
  rate?: number
  createdAt: string
  expiresAt: string
  state: PaymentIntentState
  txHashes: string[]
  history: PaymentIntentEvent[]
  /** Chave de idempotência (opcional): a mesma chave retorna a intenção existente. */
  idempotencyKey?: string
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
  /** Endereço institucional da Treasury que RECEBE os pagamentos comerciais (não a carteira do operador). */
  treasuryRecipient?: string
  /** Beneficiário institucional POR AMBIENTE (substitui progressivamente o campo global). */
  treasuryRecipients?: Partial<Record<NetworkId, string>>
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
  /** Ambiente operacional da transportadora. */
  environment?: Environment
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
  /** Quantidade aceita acumulada (soma dos recebimentos parciais). Ausente = 0/legado. */
  receivedQty?: number
  /** Intenção estável da operação (idempotência). Reenvios com a mesma chave não duplicam. */
  intentId?: string
  createdAt: string
  /** Ambiente de origem da compra. Imutável após criação. */
  environment?: Environment
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
  /** Ambiente de origem da devolução. Imutável após criação. */
  environment?: Environment
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
  /** Ambiente de origem do recebimento. Imutável após criação. */
  environment?: Environment
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
  /** Ambiente de origem da remessa. Imutável após criação. */
  environment?: Environment
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
  /** Intenções de pagamento USDC nativas (checkout Circle Gateway). */
  paymentIntents: PaymentIntent[]
  /** Razão contábil (motor de partida dobrada). Ver docs/accounting-engine.md. */
  ledger: LedgerState
  settings: Settings
}

export const CAT_SALES = 'Vendas'
export const CAT_PURCHASE = 'Compra de mercadorias'
export const CAT_PAYROLL = 'Folha de pagamento'
export const CAT_LOGISTICS = 'Logística'
export const INCOME_CATEGORIES = [
  'Serviços prestados',
  'Outras receitas',
  'Rendimentos',
  'Venda de mercadorias',
  'Venda de produtos',
  'Consultoria',
  'Assinaturas e mensalidades',
  'Comissões',
  'Licenciamento e royalties',
  'Contratos recorrentes',
  'Juros recebidos',
  'Multas recebidas',
  'Descontos financeiros obtidos',
  'Aluguéis recebidos',
  'Indenizações',
] as const
export const EXPENSE_CATEGORIES = [
  CAT_PURCHASE,
  CAT_PAYROLL,
  'Aluguel',
  'Impostos',
  'Marketing',
  'Serviços e utilidades',
  'Logística',
  'Outras despesas',
  'Matéria-prima',
  'Insumos',
  'Embalagens',
  'Fretes',
  'Manutenção',
  'Serviços terceirizados',
  'Energia elétrica',
  'Água e saneamento',
  'Internet e telefonia',
  'Software e assinaturas',
  'Material de escritório',
  'Marketing e publicidade',
  'Consultoria e assessoria',
  'Seguros',
  'Viagens e deslocamentos',
  'Benefícios',
  'Encargos trabalhistas',
  'Treinamento',
  'Reembolsos a funcionários',
  'Impostos e tributos',
  'Taxas bancárias',
  'Juros',
  'Multas',
  'Tarifas financeiras',
  'Taxas de transação',
  'Outras obrigações',
] as const
