import { describe, expect, test } from 'bun:test'
import { alerts, createShipment, transitionShipment, updateShipment, type ShipmentInput } from '../src/lib/logistics'
import { closeFulfillment, packShipment, pickItem, recordPod } from '../src/lib/fulfillment'
import { receiveGoods } from '../src/lib/receiving'
import type { AppData, PurchaseRef } from '../src/lib/types'

const NOW = '2026-11-21T12:00:00.000Z'
const TODAY = '2026-11-21'

const base = (): AppData =>
  ({
    products: [
      { id: 'p1', sku: 'CAF-001', name: 'Café', category: 'x', unit: 'un', cost: 10, price: 20, stock: 10, minStock: 1 },
      { id: 'p2', sku: 'CHA-002', name: 'Chá', category: 'x', unit: 'un', cost: 5, price: 9, stock: 4, minStock: 1 },
    ],
    moves: [],
    contacts: [],
    entries: [],
    accounts: [],
    sales: [{ id: 's1', date: TODAY, customerName: 'Ana', items: [{ productId: 'p1', name: 'Café', qty: 5, price: 20, cost: 10 }], total: 100, cogs: 50, method: 'pix' }],
    employees: [],
    treasuryOps: [],
    requests: [],
    shipments: [],
    purchases: [
      { id: 'PUR-0001', date: TODAY, supplierName: 'Forn A', items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 20, cost: 12 }], total: 240, stockPosted: false, createdAt: NOW },
      { id: 'PUR-0002', date: TODAY, supplierName: 'Forn B', items: [{ productId: 'p2', name: 'Chá', sku: 'CHA-002', qty: 8, cost: 6 }], total: 48, stockPosted: true, createdAt: NOW },
    ] satisfies PurchaseRef[],
    receipts: [],
    settings: { company: 'X', branch: 'Y', owner: 'Z', currency: 'BRL', usdcRate: null, approvalLimit: null },
  }) as unknown as AppData

const input = (over: Partial<ShipmentInput> = {}): ShipmentInput => ({
  direction: 'outbound',
  origin: { name: 'Armazém', city: 'São Paulo', country: 'BR' },
  destination: { name: 'Loja', city: 'Lisboa', country: 'PT' },
  senderName: 'X',
  recipientName: 'Ana',
  carrier: 'Transportadora X',
  trackingNumber: 'AB123456789',
  method: 'Standard',
  packages: [{ weightKg: 2, lengthCm: 10, widthCm: 10, heightCm: 10 }],
  items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 2 }],
  declaredValue: 100,
  currency: 'BRL',
  freightCost: 10,
  estimatedDelivery: '2026-11-25',
  ...over,
})

function make(d: AppData, over: Partial<ShipmentInput> = {}) {
  const r = createShipment(d, input(over), NOW, 't')
  if (!r.ok) throw new Error(r.errors.join())
  return { d: r.data, id: r.value.id }
}
function step(d: AppData, id: string, to: Parameters<typeof transitionShipment>[2], note = 'ok nota', deliveredAt?: string) {
  const r = transitionShipment(d, id, to, { note, deliveredAt }, NOW, TODAY, 't')
  if (!r.ok) throw new Error(`${to}: ${r.errors.join(',')}`)
  return r.data
}
const errs = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r.errors ?? []))
const itemId = (d: AppData, id: string, n = 0) => d.shipments.find((s) => s.id === id)!.items[n]!.id

describe('outbound fulfillment: pick, pack, dispatch', () => {
  test('dispatch is blocked until everything is picked and packed, and never touches stock', () => {
    const m = make(base())
    let d = step(m.d, m.id, 'ready')
    expect(errs(transitionShipment(d, m.id, 'dispatched', {}, NOW, TODAY, 't'))).toContain('not_picked')

    const half = pickItem(d, m.id, itemId(d, m.id), 1, NOW, 't')
    expect(half.ok).toBe(true)
    if (!half.ok) return
    expect(errs(transitionShipment(half.data, m.id, 'dispatched', {}, NOW, TODAY, 't'))).toContain('not_picked')
    expect(errs(packShipment(half.data, m.id, NOW, 't'))).toContain('not_picked')

    const full = pickItem(half.data, m.id, itemId(d, m.id), 2, NOW, 't')
    if (!full.ok) throw new Error('pick')
    expect(errs(transitionShipment(full.data, m.id, 'dispatched', {}, NOW, TODAY, 't'))).toContain('not_packed')

    const packed = packShipment(full.data, m.id, NOW, 't')
    if (!packed.ok) throw new Error(packed.errors.join())
    expect(packed.value.mode).toBe('on_hand')
    const dispatched = transitionShipment(packed.data, m.id, 'dispatched', {}, NOW, TODAY, 't')
    expect(dispatched.ok).toBe(true)
    if (!dispatched.ok) return
    // Estoque e movimentos idênticos do início ao fim.
    expect(dispatched.data.products).toBe(m.d.products)
    expect(dispatched.data.moves).toBe(m.d.moves)
    expect(dispatched.data.entries).toBe(m.d.entries)
    expect(dispatched.data.shipments[0]?.events.filter((e) => e.kind === 'fulfillment').length).toBe(3)
  })

  test('picking rules: only when ready, valid quantity, frozen after packing', () => {
    const m = make(base())
    expect(errs(pickItem(m.d, m.id, itemId(m.d, m.id), 1, NOW, 't'))).toContain('not_ready')
    const d = step(m.d, m.id, 'ready')
    const id = itemId(d, m.id)
    expect(errs(pickItem(d, m.id, id, 3, NOW, 't'))).toContain('invalid_qty')
    expect(errs(pickItem(d, m.id, id, -1, NOW, 't'))).toContain('invalid_qty')
    expect(errs(pickItem(d, m.id, 'nope', 1, NOW, 't'))).toContain('invalid_item')
    const p = pickItem(d, m.id, id, 2, NOW, 't')
    if (!p.ok) throw new Error('pick')
    const k = packShipment(p.data, m.id, NOW, 't')
    if (!k.ok) throw new Error('pack')
    expect(errs(pickItem(k.data, m.id, id, 1, NOW, 't'))).toContain('already_packed')
    expect(errs(packShipment(k.data, m.id, NOW, 't'))).toContain('already_packed')
  })

  test('shipments without a sale need stock on hand to be packed (validation only)', () => {
    const d0 = base()
    d0.products[0] = { ...d0.products[0]!, stock: 1 }
    const m = make(d0)
    const d = step(m.d, m.id, 'ready')
    const p = pickItem(d, m.id, itemId(d, m.id), 2, NOW, 't')
    if (!p.ok) throw new Error('pick')
    expect(errs(packShipment(p.data, m.id, NOW, 't'))).toContain('insufficient_stock')
  })

  test('a sale-linked shipment never deducts stock again and is capped by the sale', () => {
    const m = make(base(), { orderRef: { kind: 'sale', id: 's1', label: '' }, items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 3 }] })
    let d = step(m.d, m.id, 'ready')
    const p = pickItem(d, m.id, itemId(d, m.id), 3, NOW, 't')
    if (!p.ok) throw new Error('pick')
    const k = packShipment(p.data, m.id, NOW, 't')
    if (!k.ok) throw new Error('pack')
    expect(k.value.mode).toBe('sale_deducted')
    d = step(k.data, m.id, 'dispatched')
    expect(d.products).toBe(m.d.products)
    expect(d.moves).toBe(m.d.moves)

    // Soma das remessas da mesma venda não passa do vendido (5): 3 + 3 = 6.
    const over = createShipment(d, input({ orderRef: { kind: 'sale', id: 's1', label: '' }, items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 3 }] }), NOW, 't')
    expect(errs(over)).toContain('exceeds_order_qty')
    // 3 + 2 = 5 cabe.
    expect(createShipment(d, input({ orderRef: { kind: 'sale', id: 's1', label: '' }, items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 2 }] }), NOW, 't').ok).toBe(true)
    // Produto fora da venda.
    expect(errs(createShipment(d, input({ orderRef: { kind: 'sale', id: 's1', label: '' }, items: [{ productId: 'p2', name: 'Chá', sku: '', qty: 1 }] }), NOW, 't'))).toContain('item_not_in_order')
  })

  test('cancelling a shipment frees its quantity on the sale', () => {
    const m = make(base(), { orderRef: { kind: 'sale', id: 's1', label: '' }, items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 5 }] })
    const full = createShipment(m.d, input({ orderRef: { kind: 'sale', id: 's1', label: '' }, items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 1 }] }), NOW, 't')
    expect(errs(full)).toContain('exceeds_order_qty')
    const cancelled = step(m.d, m.id, 'cancelled')
    expect(createShipment(cancelled, input({ orderRef: { kind: 'sale', id: 's1', label: '' }, items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 1 }] }), NOW, 't').ok).toBe(true)
  })

  test('editing the items discards the previous picking', () => {
    const m = make(base())
    const d = step(m.d, m.id, 'ready')
    const p = pickItem(d, m.id, itemId(d, m.id), 2, NOW, 't')
    if (!p.ok) throw new Error('pick')
    const u = updateShipment(p.data, m.id, input({ items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 3 }] }), NOW, 't')
    expect(u.ok).toBe(true)
    if (!u.ok) return
    expect(u.data.shipments[0]?.fulfillment).toBeUndefined()
    expect(errs(transitionShipment(u.data, m.id, 'dispatched', {}, NOW, TODAY, 't'))).toContain('not_picked')
  })

  test('shipments without inventory items and transfers keep the simple flow', () => {
    const manual = make(base(), { items: [{ name: 'Brinde', sku: '', qty: 1 }] })
    expect(step(step(manual.d, manual.id, 'ready'), manual.id, 'dispatched').shipments[0]?.status).toBe('dispatched')
    const tr = make(base(), { direction: 'transfer' })
    expect(step(step(tr.d, tr.id, 'ready'), tr.id, 'dispatched').shipments[0]?.status).toBe('dispatched')
  })

  test('proof of delivery and closing follow delivery, once, with audit', () => {
    const m = make(base(), { items: [{ name: 'Brinde', sku: '', qty: 1 }] })
    let d = step(step(step(step(step(m.d, m.id, 'ready'), m.id, 'dispatched'), m.id, 'in_transit'), m.id, 'out_for_delivery'), m.id, 'delivered', '', TODAY)
    d = step(m.d, m.id, 'ready')
    expect(errs(recordPod(d, m.id, { receivedBy: 'Ana', reference: '', note: '' }, NOW, 't'))).toContain('not_delivered')
    d = step(step(step(step(d, m.id, 'dispatched'), m.id, 'in_transit'), m.id, 'out_for_delivery'), m.id, 'delivered', '', TODAY)
    expect(errs(closeFulfillment(d, m.id, NOW, 't'))).toContain('pod_required')
    expect(errs(recordPod(d, m.id, { receivedBy: 'A', reference: '', note: '' }, NOW, 't'))).toContain('invalid_name')
    const pod = recordPod(d, m.id, { receivedBy: 'Ana Souza', reference: 'POD-1', note: '' }, NOW, 't')
    if (!pod.ok) throw new Error(pod.errors.join())
    expect(errs(recordPod(pod.data, m.id, { receivedBy: 'Outra', reference: '', note: '' }, NOW, 't'))).toContain('pod_exists')
    const closed = closeFulfillment(pod.data, m.id, NOW, 't')
    if (!closed.ok) throw new Error(closed.errors.join())
    expect(closed.data.shipments[0]?.fulfillment?.closedAt).toBe(NOW)
    expect(errs(closeFulfillment(closed.data, m.id, NOW, 't'))).toContain('already_closed')
    expect(closed.data.products).toBe(m.d.products)
    expect(closed.data.moves).toBe(m.d.moves)
  })
})

describe('inbound receiving: the only place that adds stock', () => {
  const inboundInput = (over: Partial<ShipmentInput> = {}) =>
    input({ direction: 'inbound', senderName: 'Forn A', recipientName: 'X', orderRef: { kind: 'purchase', id: 'PUR-0001', label: '' }, items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 10 }], ...over })
  const deliver = (d: AppData, id: string) => step(step(step(step(step(d, id, 'ready'), id, 'dispatched'), id, 'in_transit'), id, 'out_for_delivery'), id, 'delivered', '', TODAY)
  const lines = (d: AppData, id: string, received: number, damaged = 0) => d.shipments.find((s) => s.id === id)!.items.map((i) => ({ itemId: i.id, receivedQty: received, damagedQty: damaged }))

  test('delivered status alone never changes stock', () => {
    const c = createShipment(base(), inboundInput(), NOW, 't')
    if (!c.ok) throw new Error('create')
    const d = deliver(c.data, c.value.id)
    expect(d.products).toBe(c.data.products)
    expect(d.moves).toBe(c.data.moves)
    expect(alerts(d.shipments, TODAY).some((a) => a.reason === 'awaiting_receipt')).toBe(true)
  })

  test('receiving a purchase that awaited receipt adds only the accepted quantity, once', () => {
    const c = createShipment(base(), inboundInput(), NOW, 't')
    if (!c.ok) throw new Error('create')
    const id = c.value.id
    const d = deliver(c.data, id)

    expect(errs(receiveGoods(d, id, { lines: lines(d, id, 10), notes: '' }, NOW, TODAY, 't'))).toEqual([])
    const r = receiveGoods(d, id, { lines: lines(d, id, 9, 2), notes: 'Duas caixas amassadas e uma faltando' }, NOW, TODAY, 't')
    if (!r.ok) throw new Error(r.errors.join())
    expect(r.value.stockMode).toBe('posted')
    expect(r.value.posted).toEqual([{ productId: 'p1', qty: 7 }])
    const p1 = r.data.products.find((p) => p.id === 'p1')!
    expect(p1.stock).toBe(17) // 10 + (9 - 2)
    expect(p1.cost).toBeCloseTo((10 * 10 + 7 * 12) / 17, 10) // custo médio ponderado móvel (10@10 + 7@12)
    expect(r.data.moves[0]).toMatchObject({ productId: 'p1', kind: 'in', qty: 7 })
    expect(r.data.purchases.find((p) => p.id === 'PUR-0001')).toMatchObject({ stockPosted: true, receiptId: 'GR-0001' })
    expect(r.data.receipts[0]?.lines[0]).toMatchObject({ expectedQty: 10, receivedQty: 9, damagedQty: 2, acceptedQty: 7, discrepancy: 'damaged' })
    expect(r.data.shipments[0]?.receiptId).toBe('GR-0001')

    // Receber de novo não soma nada.
    expect(errs(receiveGoods(r.data, id, { lines: lines(r.data, id, 10), notes: '' }, NOW, TODAY, 't'))).toContain('already_received')
    // A compra já recebida não aceita nova remessa.
    expect(errs(createShipment(r.data, inboundInput(), NOW, 't'))).toContain('purchase_already_received')
  })

  test('purchases already counted by the default flow are confirmed without adding stock', () => {
    const c = createShipment(base(), inboundInput({ orderRef: { kind: 'purchase', id: 'PUR-0002', label: '' }, items: [{ productId: 'p2', name: 'Chá', sku: 'CHA-002', qty: 8 }] }), NOW, 't')
    if (!c.ok) throw new Error(errs(c).join())
    const id = c.value.id
    const d = deliver(c.data, id)
    const r = receiveGoods(d, id, { lines: lines(d, id, 8), notes: '' }, NOW, TODAY, 't')
    if (!r.ok) throw new Error(r.errors.join())
    expect(r.value.stockMode).toBe('already_counted')
    expect(r.value.posted).toEqual([])
    expect(r.data.products).toBe(d.products)
    expect(r.data.moves).toBe(d.moves)
    expect(r.data.purchases).toBe(d.purchases)
  })

  test('without a linked purchase the user must choose, and nothing is assumed', () => {
    const c = createShipment(base(), inboundInput({ orderRef: undefined }), NOW, 't')
    if (!c.ok) throw new Error('create')
    const id = c.value.id
    const d = deliver(c.data, id)
    expect(errs(receiveGoods(d, id, { lines: lines(d, id, 10), notes: '' }, NOW, TODAY, 't'))).toContain('stock_mode_required')
    const counted = receiveGoods(d, id, { lines: lines(d, id, 10), notes: '', stockChoice: 'already_counted' }, NOW, TODAY, 't')
    expect(counted.ok && counted.data.products).toBe(d.products)
    const post = receiveGoods(d, id, { lines: lines(d, id, 10), notes: '', stockChoice: 'post' }, NOW, TODAY, 't')
    if (!post.ok) throw new Error('post')
    expect(post.data.products.find((p) => p.id === 'p1')?.stock).toBe(20)
    expect(post.data.products.find((p) => p.id === 'p1')?.cost).toBe(10) // sem compra, o custo não muda
  })

  test('discrepancies need a note and the checks reject impossible counts', () => {
    const c = createShipment(base(), inboundInput({ orderRef: undefined }), NOW, 't')
    if (!c.ok) throw new Error('create')
    const id = c.value.id
    const d = deliver(c.data, id)
    const go = (received: number, damaged: number, notes: string) => receiveGoods(d, id, { lines: lines(d, id, received, damaged), notes, stockChoice: 'post' }, NOW, TODAY, 't')
    expect(errs(go(8, 0, ''))).toContain('receipt_note_required') // falta
    expect(errs(go(12, 0, ''))).toContain('receipt_note_required') // sobra
    expect(errs(go(8, 0, 'Faltaram duas unidades'))).toEqual([])
    expect(errs(go(-1, 0, 'x nota'))).toContain('invalid_receipt')
    expect(errs(go(5, 6, 'x nota'))).toContain('invalid_receipt')
    expect(errs(receiveGoods(d, id, { lines: [], notes: '', stockChoice: 'post' }, NOW, TODAY, 't'))).toContain('invalid_receipt')
    const over = go(12, 0, 'Chegaram 2 a mais')
    if (!over.ok) throw new Error('over')
    expect(over.data.receipts[0]?.lines[0]?.discrepancy).toBe('over')
  })

  test('only delivered inbound shipments can be received', () => {
    const c = createShipment(base(), inboundInput(), NOW, 't')
    if (!c.ok) throw new Error('create')
    const id = c.value.id
    expect(errs(receiveGoods(c.data, id, { lines: lines(c.data, id, 10), notes: '' }, NOW, TODAY, 't'))).toContain('not_delivered')
    const out = createShipment(base(), input(), NOW, 't')
    if (!out.ok) throw new Error('create')
    expect(errs(receiveGoods(out.data, out.value.id, { lines: [], notes: '' }, NOW, TODAY, 't'))).toContain('not_inbound')
    expect(errs(receiveGoods(c.data, 'nope', { lines: [], notes: '' }, NOW, TODAY, 't'))).toContain('not_found')
  })

  test('purchase links are validated and capped', () => {
    expect(errs(createShipment(base(), inboundInput({ orderRef: { kind: 'purchase', id: 'PUR-9999', label: '' } }), NOW, 't'))).toContain('unknown_purchase')
    expect(errs(createShipment(base(), inboundInput({ items: [{ productId: 'p1', name: 'Café', sku: '', qty: 21 }] }), NOW, 't'))).toContain('exceeds_order_qty')
    expect(errs(createShipment(base(), inboundInput({ items: [{ productId: 'p2', name: 'Chá', sku: '', qty: 1 }] }), NOW, 't'))).toContain('item_not_in_order')
    // Referência de texto continua aceita (sem vínculo).
    expect(createShipment(base(), inboundInput({ orderRef: { kind: 'purchase', label: 'Pedido 77' } }), NOW, 't').ok).toBe(true)
  })
})
