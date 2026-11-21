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
  /** Link do explorer da transação em USDC que liquidou a conta. */
  treasuryTx?: string
  employeeId?: string
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
}

export type CurrencyCode = 'BRL' | 'USD' | 'EUR'

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

export type ShipmentEventKind = 'created' | 'status' | 'tracking' | 'edit' | 'document'

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
  /** Campos alterados (kind 'edit') ou tipo do documento (kind 'document'). */
  fields?: string[]
  /** Origem da informação. Só 'manual' existe; integrações com transportadoras virão depois. */
  source: 'manual'
  actor: string
}

export interface ShipmentOrderRef {
  kind: 'sale' | 'purchase'
  /** Para vendas, o id da venda (validado). Para compras, só uma referência de texto. */
  id?: string
  label: string
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
  createdAt: string
  updatedAt: string
}

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
  settings: Settings
}

export const CAT_SALES = 'Vendas'
export const CAT_PURCHASE = 'Compra de mercadorias'
export const CAT_PAYROLL = 'Folha de pagamento'
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
