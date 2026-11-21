// Expedição de remessas de saída (fase 1B): separar, embalar, conferir estoque, registrar comprovante e fechar.
// Nenhuma função aqui altera estoque ou financeiro: a venda ligada já baixou o estoque (ver stock-checks.ts).
import type { AppData, Fulfillment } from './types'
import { checkOutboundStock, fulfillmentOf, needsFulfillment, allPicked } from './stock-checks'
import { clean, event, fail, replace, round2, type Outcome } from './logistics'

export function pickItem(d: AppData, id: string, itemId: string, qty: number, now: string, actor: string): Outcome<{ picked: number }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (!needsFulfillment(cur)) return fail('not_outbound')
  if (cur.status !== 'ready') return fail('not_ready')
  const current = fulfillmentOf(cur)
  if (current.packedAt) return fail('already_packed')
  const item = cur.items.find((i) => i.id === itemId && !!i.productId)
  if (!item) return fail('invalid_item')
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0 || qty > item.qty) return fail('invalid_qty')
  const picked = round2(qty)
  if ((current.picks[itemId] ?? 0) === picked) return { ok: true, data: d, value: { picked } }

  const next: Fulfillment = { ...current, picks: { ...current.picks, [itemId]: picked } }
  const ev = event({ kind: 'fulfillment', at: now, description: `${item.name}: ${picked}/${item.qty}`, fields: ['pick'], actor: clean(actor, 60) })
  return { ok: true, data: replace(d, { ...cur, fulfillment: next, events: [...cur.events, ev], updatedAt: now }), value: { picked } }
}

/** Fecha a embalagem: exige tudo separado e conferência de estoque aprovada. Não baixa estoque. */
export function packShipment(d: AppData, id: string, now: string, actor: string): Outcome<{ mode: 'sale_deducted' | 'on_hand' }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (!needsFulfillment(cur)) return fail('not_outbound')
  if (cur.status !== 'ready') return fail('not_ready')
  const current = fulfillmentOf(cur)
  if (current.packedAt) return fail('already_packed')
  if (!allPicked(cur)) return fail('not_picked')
  const stock = checkOutboundStock(d, cur)
  if (!stock.ok) return fail(...stock.errors)

  const next: Fulfillment = { ...current, packedAt: now, packedBy: clean(actor, 60), stockCheck: { mode: stock.mode, checkedAt: now } }
  const ev = event({ kind: 'fulfillment', at: now, description: '', fields: ['pack', stock.mode], actor: clean(actor, 60) })
  return { ok: true, data: replace(d, { ...cur, fulfillment: next, events: [...cur.events, ev], updatedAt: now }), value: { mode: stock.mode } }
}

export interface PodInput {
  receivedBy: string
  reference: string
  note: string
}

/** Comprovante de entrega de uma remessa de saída já entregue. Informado manualmente, nunca inventado. */
export function recordPod(d: AppData, id: string, input: PodInput, now: string, actor: string): Outcome<{ id: string }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (cur.direction !== 'outbound') return fail('not_outbound')
  if (cur.status !== 'delivered') return fail('not_delivered')
  const current = fulfillmentOf(cur)
  if (current.pod) return fail('pod_exists')
  const receivedBy = clean(input.receivedBy, 80)
  if (receivedBy.length < 2) return fail('invalid_name')

  const pod = { receivedBy, reference: clean(input.reference, 60), note: clean(input.note, 300), at: now, recordedBy: clean(actor, 60) }
  const ev = event({ kind: 'fulfillment', at: now, description: receivedBy, fields: ['pod'], actor: clean(actor, 60) })
  return { ok: true, data: replace(d, { ...cur, fulfillment: { ...current, pod }, events: [...cur.events, ev], updatedAt: now }), value: { id } }
}

/** Encerra a expedição depois do comprovante de entrega. */
export function closeFulfillment(d: AppData, id: string, now: string, actor: string): Outcome<{ id: string }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (cur.direction !== 'outbound') return fail('not_outbound')
  if (cur.status !== 'delivered') return fail('not_delivered')
  const current = fulfillmentOf(cur)
  if (current.closedAt) return fail('already_closed')
  if (!current.pod) return fail('pod_required')

  const ev = event({ kind: 'fulfillment', at: now, description: '', fields: ['close'], actor: clean(actor, 60) })
  return { ok: true, data: replace(d, { ...cur, fulfillment: { ...current, closedAt: now }, events: [...cur.events, ev], updatedAt: now }), value: { id } }
}
