import { describe, expect, test } from 'bun:test'
import { alerts, createShipment, transitionShipment, updateShipment, type ShipmentInput } from '../src/lib/logistics'
import { packShipment, pickItem } from '../src/lib/fulfillment'
import { receiveGoods } from '../src/lib/receiving'
import { createCarrier, estimateFreight, removeCarrier, servesCountry, setCarrierActive, trackingUrl, updateCarrier, type CarrierInput } from '../src/lib/carriers'
import { freightReport, freightTotal, freightVariance, postFreight, setFreight } from '../src/lib/freight'
import { adapterForShipment, countryCode, isInternational, readiness, setInternational, validHs } from '../src/lib/international'
import { authorizeReturn, cancelReturn, createReturnShipment, inspectReturn, rejectReturn, requestReturn, resolveReturn, returnableQty } from '../src/lib/returns'
import { addDocument } from '../src/lib/logistics'
import type { AppData } from '../src/lib/types'

const NOW = '2026-11-21T12:00:00.000Z'
const TODAY = '2026-11-21'

const base = (): AppData =>
  ({
    products: [{ id: 'p1', sku: 'CAF-001', name: 'Café', category: 'x', unit: 'un', cost: 10, price: 20, stock: 10, minStock: 1 }],
    moves: [],
    contacts: [],
    entries: [],
    accounts: [],
    sales: [{ id: 's1', date: TODAY, customerName: 'Ana', items: [{ productId: 'p1', name: 'Café', qty: 5, price: 20, cost: 10 }], total: 100, cogs: 50, method: 'pix' }],
    employees: [],
    treasuryOps: [],
    requests: [],
    shipments: [],
    carriers: [],
    returns: [],
    purchases: [],
    receipts: [],
    settings: { company: 'X', branch: 'Y', owner: 'Z', currency: 'BRL', usdcRate: null, approvalLimit: null },
  }) as unknown as AppData

const input = (over: Partial<ShipmentInput> = {}): ShipmentInput => ({
  direction: 'outbound',
  origin: { name: 'Armazém', city: 'São Paulo', country: 'BR' },
  destination: { name: 'Loja', city: 'Lisboa', country: 'PT' },
  senderName: 'X',
  recipientName: 'Ana',
  carrier: 'Livre',
  trackingNumber: 'AB123456789',
  method: 'Standard',
  packages: [{ weightKg: 2, lengthCm: 10, widthCm: 10, heightCm: 10 }],
  items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 4 }],
  declaredValue: 100,
  currency: 'BRL',
  freightCost: 50,
  estimatedDelivery: '2026-11-25',
  ...over,
})
const errs = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r.errors ?? []))
const carrierInput = (over: Partial<CarrierInput> = {}): CarrierInput => ({
  name: 'Expresso Demo',
  countries: ['BR', 'PT'],
  methods: ['Standard', 'Express'],
  contactName: 'Maria',
  email: 'maria@demo.com',
  phone: '+55 11 99999-0000',
  trackingUrlTemplate: 'https://rastreio.demo.com/?code={tracking}',
  serviceLevels: [{ name: 'Standard', minDays: 3, maxDays: 5 }],
  cost: { currency: 'BRL', baseFee: 20, perKg: 5 },
  active: true,
  ...over,
})
function ok<T>(r: { ok: true; data: AppData; value: T } | { ok: false; errors: string[] }): { d: AppData; v: T } {
  if (!r.ok) throw new Error(r.errors.join())
  return { d: r.data, v: r.value }
}

/** Remessa de saída entregue (separada e embalada antes de despachar). */
function deliveredOutbound(over: Partial<ShipmentInput> = {}, d0 = base()) {
  let { d, v } = ok(createShipment(d0, input(over), NOW, 't'))
  const id = v.id
  const go = (to: Parameters<typeof transitionShipment>[2], delivered?: string) => {
    d = ok(transitionShipment(d, id, to, { note: 'ok nota', deliveredAt: delivered }, NOW, TODAY, 't')).d
  }
  go('ready')
  const ship = d.shipments.find((s) => s.id === id)!
  for (const it of ship.items) if (it.productId) d = ok(pickItem(d, id, it.id, it.qty, NOW, 't')).d
  if (ship.items.some((i) => i.productId)) d = ok(packShipment(d, id, NOW, 't')).d
  go('dispatched')
  go('in_transit')
  go('delivered', TODAY)
  return { d, id }
}

describe('carriers', () => {
  test('creates, validates and rejects duplicates', () => {
    const { d, v } = ok(createCarrier(base(), carrierInput(), NOW))
    expect(v.id).toBe('CAR-0001')
    expect(d.carriers[0]).toMatchObject({ adapter: 'manual', active: true, countries: ['BR', 'PT'] })
    expect(errs(createCarrier(d, carrierInput({ name: ' expresso DEMO ' }), NOW))).toContain('duplicate_carrier')
    expect(errs(createCarrier(base(), carrierInput({ name: 'x' }), NOW))).toContain('invalid_name')
    expect(errs(createCarrier(base(), carrierInput({ email: 'sem-arroba' }), NOW))).toContain('invalid_email')
    expect(errs(createCarrier(base(), carrierInput({ serviceLevels: [{ name: 'A', minDays: 5, maxDays: 2 }] }), NOW))).toContain('invalid_service_level')
    expect(errs(createCarrier(base(), carrierInput({ cost: { currency: 'BRL', baseFee: -1, perKg: 1 } }), NOW))).toContain('invalid_number')
    expect(ok(createCarrier(d, carrierInput({ name: 'Segunda' }), NOW)).v.id).toBe('CAR-0002')
  })

  test('tracking URL templates must be https with {tracking}', () => {
    for (const bad of ['http://x.com/?c={tracking}', 'https://x.com/track', 'javascript:alert({tracking})', 'not a url {tracking}', 'data:text/html,{tracking}']) {
      expect(errs(createCarrier(base(), carrierInput({ trackingUrlTemplate: bad }), NOW))).toContain('invalid_url')
    }
    expect(createCarrier(base(), carrierInput({ trackingUrlTemplate: '' }), NOW).ok).toBe(true)
  })

  test('builds a safe tracking link and an informative estimate', () => {
    const { d } = ok(createCarrier(base(), carrierInput(), NOW))
    const c = d.carriers[0]
    expect(trackingUrl(c, 'AB 12/3')).toBe('https://rastreio.demo.com/?code=AB%2012%2F3')
    expect(trackingUrl(c, '')).toBeNull()
    expect(trackingUrl(undefined, 'X')).toBeNull()
    expect(trackingUrl({ ...c!, trackingUrlTemplate: '' }, 'X')).toBeNull()
    expect(estimateFreight(c, 3)).toEqual({ amount: 35, currency: 'BRL' })
    expect(estimateFreight({ ...c!, cost: undefined }, 3)).toBeNull()
    expect(servesCountry(c!, 'pt')).toBe(true)
    expect(servesCountry(c!, 'JP')).toBe(false)
  })

  test('shipments use registered carriers; inactive ones cannot be newly chosen; used ones cannot be removed', () => {
    const { d: d1, v } = ok(createCarrier(base(), carrierInput(), NOW))
    const made = ok(createShipment(d1, input({ carrier: 'ignorado', carrierId: v.id }), NOW, 't'))
    expect(made.d.shipments[0]).toMatchObject({ carrier: 'Expresso Demo', carrierId: v.id })
    expect(errs(createShipment(d1, input({ carrierId: 'CAR-9999' }), NOW, 't'))).toContain('unknown_carrier')

    const off = ok(setCarrierActive(made.d, v.id, false, NOW)).d
    expect(errs(createShipment(off, input({ carrierId: v.id }), NOW, 't'))).toContain('inactive_carrier')
    // A remessa que já usa a transportadora continua editável.
    expect(updateShipment(off, made.v.id, input({ carrierId: v.id, freightCost: 60 }), NOW, 't').ok).toBe(true)
    expect(errs(removeCarrier(off, v.id))).toContain('carrier_in_use')
    expect(removeCarrier(d1, v.id).ok).toBe(true)
    // Editar o cadastro não reescreve o histórico das remessas.
    const renamed = ok(updateCarrier(made.d, v.id, carrierInput({ name: 'Novo Nome' }), NOW)).d
    expect(renamed.shipments[0]?.carrier).toBe('Expresso Demo')
  })
})

describe('freight costs', () => {
  test('total and variance include insurance and fees', () => {
    const { d, v } = ok(createShipment(base(), input(), NOW, 't'))
    const r = ok(setFreight(d, v.id, { freightCost: 50, estimated: 45, insurance: 5, fees: [{ label: 'Taxa de combustível', amount: 10 }] }, NOW, 't'))
    const s = r.d.shipments[0]!
    expect(r.v.total).toBe(65)
    expect(freightTotal(s)).toBe(65)
    expect(freightVariance(s)).toBe(20)
    expect(freightVariance({ freightCost: 10, freight: { insurance: 0, fees: [] } })).toBeNull()
    expect(s.events.at(-1)).toMatchObject({ kind: 'edit', fields: ['freight'] })
    expect(errs(setFreight(d, v.id, { freightCost: -1, insurance: 0, fees: [] }, NOW, 't'))).toContain('invalid_number')
    expect(errs(setFreight(d, v.id, { freightCost: 1, insurance: 0, fees: [{ label: '', amount: 3 }] }, NOW, 't'))).toContain('invalid_name')
  })

  test('posting creates one payable and never duplicates', () => {
    const { d, id } = deliveredOutbound({}, base())
    const withCosts = ok(setFreight(d, id, { freightCost: 50, insurance: 5, fees: [] }, NOW, 't')).d
    const posted = ok(postFreight(withCosts, id, { dueDate: '2026-12-10' }, NOW, 'BRL', 't'))
    expect(posted.v.amount).toBe(55)
    expect(posted.d.accounts).toHaveLength(1)
    expect(posted.d.accounts[0]).toMatchObject({ kind: 'payable', category: 'Logística', amount: 55, status: 'open', dueDate: '2026-12-10' })
    expect(posted.d.shipments.find((s) => s.id === id)?.freight?.postedAccountId).toBe(posted.d.accounts[0]?.id)
    // Duas vezes não lança duas vezes.
    expect(errs(postFreight(posted.d, id, { dueDate: '2026-12-10' }, NOW, 'BRL', 't'))).toContain('already_posted')
    // Valores travados depois de lançados.
    expect(errs(setFreight(posted.d, id, { freightCost: 99, insurance: 0, fees: [] }, NOW, 't'))).toContain('freight_posted')
    // Sem impacto no estoque.
    expect(posted.d.products).toBe(withCosts.products)
    // Se a conta for removida pelo usuário, é possível lançar de novo.
    const removed = { ...posted.d, accounts: [] }
    expect(postFreight(removed, id, { dueDate: '2026-12-10' }, NOW, 'BRL', 't').ok).toBe(true)
  })

  test('posting guards: currency, empty cost, status and date', () => {
    const { d, v } = ok(createShipment(base(), input({ currency: 'USD' }), NOW, 't'))
    expect(errs(postFreight(d, v.id, { dueDate: '2026-12-10' }, NOW, 'BRL', 't'))).toContain('not_allowed') // rascunho
    const del = deliveredOutbound({ currency: 'USD' })
    expect(errs(postFreight(del.d, del.id, { dueDate: '2026-12-10' }, NOW, 'BRL', 't'))).toContain('currency_mismatch')
    const free = deliveredOutbound({ freightCost: 0 })
    expect(errs(postFreight(free.d, free.id, { dueDate: '2026-12-10' }, NOW, 'BRL', 't'))).toContain('nothing_to_post')
    const ok1 = deliveredOutbound({})
    expect(errs(postFreight(ok1.d, ok1.id, { dueDate: '10/12/2026' }, NOW, 'BRL', 't'))).toContain('invalid_date')
  })

  test('editing the freight on the form is blocked after posting, other fields still change', () => {
    const { d: d0, v } = ok(createShipment(base(), input(), NOW, 't'))
    let d = ok(transitionShipment(d0, v.id, 'ready', {}, NOW, TODAY, 't')).d
    d = ok(postFreight(d, v.id, { dueDate: '2026-12-10' }, NOW, 'BRL', 't')).d
    expect(errs(updateShipment(d, v.id, input({ freightCost: 77 }), NOW, 't'))).toContain('freight_posted')
    expect(updateShipment(d, v.id, input({ method: 'Express' }), NOW, 't').ok).toBe(true)
  })

  test('cost report groups by carrier and currency, skipping cancelled, empty and old shipments', () => {
    let d = base()
    const mk = (over: Partial<ShipmentInput>, at = NOW) => {
      const r = ok(createShipment(d, input(over), at, 't'))
      d = r.d
      return r.v.id
    }
    const a = mk({ carrier: 'Alfa', freightCost: 100 })
    mk({ carrier: 'Alfa', freightCost: 50 })
    mk({ carrier: 'Beta', freightCost: 30, currency: 'USD' })
    mk({ carrier: 'Alfa', freightCost: 0 })
    mk({ carrier: 'Alfa', freightCost: 999 }, '2026-01-01T09:00:00.000Z')
    const c = mk({ carrier: 'Alfa', freightCost: 40 })
    d = ok(transitionShipment(d, c, 'cancelled', { note: 'teste ok' }, NOW, TODAY, 't')).d
    d = ok(setFreight(d, a, { freightCost: 100, estimated: 90, insurance: 10, fees: [] }, NOW, 't')).d

    const rep = freightReport(d.shipments, '2026-11-01')
    expect(rep.rows).toHaveLength(3)
    expect(rep.byCarrier.find((x) => x.carrier === 'Alfa')).toMatchObject({ currency: 'BRL', count: 2, total: 160, average: 80 })
    expect(rep.totals.BRL).toMatchObject({ total: 160, estimated: 90, withEstimate: 1, totalWithEstimate: 110 })
    expect(rep.totals.USD?.total).toBe(30)
    expect(rep.rows.find((r) => r.shipment.id === a)?.variance).toBe(20)
    expect(freightReport(d.shipments, '').rows).toHaveLength(4)
  })
})

describe('international', () => {
  test('country codes, border crossing and adapters', () => {
    expect(countryCode('Brasil')).toBe('BR')
    expect(countryCode(' Estados Unidos ')).toBe('US')
    expect(countryCode('pt')).toBe('PT')
    expect(countryCode('Atlântida')).toBe('ATLANTIDA')
    const s = ok(createShipment(base(), input(), NOW, 't')).d.shipments[0]!
    expect(isInternational(s)).toBe(true)
    expect(isInternational({ origin: { name: '', city: 'a', country: 'Brasil' }, destination: { name: '', city: 'b', country: 'BR' } })).toBe(false)
    expect(isInternational({ origin: { name: '', city: 'a', country: '' }, destination: { name: '', city: 'b', country: 'BR' } })).toBe(false)
    expect(adapterForShipment(s).code).toBe('BR') // Brasil tem NCM de 8 dígitos
    expect(adapterForShipment({ origin: { name: '', city: '', country: 'PT' }, destination: { name: '', city: '', country: 'US' } }).code).toBe('GEN')
    expect(validHs('0901.21.00', adapterForShipment(s))).toBe(true)
    expect(validHs('090121', adapterForShipment(s))).toBe(false)
    expect(validHs('0901.21', { code: 'GEN', name: '', digits: [6, 8, 10], hint: '' })).toBe(true)
    expect(validHs('abc', { code: 'GEN', name: '', digits: [6], hint: '' })).toBe(false)
  })

  test('saves manual data only for cross-border shipments and validates HS codes', () => {
    const { d, v } = ok(createShipment(base(), input(), NOW, 't'))
    const itemId = d.shipments[0]!.items[0]!.id
    const data = { incoterm: 'DAP' as const, customsRef: 'DU-123', importExportRef: 'LI-9', dutiesAmount: 12.5, taxesAmount: 3, hsCodes: { [itemId]: '0901.21.00' } }
    const r = ok(setInternational(d, v.id, data, NOW, 't'))
    const s = r.d.shipments[0]!
    expect(s.international).toEqual({ incoterm: 'DAP', customsRef: 'DU-123', importExportRef: 'LI-9', dutiesAmount: 12.5, taxesAmount: 3 })
    expect(s.items[0]?.hsCode).toBe('09012100')
    expect(s.events.at(-1)).toMatchObject({ kind: 'edit', fields: ['international'] })
    expect(errs(setInternational(d, v.id, { ...data, hsCodes: { [itemId]: '1234' } }, NOW, 't'))).toContain('invalid_hs')
    expect(errs(setInternational(d, v.id, { ...data, incoterm: 'XYZ' as never }, NOW, 't'))).toContain('invalid_incoterm')
    expect(errs(setInternational(d, v.id, { ...data, dutiesAmount: -1 }, NOW, 't'))).toContain('invalid_number')
    // Doméstica: recusa.
    const dom = ok(createShipment(base(), input({ destination: { name: '', city: 'Recife', country: 'BR' } }), NOW, 't'))
    expect(errs(setInternational(dom.d, dom.v.id, data, NOW, 't'))).toContain('not_international')
    // Nada é calculado: valores ficam exatamente como informados.
    expect(r.d.products).toBe(d.products)
    expect(r.d.accounts).toBe(d.accounts)
  })

  test('readiness is only a reminder checklist driven by recorded data', () => {
    const { d, v } = ok(createShipment(base(), input(), NOW, 't'))
    const keys = (x: AppData) => Object.fromEntries(readiness(x.shipments[0]!).map((r) => [r.key, r.ok]))
    expect(Object.values(keys(d)).some(Boolean)).toBe(false)
    const itemId = d.shipments[0]!.items[0]!.id
    let cur = ok(setInternational(d, v.id, { incoterm: 'FOB', customsRef: 'DU-1', importExportRef: '', dutiesAmount: 0, taxesAmount: 0, hsCodes: { [itemId]: '09012100' } }, NOW, 't')).d
    cur = ok(addDocument(cur, v.id, { type: 'invoice', reference: 'INV-1' }, NOW, 't')).d
    expect(keys(cur)).toEqual({ incoterm: true, hs_codes: true, commercial_invoice: true, packing_list: false, customs_ref: true })
  })
})

describe('returns (reverse logistics)', () => {
  test('request rules: delivered outbound only, quantity cap, reason required', () => {
    const { d, id } = deliveredOutbound()
    const itemId = d.shipments.find((s) => s.id === id)!.items[0]!.id
    const req = (qty: number, reason = 'Produto errado', dd = d) => requestReturn(dd, { shipmentId: id, lines: [{ itemId, qty }], reason }, NOW, 't')
    expect(errs(req(1, ''))).toContain('note_required')
    expect(errs(req(0))).toContain('invalid_item')
    expect(errs(req(5))).toContain('exceeds_returnable') // enviados 4
    const a = ok(req(3))
    expect(a.v.id).toBe('RMA-0001')
    expect(returnableQty(a.d, id, itemId)).toBe(1)
    expect(errs(req(2, 'Outro', a.d))).toContain('exceeds_returnable')
    expect(req(1, 'Outro', a.d).ok).toBe(true)
    // Recusar libera a quantidade.
    const rej = ok(rejectReturn(a.d, 'RMA-0001', 'Fora do prazo', NOW, 't')).d
    expect(returnableQty(rej, id, itemId)).toBe(4)
    // Remessa que não foi entregue ou não é de saída.
    const draft = ok(createShipment(base(), input(), NOW, 't'))
    expect(errs(requestReturn(draft.d, { shipmentId: draft.v.id, lines: [{ itemId: 'x', qty: 1 }], reason: 'Teste ok' }, NOW, 't'))).toContain('not_delivered')
    expect(errs(requestReturn(d, { shipmentId: 'nope', lines: [], reason: 'Teste ok' }, NOW, 't'))).toContain('not_found')
  })

  test('status flow with audit: authorize, reject needs a reason, cancel', () => {
    const { d, id } = deliveredOutbound()
    const itemId = d.shipments.find((s) => s.id === id)!.items[0]!.id
    const a = ok(requestReturn(d, { shipmentId: id, lines: [{ itemId, qty: 1 }], reason: 'Defeito' }, NOW, 't')).d
    expect(errs(rejectReturn(a, 'RMA-0001', '', NOW, 't'))).toContain('note_required')
    const auth = ok(authorizeReturn(a, 'RMA-0001', '', NOW, 't')).d
    expect(auth.returns[0]?.status).toBe('authorized')
    expect(errs(authorizeReturn(auth, 'RMA-0001', '', NOW, 't'))).toContain('not_allowed')
    expect(errs(resolveReturn(auth, 'RMA-0001', { kind: 'none', reference: '', note: '' }, NOW, 't'))).toContain('not_allowed')
    const cancelled = ok(cancelReturn(auth, 'RMA-0001', 'Cliente desistiu', NOW, 't')).d
    expect(cancelled.returns[0]?.status).toBe('cancelled')
    expect(cancelled.returns[0]?.events.map((e) => e.action)).toEqual(['requested', 'authorized', 'cancelled'])
    expect(errs(cancelReturn(cancelled, 'RMA-0001', '', NOW, 't'))).toContain('not_allowed')
  })

  test('the return shipment cannot be received normally, so nothing is restocked uninspected', () => {
    const { d, id } = deliveredOutbound()
    const itemId = d.shipments.find((s) => s.id === id)!.items[0]!.id
    let cur = ok(requestReturn(d, { shipmentId: id, lines: [{ itemId, qty: 2 }], reason: 'Defeito' }, NOW, 't')).d
    expect(errs(createReturnShipment(cur, 'RMA-0001', NOW, 't'))).toContain('not_allowed') // ainda não autorizada
    cur = ok(authorizeReturn(cur, 'RMA-0001', '', NOW, 't')).d
    const made = ok(createReturnShipment(cur, 'RMA-0001', NOW, 't'))
    cur = made.d
    const ret = cur.shipments.find((s) => s.id === made.v.shipmentId)!
    expect(ret).toMatchObject({ direction: 'inbound', returnId: 'RMA-0001', senderName: 'Ana' })
    expect(ret.origin.city).toBe('Lisboa')
    expect(errs(createReturnShipment(cur, 'RMA-0001', NOW, 't'))).toContain('not_allowed') // só uma
    // Leva a remessa de retorno até entregue e tenta o recebimento comum.
    const rid = ret.id
    for (const to of ['ready', 'dispatched', 'in_transit', 'delivered'] as const) {
      if (to === 'dispatched') cur = { ...cur, shipments: cur.shipments.map((s) => (s.id === rid ? { ...s, carrier: 'Retorno' } : s)) }
      cur = ok(transitionShipment(cur, rid, to, { note: 'ok nota', deliveredAt: TODAY }, NOW, TODAY, 't')).d
    }
    const lines = cur.shipments.find((s) => s.id === rid)!.items.map((i) => ({ itemId: i.id, receivedQty: i.qty, damagedQty: 0 }))
    expect(errs(receiveGoods(cur, rid, { lines, notes: '', stockChoice: 'post' }, NOW, TODAY, 't'))).toContain('return_shipment')
    expect(alerts(cur.shipments, TODAY).some((a) => a.shipment.id === rid && a.reason === 'awaiting_receipt')).toBe(false)
    expect(cur.products).toBe(d.products)
  })

  test('inspection: explicit decisions, restock only good items, once, stock via inventory moves', () => {
    const { d, id } = deliveredOutbound()
    const itemId = d.shipments.find((s) => s.id === id)!.items[0]!.id
    let cur = ok(requestReturn(d, { shipmentId: id, lines: [{ itemId, qty: 3 }], reason: 'Cliente devolveu' }, NOW, 't')).d
    const insp = (over: Partial<{ receivedQty: number; condition: 'good' | 'damaged' | 'defective'; decision: 'restock' | 'discard' | 'return_to_supplier' }>, notes = '') =>
      inspectReturn(cur, 'RMA-0001', { lines: [{ itemId, receivedQty: 3, condition: 'good', decision: 'restock', ...over }], notes }, NOW, TODAY, 't')
    expect(errs(insp({}))).toContain('not_allowed') // precisa estar autorizada
    cur = ok(authorizeReturn(cur, 'RMA-0001', '', NOW, 't')).d

    expect(errs(insp({ decision: undefined }))).toContain('decision_required')
    expect(errs(insp({ condition: 'damaged', decision: 'restock' }, 'Caixa rasgada'))).toContain('restock_not_allowed')
    expect(errs(insp({ condition: 'defective', decision: 'restock' }, 'Não liga'))).toContain('restock_not_allowed')
    expect(errs(insp({ receivedQty: 4 }))).toContain('invalid_qty')
    expect(errs(insp({ receivedQty: 2 }))).toContain('receipt_note_required') // faltou 1
    expect(errs(insp({ condition: 'damaged', decision: 'discard' }))).toContain('receipt_note_required')
    expect(errs(inspectReturn(cur, 'RMA-0001', { lines: [], notes: '' }, NOW, TODAY, 't'))).toContain('invalid_receipt')

    const stock0 = cur.products[0]!.stock
    const done = ok(insp({}))
    expect(done.v.restocked).toEqual([{ productId: 'p1', qty: 3 }])
    expect(done.d.products[0]?.stock).toBe(stock0 + 3)
    expect(done.d.moves[0]).toMatchObject({ productId: 'p1', kind: 'in', qty: 3, note: `RMA-0001 · ${id}` })
    expect(done.d.returns[0]?.status).toBe('inspected')
    // Inspecionar duas vezes não soma de novo.
    expect(errs(inspectReturn(done.d, 'RMA-0001', { lines: [{ itemId, receivedQty: 3, condition: 'good', decision: 'restock' }], notes: '' }, NOW, TODAY, 't'))).toContain('not_allowed')

    // Danificado e descartado: estoque intacto.
    const bad = ok(insp({ condition: 'damaged', decision: 'discard' }, 'Chegou quebrado'))
    expect(bad.d.products).toBe(cur.products)
    expect(bad.v.restocked).toEqual([])
    // Nada recebido: não exige decisão.
    expect(insp({ receivedQty: 0, decision: undefined }, 'Nada chegou').ok).toBe(true)
  })

  test('waits for the return shipment to arrive and then closes with a recorded resolution', () => {
    const { d, id } = deliveredOutbound()
    const itemId = d.shipments.find((s) => s.id === id)!.items[0]!.id
    let cur = ok(requestReturn(d, { shipmentId: id, lines: [{ itemId, qty: 1 }], reason: 'Defeito' }, NOW, 't')).d
    cur = ok(authorizeReturn(cur, 'RMA-0001', '', NOW, 't')).d
    const rs = ok(createReturnShipment(cur, 'RMA-0001', NOW, 't'))
    cur = rs.d
    const lines = [{ itemId, receivedQty: 1, condition: 'good' as const, decision: 'restock' as const }]
    expect(errs(inspectReturn(cur, 'RMA-0001', { lines, notes: '' }, NOW, TODAY, 't'))).toContain('return_not_arrived')
    cur = { ...cur, shipments: cur.shipments.map((s) => (s.id === rs.v.shipmentId ? { ...s, status: 'delivered' } : s)) }
    cur = ok(inspectReturn(cur, 'RMA-0001', { lines, notes: '' }, NOW, TODAY, 't')).d

    const accounts = cur.accounts
    const entries = cur.entries
    expect(errs(resolveReturn(cur, 'RMA-0001', { kind: 'refund', reference: '', note: '' }, NOW, 't'))).toContain('invalid_resolution')
    expect(errs(resolveReturn(cur, 'RMA-0001', { kind: 'x' as never, reference: 'R', note: '' }, NOW, 't'))).toContain('invalid_resolution')
    const closed = ok(resolveReturn(cur, 'RMA-0001', { kind: 'refund', reference: 'EST-77', note: 'Estorno via Pix' }, NOW, 't')).d
    expect(closed.returns[0]).toMatchObject({ status: 'closed', resolution: { kind: 'refund', reference: 'EST-77' } })
    // O reembolso é só registrado: o financeiro não é alterado automaticamente.
    expect(closed.accounts).toBe(accounts)
    expect(closed.entries).toBe(entries)
    expect(errs(resolveReturn(closed, 'RMA-0001', { kind: 'none', reference: '', note: '' }, NOW, 't'))).toContain('not_allowed')
  })
})
