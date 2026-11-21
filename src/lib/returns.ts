// Logística reversa (fase 1C): autorização de devolução (RMA), remessa de retorno, inspeção e resolução. Módulo puro.
//
// Regras de segurança do estoque:
// - Nada volta ao estoque sem inspeção. A remessa de retorno não passa pelo recebimento comum (ver receiving.ts).
// - Só itens em bom estado, com a decisão explícita "reestocar", somam ao estoque, uma única vez (a inspeção só ocorre uma vez).
// - Itens danificados ou com defeito nunca são reestocados automaticamente.
// - Reembolso e troca são apenas registrados aqui (com referência). Nenhum lançamento financeiro é feito automaticamente.
import type { AppData, ReturnAuthorization, ReturnCondition, ReturnDecision, ReturnEvent, ReturnInspectionLine, StockMove } from './types'
import { DEFAULT_ORG, clean, createShipment, fail, round2, uid, type Outcome, type ShipmentInput } from './logistics'

const ACTIVE_FOR_CAP: readonly ReturnAuthorization['status'][] = ['requested', 'authorized', 'inspected', 'closed']
const CONDITIONS: readonly ReturnCondition[] = ['good', 'damaged', 'defective']
const DECISIONS: readonly ReturnDecision[] = ['restock', 'discard', 'return_to_supplier']

export function nextReturnId(returns: readonly { id: string }[]): string {
  const max = returns.reduce((m, r) => {
    const n = /^RMA-(\d+)$/.exec(r.id)
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `RMA-${String(max + 1).padStart(4, '0')}`
}

const ev = (action: ReturnEvent['action'], at: string, actor: string, note = ''): ReturnEvent => ({ id: uid(), at, actor: clean(actor, 60), action, note: clean(note, 300) })

const replaceReturn = (d: AppData, r: ReturnAuthorization): AppData => ({ ...d, returns: d.returns.map((x) => (x.id === r.id ? r : x)) })

/** Quantidade de um item da remessa que ainda pode ser devolvida. */
export function returnableQty(d: AppData, shipmentId: string, itemId: string): number {
  const item = d.shipments.find((s) => s.id === shipmentId)?.items.find((i) => i.id === itemId)
  if (!item) return 0
  const used = d.returns
    .filter((r) => r.shipmentId === shipmentId && ACTIVE_FOR_CAP.includes(r.status))
    .flatMap((r) => r.lines)
    .filter((l) => l.itemId === itemId)
    .reduce((sum, l) => sum + l.qty, 0)
  return round2(Math.max(0, item.qty - used))
}

export interface ReturnRequestInput {
  shipmentId: string
  lines: { itemId: string; qty: number }[]
  reason: string
}

export function requestReturn(d: AppData, input: ReturnRequestInput, now: string, actor: string): Outcome<{ id: string }> {
  const ship = d.shipments.find((s) => s.id === input.shipmentId)
  if (!ship) return fail('not_found')
  if (ship.direction !== 'outbound') return fail('not_outbound')
  if (ship.status !== 'delivered') return fail('not_delivered')
  const reason = clean(input.reason, 300)
  if (reason.length < 3) return fail('note_required')
  if (input.lines.length === 0 || new Set(input.lines.map((l) => l.itemId)).size !== input.lines.length) return fail('invalid_item')

  const lines = []
  for (const l of input.lines) {
    const item = ship.items.find((i) => i.id === l.itemId)
    if (!item || typeof l.qty !== 'number' || !Number.isFinite(l.qty) || l.qty <= 0) return fail('invalid_item')
    if (round2(l.qty) > returnableQty(d, ship.id, item.id)) return fail('exceeds_returnable')
    lines.push({ itemId: item.id, productId: item.productId, name: item.name, sku: item.sku, qty: round2(l.qty) })
  }
  const id = nextReturnId(d.returns)
  const rma: ReturnAuthorization = {
    id,
    orgId: DEFAULT_ORG,
    shipmentId: ship.id,
    saleId: ship.orderRef?.kind === 'sale' ? ship.orderRef.id : undefined,
    lines,
    reason,
    status: 'requested',
    events: [ev('requested', now, actor, reason)],
    createdAt: now,
    updatedAt: now,
  }
  return { ok: true, data: { ...d, returns: [rma, ...d.returns] }, value: { id } }
}

function move(d: AppData, id: string, from: ReturnAuthorization['status'][], to: ReturnAuthorization['status'], action: ReturnEvent['action'], note: string, now: string, actor: string, needNote: boolean): Outcome<{ id: string }> {
  const cur = d.returns.find((r) => r.id === id)
  if (!cur) return fail('not_found')
  if (!from.includes(cur.status)) return fail('not_allowed')
  if (needNote && clean(note, 300).length < 3) return fail('note_required')
  return { ok: true, data: replaceReturn(d, { ...cur, status: to, events: [...cur.events, ev(action, now, actor, note)], updatedAt: now }), value: { id } }
}

export const authorizeReturn = (d: AppData, id: string, note: string, now: string, actor: string) => move(d, id, ['requested'], 'authorized', 'authorized', note, now, actor, false)
export const rejectReturn = (d: AppData, id: string, note: string, now: string, actor: string) => move(d, id, ['requested'], 'rejected', 'rejected', note, now, actor, true)
export const cancelReturn = (d: AppData, id: string, note: string, now: string, actor: string) => move(d, id, ['requested', 'authorized'], 'cancelled', 'cancelled', note, now, actor, false)

/** Cria a remessa de retorno (entrada) ligada à devolução, para acompanhar o transporte. Ela nunca passa pelo recebimento comum. */
export function createReturnShipment(d: AppData, id: string, now: string, actor: string): Outcome<{ shipmentId: string }> {
  const cur = d.returns.find((r) => r.id === id)
  if (!cur) return fail('not_found')
  if (cur.status !== 'authorized' || cur.returnShipmentId) return fail('not_allowed')
  const orig = d.shipments.find((s) => s.id === cur.shipmentId)
  if (!orig) return fail('not_found')

  const input: ShipmentInput = {
    direction: 'inbound',
    origin: orig.destination,
    destination: orig.origin,
    senderName: orig.recipientName,
    recipientName: orig.senderName || orig.origin.name,
    carrier: '',
    trackingNumber: '',
    method: orig.method,
    packages: [],
    items: cur.lines.map((l) => ({ productId: l.productId, name: l.name, sku: l.sku, qty: l.qty })),
    declaredValue: 0,
    currency: orig.currency,
    freightCost: 0,
  }
  const created = createShipment(d, input, now, actor)
  if (!created.ok) return created
  const shipmentId = created.value.id
  const withLink = { ...created.data, shipments: created.data.shipments.map((s) => (s.id === shipmentId ? { ...s, returnId: id } : s)) }
  const rma = { ...cur, returnShipmentId: shipmentId, events: [...cur.events, ev('shipment_created', now, actor, shipmentId)], updatedAt: now }
  return { ok: true, data: replaceReturn(withLink, rma), value: { shipmentId } }
}

export interface InspectionInput {
  lines: { itemId: string; receivedQty: number; condition: ReturnCondition; decision?: ReturnDecision }[]
  notes: string
}

/** Inspeciona os itens devolvidos e, se decidido, reestoca só os que estão em bom estado. Acontece uma única vez. */
export function inspectReturn(d: AppData, id: string, input: InspectionInput, now: string, today: string, actor: string): Outcome<{ restocked: { productId: string; qty: number }[] }> {
  const cur = d.returns.find((r) => r.id === id)
  if (!cur) return fail('not_found')
  if (cur.status !== 'authorized') return fail('not_allowed')
  if (cur.returnShipmentId && d.shipments.find((s) => s.id === cur.returnShipmentId)?.status !== 'delivered') return fail('return_not_arrived')
  if (input.lines.length !== cur.lines.length || new Set(input.lines.map((l) => l.itemId)).size !== cur.lines.length) return fail('invalid_receipt')

  const lines: ReturnInspectionLine[] = []
  let needsNote = false
  for (const line of cur.lines) {
    const l = input.lines.find((x) => x.itemId === line.itemId)
    if (!l || !CONDITIONS.includes(l.condition)) return fail('invalid_receipt')
    if (typeof l.receivedQty !== 'number' || !Number.isFinite(l.receivedQty) || l.receivedQty < 0 || l.receivedQty > line.qty) return fail('invalid_qty')
    const received = round2(l.receivedQty)
    if (received > 0) {
      if (!l.decision || !DECISIONS.includes(l.decision)) return fail('decision_required')
      if (l.decision === 'restock' && l.condition !== 'good') return fail('restock_not_allowed')
    }
    if (l.condition !== 'good' || received !== line.qty) needsNote = true
    lines.push({ itemId: line.itemId, receivedQty: received, condition: l.condition, decision: received > 0 ? l.decision : undefined })
  }
  const notes = clean(input.notes, 300)
  if (needsNote && notes.length < 3) return fail('receipt_note_required')

  let products = d.products
  const moves: StockMove[] = []
  const restocked: { productId: string; qty: number }[] = []
  for (const l of lines) {
    if (l.decision !== 'restock' || l.receivedQty <= 0) continue
    const line = cur.lines.find((x) => x.itemId === l.itemId)
    if (!line?.productId) continue
    const productId = line.productId
    if (!products.some((p) => p.id === productId)) return fail('unknown_product')
    products = products.map((p) => (p.id === productId ? { ...p, stock: round2(p.stock + l.receivedQty) } : p))
    moves.push({ id: uid(), productId, kind: 'in', qty: l.receivedQty, date: today, note: `${cur.id} · ${cur.shipmentId}` })
    restocked.push({ productId, qty: l.receivedQty })
  }

  const rma: ReturnAuthorization = {
    ...cur,
    status: 'inspected',
    inspection: { lines, notes, at: now, by: clean(actor, 60), restocked },
    events: [...cur.events, ev('inspected', now, actor, notes)],
    updatedAt: now,
  }
  return { ok: true, data: { ...replaceReturn(d, rma), products, moves: moves.length ? [...moves, ...d.moves] : d.moves }, value: { restocked } }
}

export interface ResolutionInput {
  kind: 'refund' | 'replacement' | 'none'
  reference: string
  note: string
}

/** Resolução final: só registra (com referência). O reembolso ou a troca são feitos nos módulos próprios. */
export function resolveReturn(d: AppData, id: string, input: ResolutionInput, now: string, actor: string): Outcome<{ id: string }> {
  const cur = d.returns.find((r) => r.id === id)
  if (!cur) return fail('not_found')
  if (cur.status !== 'inspected') return fail('not_allowed')
  if (!['refund', 'replacement', 'none'].includes(input.kind)) return fail('invalid_resolution')
  const reference = clean(input.reference, 60)
  if (input.kind !== 'none' && reference.length < 2) return fail('invalid_resolution')
  const resolution = { kind: input.kind, reference, note: clean(input.note, 300), at: now, by: clean(actor, 60) }
  return { ok: true, data: replaceReturn(d, { ...cur, status: 'closed', resolution, events: [...cur.events, ev('closed', now, actor, resolution.note)], updatedAt: now }), value: { id } }
}

export const isReturnFinal = (r: ReturnAuthorization): boolean => r.status === 'closed' || r.status === 'rejected' || r.status === 'cancelled'

