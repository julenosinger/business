// Regras de logística (fase 1A). Módulo puro: sem React, DOM ou i18n, para ser testável e reaproveitável por um backend.
// Todas as operações recebem o estado (AppData) e devolvem o próximo estado ou uma lista de erros. Nada é alterado aqui no estoque
// nem no financeiro: remessas só registram a movimentação física e a trilha de auditoria.
import type {
  AppData,
  CurrencyCode,
  Shipment,
  ShipmentDirection,
  ShipmentDocument,
  ShipmentDocumentType,
  ShipmentEvent,
  ShipmentItem,
  ShipmentOrderRef,
  ShipmentPackage,
  ShipmentParty,
  ShipmentStatus,
} from './types'
import { checkOrderCoverage, checkOutboundStock, allPicked, needsFulfillment } from './stock-checks'

export const DEFAULT_ORG = 'local'

export const DIRECTIONS: readonly ShipmentDirection[] = ['inbound', 'outbound', 'transfer']
export const CURRENCIES: readonly CurrencyCode[] = ['USDC', 'BRL', 'USD', 'EUR']
export const DOCUMENT_TYPES: readonly ShipmentDocumentType[] = ['invoice', 'packing_list', 'bill_of_lading', 'proof_of_delivery', 'other']

export const ALL_STATUSES: readonly ShipmentStatus[] = [
  'draft',
  'ready',
  'dispatched',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'delayed',
  'exception',
]

/** Remessas em andamento (já preparadas e ainda não concluídas). */
export const ACTIVE_STATUSES: readonly ShipmentStatus[] = ['ready', 'dispatched', 'in_transit', 'out_for_delivery', 'delayed', 'exception']
/** Já saíram do depósito e ainda não chegaram. */
export const MOVING_STATUSES: readonly ShipmentStatus[] = ['dispatched', 'in_transit', 'out_for_delivery']
/** Não aceitam mais edição de dados. */
export const LOCKED_STATUSES: readonly ShipmentStatus[] = ['delivered', 'cancelled', 'returned']

/** Transições permitidas. Qualquer outra é recusada. */
export const TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['draft', 'dispatched', 'cancelled'],
  dispatched: ['in_transit', 'delayed', 'exception', 'returned'],
  in_transit: ['out_for_delivery', 'delivered', 'delayed', 'exception', 'returned'],
  out_for_delivery: ['delivered', 'delayed', 'exception', 'returned'],
  delayed: ['in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned'],
  exception: ['in_transit', 'out_for_delivery', 'delivered', 'returned', 'cancelled'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
}

/** Transições que exigem uma justificativa escrita. */
const NOTE_REQUIRED: readonly ShipmentStatus[] = ['delayed', 'exception', 'cancelled', 'returned']

export const canTransition = (from: ShipmentStatus, to: ShipmentStatus): boolean => TRANSITIONS[from].includes(to)
export const nextStatuses = (from: ShipmentStatus): readonly ShipmentStatus[] => TRANSITIONS[from]

export type ErrorCode =
  | 'not_found'
  | 'not_allowed'
  | 'locked'
  | 'note_required'
  | 'invalid_direction'
  | 'missing_recipient'
  | 'missing_destination'
  | 'missing_contents'
  | 'missing_carrier'
  | 'invalid_tracking'
  | 'invalid_number'
  | 'invalid_date'
  | 'invalid_currency'
  | 'unknown_sale'
  | 'unknown_product'
  | 'invalid_item'
  | 'empty_description'
  | 'duplicate_event'
  | 'future_event'
  | 'invalid_document'
  | 'duplicate_document'
  | 'only_draft_removable'
  | 'not_picked'
  | 'not_packed'
  | 'insufficient_stock'
  | 'item_not_in_order'
  | 'exceeds_order_qty'
  | 'unknown_purchase'
  | 'purchase_already_received'
  | 'invalid_qty'
  | 'not_outbound'
  | 'not_ready'
  | 'already_packed'
  | 'not_inbound'
  | 'not_delivered'
  | 'already_received'
  | 'invalid_receipt'
  | 'receipt_note_required'
  | 'stock_mode_required'
  | 'invalid_name'
  | 'pod_exists'
  | 'pod_required'
  | 'already_closed'
  | 'duplicate_carrier'
  | 'invalid_url'
  | 'invalid_email'
  | 'carrier_in_use'
  | 'inactive_carrier'
  | 'unknown_carrier'
  | 'invalid_service_level'
  | 'freight_posted'
  | 'already_posted'
  | 'currency_mismatch'
  | 'nothing_to_post'
  | 'not_international'
  | 'invalid_hs'
  | 'invalid_incoterm'
  | 'return_shipment'
  | 'exceeds_returnable'
  | 'restock_not_allowed'
  | 'decision_required'
  | 'return_not_arrived'
  | 'invalid_resolution'

export type Outcome<T> = { ok: true; data: AppData; value: T } | { ok: false; errors: ErrorCode[] }

export const fail = <T>(...errors: ErrorCode[]): Outcome<T> => ({ ok: false, errors })

// ---------- Sanitização ----------

/** Remove caracteres de controle, normaliza espaços e limita o tamanho. */
export function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
export const dateOf = (iso: string): string => iso.slice(0, 10)
const TRACKING_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]{2,39}$/

// ---------- Entrada ----------

export interface ShipmentInput {
  direction: ShipmentDirection
  orderRef?: ShipmentOrderRef
  origin: ShipmentParty
  destination: ShipmentParty
  senderName: string
  recipientName: string
  carrier: string
  /** Transportadora cadastrada (opcional). Quando informada, o nome vem do cadastro. */
  carrierId?: string
  trackingNumber: string
  method: string
  packages: Omit<ShipmentPackage, 'id'>[]
  items: Omit<ShipmentItem, 'id'>[]
  declaredValue: number
  currency: CurrencyCode
  freightCost: number
  estimatedDelivery?: string
}

type Clean = Omit<ShipmentInput, 'packages' | 'items'> & { packages: Omit<ShipmentPackage, 'id'>[]; items: Omit<ShipmentItem, 'id'>[] }

const party = (p: ShipmentParty): ShipmentParty => ({ name: clean(p.name, 80), city: clean(p.city, 80), country: clean(p.country, 60) })

/** Valida e normaliza os dados de uma remessa contra os cadastros existentes. */
export function normalizeInput(d: AppData, input: ShipmentInput, selfId?: string): { errors: ErrorCode[]; value: Clean } {
  const errors = new Set<ErrorCode>()
  if (!DIRECTIONS.includes(input.direction)) errors.add('invalid_direction')
  if (!CURRENCIES.includes(input.currency)) errors.add('invalid_currency')

  const destination = party(input.destination)
  const origin = party(input.origin)
  const recipientName = clean(input.recipientName, 80)
  if (!recipientName) errors.add('missing_recipient')
  if (!destination.city) errors.add('missing_destination')

  const trackingNumber = clean(input.trackingNumber, 40)
  if (trackingNumber && !TRACKING_RE.test(trackingNumber)) errors.add('invalid_tracking')

  let carrier = clean(input.carrier, 60)
  let carrierId: string | undefined
  if (input.carrierId) {
    const c = d.carriers.find((x) => x.id === input.carrierId)
    if (!c) errors.add('unknown_carrier')
    else {
      // Transportadora inativa não pode ser escolhida de novo, mas uma remessa que já a usa continua válida.
      const current = selfId ? d.shipments.find((s) => s.id === selfId)?.carrierId : undefined
      if (!c.active && c.id !== current) errors.add('inactive_carrier')
      carrierId = c.id
      carrier = c.name
    }
  }

  const estimatedDelivery = input.estimatedDelivery ? clean(input.estimatedDelivery, 10) : undefined
  if (estimatedDelivery && !isDate(estimatedDelivery)) errors.add('invalid_date')

  if (!isMoney(input.declaredValue) || !isMoney(input.freightCost)) errors.add('invalid_number')

  let orderRef: ShipmentOrderRef | undefined
  if (input.orderRef) {
    const label = clean(input.orderRef.label, 80)
    if (input.orderRef.kind === 'sale') {
      const sale = d.sales.find((s) => s.id === input.orderRef?.id)
      if (!sale || sale.canceledAt) errors.add('unknown_sale')
      else orderRef = { kind: 'sale', id: sale.id, label: label || sale.id }
    } else if (input.orderRef.kind === 'purchase') {
      if (input.orderRef.id) {
        // Compra registrada na aba Compras (a partir da fase 1B): vínculo validado.
        const purchase = d.purchases.find((p) => p.id === input.orderRef?.id)
        if (!purchase) errors.add('unknown_purchase')
        else orderRef = { kind: 'purchase', id: purchase.id, label: label || purchase.supplierName }
      } else if (label) {
        // Sem compra registrada: guarda só a referência de texto, sem vínculo validado.
        orderRef = { kind: 'purchase', label }
      }
    }
  }

  const packages = input.packages.map((p) => ({
    weightKg: round2(p.weightKg),
    lengthCm: round2(p.lengthCm),
    widthCm: round2(p.widthCm),
    heightCm: round2(p.heightCm),
  }))
  if (packages.some((p) => ![p.weightKg, p.lengthCm, p.widthCm, p.heightCm].every(isMoney))) errors.add('invalid_number')

  const items = input.items.map((it) => {
    const product = it.productId ? d.products.find((p) => p.id === it.productId) : undefined
    if (it.productId && !product) errors.add('unknown_product')
    const name = clean(it.name || product?.name || '', 80)
    if (!name || !(typeof it.qty === 'number' && Number.isFinite(it.qty) && it.qty > 0)) errors.add('invalid_item')
    return { productId: product?.id, name, sku: clean(it.sku || product?.sku || '', 40), qty: it.qty }
  })

  if (orderRef?.id) {
    for (const e of checkOrderCoverage(d, { id: selfId, direction: input.direction, orderRef, items })) errors.add(e)
  }

  return {
    errors: [...errors],
    value: {
      direction: input.direction,
      orderRef,
      origin,
      destination,
      senderName: clean(input.senderName, 80),
      recipientName,
      carrier,
      carrierId,
      trackingNumber,
      method: clean(input.method, 40),
      packages,
      items,
      declaredValue: isMoney(input.declaredValue) ? round2(input.declaredValue) : 0,
      currency: input.currency,
      freightCost: isMoney(input.freightCost) ? round2(input.freightCost) : 0,
      estimatedDelivery,
    },
  }
}

// ---------- Identificadores e eventos ----------

let counter = 0
export const uid = (): string => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Próximo código SHP-0001 (maior número existente + 1). */
export function nextShipmentId(shipments: readonly Shipment[]): string {
  const max = shipments.reduce((m, s) => {
    const n = /^SHP-(\d+)$/.exec(s.id)
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `SHP-${String(max + 1).padStart(4, '0')}`
}

const withIds = <T extends object>(list: T[]): (T & { id: string })[] => list.map((x) => ({ ...x, id: uid() }))

export const event = (e: Omit<ShipmentEvent, 'id' | 'source'>): ShipmentEvent => ({ id: uid(), source: 'manual', ...e })

export const replace = (d: AppData, s: Shipment): AppData => ({ ...d, shipments: d.shipments.map((x) => (x.id === s.id ? s : x)) })

// ---------- Operações ----------

export function createShipment(d: AppData, input: ShipmentInput, now: string, actor: string): Outcome<{ id: string }> {
  const { errors, value } = normalizeInput(d, input)
  if (errors.length) return fail(...errors)
  const id = nextShipmentId(d.shipments)
  const s: Shipment = {
    id,
    orgId: DEFAULT_ORG,
    ...value,
    packages: withIds(value.packages),
    items: withIds(value.items),
    status: 'draft',
    documents: [],
    events: [event({ kind: 'created', at: now, toStatus: 'draft', description: '', actor: clean(actor, 60) })],
    createdAt: now,
    updatedAt: now,
  }
  return { ok: true, data: { ...d, shipments: [s, ...d.shipments] }, value: { id } }
}

const FIELD_KEYS = ['orderRef', 'origin', 'destination', 'senderName', 'recipientName', 'carrier', 'carrierId', 'trackingNumber', 'method', 'packages', 'items', 'declaredValue', 'currency', 'freightCost', 'estimatedDelivery'] as const

const strip = (list: object[]): string => JSON.stringify(list.map(({ ...rest }) => ({ ...rest, id: undefined })))

/** Edita dados da remessa. A direção não muda depois de criada. Cada edição vira um registro de auditoria. */
export function updateShipment(d: AppData, id: string, input: ShipmentInput, now: string, actor: string): Outcome<{ changed: string[] }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (LOCKED_STATUSES.includes(cur.status)) return fail('locked')
  const { errors, value } = normalizeInput(d, { ...input, direction: cur.direction }, cur.id)
  if (errors.length) return fail(...errors)
  // O custo já foi lançado em contas a pagar: alterar o frete aqui deixaria os dois valores diferentes.
  if (value.freightCost !== cur.freightCost && isFreightPosted(d, cur)) return fail('freight_posted')

  const changed = FIELD_KEYS.filter((k) => {
    if (k === 'packages' || k === 'items') return strip(cur[k]) !== strip(value[k])
    return JSON.stringify(cur[k]) !== JSON.stringify(value[k])
  })
  if (changed.length === 0) return { ok: true, data: d, value: { changed: [] } }

  const next: Shipment = {
    ...cur,
    ...value,
    direction: cur.direction,
    packages: changed.includes('packages') ? withIds(value.packages) : cur.packages,
    items: changed.includes('items') ? withIds(value.items) : cur.items,
    // Os itens mudaram: a separação anterior deixa de valer.
    fulfillment: changed.includes('items') ? undefined : cur.fulfillment,
    events: [...cur.events, event({ kind: 'edit', at: now, description: '', fields: [...changed], actor: clean(actor, 60) })],
    updatedAt: now,
  }
  return { ok: true, data: replace(d, next), value: { changed: [...changed] } }
}

export interface TransitionOptions {
  note?: string
  /** Data real de entrega (YYYY-MM-DD), usada ao marcar como entregue. */
  deliveredAt?: string
}

/** Valida e aplica uma mudança de status. `today` é a data local (YYYY-MM-DD) de quem está operando. */
export function transitionShipment(d: AppData, id: string, to: ShipmentStatus, opts: TransitionOptions, now: string, today: string, actor: string): Outcome<{ status: ShipmentStatus }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (!canTransition(cur.status, to)) return fail('not_allowed')

  const note = clean(opts.note, 300)
  const errors: ErrorCode[] = []
  if (NOTE_REQUIRED.includes(to) && note.length < 3) errors.push('note_required')

  if (to === 'ready') {
    if (!cur.recipientName) errors.push('missing_recipient')
    if (!cur.destination.city || !cur.destination.country) errors.push('missing_destination')
    if (cur.items.length === 0 && cur.packages.length === 0) errors.push('missing_contents')
  }
  if (to === 'dispatched') {
    if (!cur.carrier) errors.push('missing_carrier')
    // Remessas de saída com itens do estoque só saem separadas, embaladas e conferidas (sem baixar estoque de novo).
    if (needsFulfillment(cur)) {
      if (!allPicked(cur)) errors.push('not_picked')
      else if (!cur.fulfillment?.packedAt) errors.push('not_packed')
      const stock = checkOutboundStock(d, cur)
      if (!stock.ok) errors.push(...stock.errors)
    }
  }

  let deliveredAt = cur.deliveredAt
  if (to === 'delivered') {
    deliveredAt = opts.deliveredAt || today
    if (!isDate(deliveredAt) || deliveredAt > today || deliveredAt < dateOf(cur.createdAt)) errors.push('invalid_date')
  }
  if (errors.length) return fail(...errors)

  const next: Shipment = {
    ...cur,
    status: to,
    deliveredAt,
    events: [...cur.events, event({ kind: 'status', at: now, fromStatus: cur.status, toStatus: to, description: note, actor: clean(actor, 60) })],
    updatedAt: now,
  }
  return { ok: true, data: replace(d, next), value: { status: to } }
}

export interface TrackingInput {
  /** Quando o fato ocorreu (ISO ou datetime-local). */
  occurredAt: string
  location: string
  description: string
}

export const TRACKABLE: readonly ShipmentStatus[] = ['dispatched', 'in_transit', 'out_for_delivery', 'delayed', 'exception', 'delivered', 'returned']

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()
/** Chave de deduplicação: mesmo instante (ao minuto), local e descrição. */
export const trackingKey = (occurredAt: string, location: string, description: string): string => `${occurredAt.slice(0, 16)}|${norm(location)}|${norm(description)}`

/** Registra um evento de rastreio informado manualmente. Recusa duplicados e datas futuras. */
export function addTrackingEvent(d: AppData, id: string, input: TrackingInput, now: string, actor: string): Outcome<{ eventId: string }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (!TRACKABLE.includes(cur.status)) return fail('not_allowed')

  const description = clean(input.description, 300)
  const location = clean(input.location, 80)
  if (description.length < 3) return fail('empty_description')
  const ts = Date.parse(input.occurredAt)
  if (Number.isNaN(ts)) return fail('invalid_date')
  if (ts > Date.parse(now) + 5 * 60_000) return fail('future_event')
  const occurredAt = new Date(ts).toISOString()

  const key = trackingKey(occurredAt, location, description)
  if (cur.events.some((e) => e.kind === 'tracking' && e.occurredAt && trackingKey(e.occurredAt, e.location ?? '', e.description) === key)) return fail('duplicate_event')

  const ev = event({ kind: 'tracking', at: now, occurredAt, location, description, actor: clean(actor, 60) })
  return { ok: true, data: replace(d, { ...cur, events: [...cur.events, ev], updatedAt: now }), value: { eventId: ev.id } }
}

export function addDocument(d: AppData, id: string, input: { type: ShipmentDocumentType; reference: string }, now: string, actor: string): Outcome<{ documentId: string }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (cur.status === 'cancelled') return fail('locked')
  const reference = clean(input.reference, 60)
  if (!DOCUMENT_TYPES.includes(input.type) || reference.length < 2) return fail('invalid_document')
  if (cur.documents.some((x) => x.type === input.type && norm(x.reference) === norm(reference))) return fail('duplicate_document')
  const doc: ShipmentDocument = { id: uid(), type: input.type, reference, addedAt: now, addedBy: clean(actor, 60) }
  const ev = event({ kind: 'document', at: now, description: reference, fields: [input.type], actor: clean(actor, 60) })
  return { ok: true, data: replace(d, { ...cur, documents: [...cur.documents, doc], events: [...cur.events, ev], updatedAt: now }), value: { documentId: doc.id } }
}

/** Só rascunhos podem ser apagados. Qualquer outra remessa deve ser cancelada para manter a auditoria. */
export function removeDraft(d: AppData, id: string): Outcome<{ id: string }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (cur.status !== 'draft') return fail('only_draft_removable')
  return { ok: true, data: { ...d, shipments: d.shipments.filter((s) => s.id !== id) }, value: { id } }
}

// ---------- Leituras e indicadores ----------

/** O custo de frete já virou uma conta a pagar que ainda existe. */
export const isFreightPosted = (d: AppData, s: Shipment): boolean => !!s.freight?.postedAccountId && d.accounts.some((a) => a.id === s.freight?.postedAccountId)

export const isLocked = (s: Shipment): boolean => LOCKED_STATUSES.includes(s.status)

/** Atrasada: prevista para antes de hoje e ainda não entregue, cancelada ou devolvida. */
export function isOverdue(s: Shipment, today: string): boolean {
  return !!s.estimatedDelivery && s.estimatedDelivery < today && (ACTIVE_STATUSES.includes(s.status) && s.status !== 'ready')
}

export const lastTrackingEvent = (s: Shipment): ShipmentEvent | undefined =>
  s.events
    .filter((e) => e.kind === 'tracking' && e.occurredAt)
    .sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))[0]

/** Data do primeiro despacho registrado no histórico. */
export const dispatchedOn = (s: Shipment): string | undefined => s.events.find((e) => e.kind === 'status' && e.toStatus === 'dispatched')?.at.slice(0, 10)

const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export interface Period {
  /** Início (YYYY-MM-DD). Vazio = sem limite. */
  from: string
}

export type KpiKey = 'active' | 'moving' | 'delivered' | 'problems' | 'freight' | 'onTime'

export interface LogisticsKpis {
  active: number
  moving: number
  delivered: number
  problems: number
  /** Taxa de entregas no prazo, ou null se não houver entregas com data prevista. */
  onTimeRate: number | null
  onTimeSample: number
  avgTransitDays: number | null
  freightByCurrency: Record<string, number>
}

const deliveredInPeriod = (shipments: readonly Shipment[], period: Period): Shipment[] =>
  shipments.filter((s) => s.status === 'delivered' && !!s.deliveredAt && (!period.from || (s.deliveredAt ?? '') >= period.from))

/**
 * Conjunto de remessas por trás de cada indicador. É a única definição: os números dos cartões e as listas
 * mostradas ao clicar neles saem daqui, então nunca divergem.
 * - active, moving e problems são o retrato atual (não dependem do período).
 * - delivered e onTime usam a data real de entrega dentro do período.
 * - freight usa a data de criação dentro do período, sem canceladas e só com frete registrado (maior que zero).
 */
export function kpiSet(shipments: readonly Shipment[], key: KpiKey, period: Period, today: string): Shipment[] {
  switch (key) {
    case 'active':
      return shipments.filter((s) => ACTIVE_STATUSES.includes(s.status))
    case 'moving':
      return shipments.filter((s) => MOVING_STATUSES.includes(s.status))
    case 'delivered':
      return deliveredInPeriod(shipments, period)
    case 'problems':
      return shipments.filter((s) => s.status === 'delayed' || s.status === 'exception' || isOverdue(s, today))
    case 'freight':
      return shipments.filter((s) => (!period.from || dateOf(s.createdAt) >= period.from) && s.status !== 'cancelled' && s.freightCost > 0)
    case 'onTime':
      return deliveredInPeriod(shipments, period).filter((s) => !!s.estimatedDelivery)
  }
}

export function kpis(shipments: readonly Shipment[], period: Period, today: string): LogisticsKpis {
  const withEta = kpiSet(shipments, 'onTime', period, today)
  const onTime = withEta.filter((s) => (s.deliveredAt ?? '') <= (s.estimatedDelivery ?? ''))
  const durations = kpiSet(shipments, 'delivered', period, today).flatMap((s) => {
    const start = dispatchedOn(s)
    return start && s.deliveredAt ? [Math.max(0, dayDiff(start, s.deliveredAt))] : []
  })
  return {
    active: kpiSet(shipments, 'active', period, today).length,
    moving: kpiSet(shipments, 'moving', period, today).length,
    delivered: kpiSet(shipments, 'delivered', period, today).length,
    problems: kpiSet(shipments, 'problems', period, today).length,
    onTimeRate: withEta.length ? (onTime.length / withEta.length) * 100 : null,
    onTimeSample: withEta.length,
    avgTransitDays: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    freightByCurrency: freightBreakdown(kpiSet(shipments, 'freight', period, today)).byCurrency,
  }
}

export interface FreightBreakdown {
  byCurrency: Record<string, number>
  byCarrier: { carrier: string; currency: string; total: number; count: number }[]
}

/** Soma de frete por moeda e por transportadora (moedas nunca são misturadas). Valores zerados não entram. */
export function freightBreakdown(set: readonly Shipment[]): FreightBreakdown {
  const byCurrency: Record<string, number> = {}
  const carriers = new Map<string, { carrier: string; currency: string; total: number; count: number }>()
  for (const s of set) {
    if (s.freightCost <= 0) continue
    byCurrency[s.currency] = round2((byCurrency[s.currency] ?? 0) + s.freightCost)
    const name = s.carrier || ''
    const k = `${name}|${s.currency}`
    const cur = carriers.get(k) ?? { carrier: name, currency: s.currency, total: 0, count: 0 }
    carriers.set(k, { ...cur, total: round2(cur.total + s.freightCost), count: cur.count + 1 })
  }
  return { byCurrency, byCarrier: [...carriers.values()].sort((a, b) => b.total - a.total) }
}

export interface Punctuality {
  onTime: boolean
  /** Dias de atraso na entrega (0 quando no prazo). */
  daysLate: number
}

/** Pontualidade de uma entrega. Null quando faltam a data prevista ou a data real. */
export function punctuality(s: Shipment): Punctuality | null {
  if (s.status !== 'delivered' || !s.deliveredAt || !s.estimatedDelivery) return null
  const late = dayDiff(s.estimatedDelivery, s.deliveredAt)
  return { onTime: late <= 0, daysLate: Math.max(0, late) }
}

/** Cliente ou fornecedor da remessa: quem envia nas entradas, quem recebe nas demais. */
export const counterparty = (s: Shipment): string => (s.direction === 'inbound' ? s.senderName || s.origin.name : s.recipientName || s.destination.name)

export type SortKey = 'id' | 'counterparty' | 'eta' | 'status' | 'updated'

/** Ordena sem alterar a lista original. Remessas sem data prevista ficam sempre no fim ao ordenar por previsão. */
export function sortShipments(list: readonly Shipment[], key: SortKey, dir: 'asc' | 'desc'): Shipment[] {
  const sign = dir === 'asc' ? 1 : -1
  const cmp = (a: Shipment, b: Shipment): number => {
    switch (key) {
      case 'id':
        return a.id.localeCompare(b.id, undefined, { numeric: true })
      case 'counterparty':
        return counterparty(a).localeCompare(counterparty(b))
      case 'status':
        return ALL_STATUSES.indexOf(a.status) - ALL_STATUSES.indexOf(b.status)
      case 'updated':
        return a.updatedAt.localeCompare(b.updatedAt)
      case 'eta':
        return (a.estimatedDelivery ?? '').localeCompare(b.estimatedDelivery ?? '')
    }
  }
  return [...list].sort((a, b) => {
    if (key === 'eta') {
      if (!a.estimatedDelivery && !b.estimatedDelivery) return a.id.localeCompare(b.id)
      if (!a.estimatedDelivery) return 1
      if (!b.estimatedDelivery) return -1
    }
    return sign * cmp(a, b) || a.id.localeCompare(b.id)
  })
}

export function statusCounts(shipments: readonly Shipment[]): Record<ShipmentStatus, number> {
  const out = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<ShipmentStatus, number>
  for (const s of shipments) out[s.status] += 1
  return out
}

export type AlertReason = 'exception' | 'delayed' | 'overdue' | 'no_tracking' | 'awaiting_receipt'

export interface LogisticsAlert {
  shipment: Shipment
  reason: AlertReason
}

/** Alertas calculados só a partir dos registros: exceções, atrasos, previsão vencida e despachos sem código de rastreio. */
export function alerts(shipments: readonly Shipment[], today: string): LogisticsAlert[] {
  const out: LogisticsAlert[] = []
  for (const s of shipments) {
    if (s.status === 'exception') out.push({ shipment: s, reason: 'exception' })
    else if (s.status === 'delayed') out.push({ shipment: s, reason: 'delayed' })
    else if (isOverdue(s, today)) out.push({ shipment: s, reason: 'overdue' })
    else if (MOVING_STATUSES.includes(s.status) && !s.trackingNumber) out.push({ shipment: s, reason: 'no_tracking' })
    else if (s.direction === 'inbound' && s.status === 'delivered' && !s.receiptId && !s.returnId) out.push({ shipment: s, reason: 'awaiting_receipt' })
  }
  const weight: Record<AlertReason, number> = { exception: 0, delayed: 1, overdue: 2, no_tracking: 3, awaiting_receipt: 4 }
  return out.sort((a, b) => weight[a.reason] - weight[b.reason])
}

export interface FeedItem {
  shipment: Shipment
  event: ShipmentEvent
  /** Instante usado para ordenar: quando ocorreu (rastreio) ou quando foi registrado. */
  when: string
}

/** Últimos registros de todas as remessas, do mais recente para o mais antigo. */
export function eventFeed(shipments: readonly Shipment[], limit: number): FeedItem[] {
  return shipments
    .flatMap((s) => s.events.filter((e) => e.kind !== 'edit').map((event) => ({ shipment: s, event, when: event.occurredAt ?? event.at })))
    .sort((a, b) => b.when.localeCompare(a.when))
    .slice(0, limit)
}

/** Próximas entregas: remessas em andamento com data prevista, da mais próxima para a mais distante. */
export function upcoming(shipments: readonly Shipment[], limit: number): Shipment[] {
  return shipments
    .filter((s) => ACTIVE_STATUSES.includes(s.status) && s.estimatedDelivery)
    .sort((a, b) => (a.estimatedDelivery ?? '').localeCompare(b.estimatedDelivery ?? ''))
    .slice(0, limit)
}
