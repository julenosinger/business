import { describe, expect, test } from 'bun:test'
import { createShipment, type ShipmentInput } from '../src/lib/logistics'
import { addTrackingEvent } from '../src/lib/logistics'
import { carrierPerformance, delayRisks, exceptionSummaries, forecast, freightAnalysis, incomingByProduct, reorderSuggestions } from '../src/lib/analytics'
import { ingestCarrierEvents, signWebhook, verifyWebhook, type NormalizedCarrierEvent } from '../src/lib/carrier-events'
import { buildSnapshot, rulesProvider, runInsights, sanitizeInsights, type LogisticsAiProvider } from '../src/lib/logistics-ai'
import type { AppData, Shipment, ShipmentEvent } from '../src/lib/types'

const NOW = '2026-11-21T12:00:00.000Z'
const TODAY = '2026-11-21'

const base = (): AppData =>
  ({
    products: [
      { id: 'p1', sku: 'CAF-001', name: 'Café', category: 'x', unit: 'un', cost: 10, price: 20, stock: 3, minStock: 10 },
      { id: 'p2', sku: 'CHA-002', name: 'Chá', category: 'x', unit: 'un', cost: 5, price: 9, stock: 50, minStock: 10 },
    ],
    moves: [],
    contacts: [],
    entries: [],
    accounts: [],
    sales: [],
    employees: [],
    treasuryOps: [],
    requests: [],
    shipments: [],
    carriers: [{ id: 'CAR-0001', orgId: 'local', name: 'Alfa', adapter: 'manual', countries: [], methods: [], contactName: 'Maria Souza', email: 'maria@alfa.com', phone: '+5511999990000', trackingUrlTemplate: '', serviceLevels: [], active: true, createdAt: NOW, updatedAt: NOW }],
    returns: [],
    purchases: [],
    receipts: [],
    settings: { company: 'X', branch: 'Y', owner: 'Z', currency: 'BRL', usdcRate: null, approvalLimit: null },
  }) as unknown as AppData

const input = (over: Partial<ShipmentInput> = {}): ShipmentInput => ({
  direction: 'transfer',
  origin: { name: 'Armazém Secreto', city: 'São Paulo', country: 'BR' },
  destination: { name: 'Loja', city: 'Lisboa', country: 'PT' },
  senderName: 'Remetente Fulano',
  recipientName: 'Maria Silva',
  carrier: 'Alfa',
  trackingNumber: 'AB123456789',
  method: 'Standard',
  packages: [{ weightKg: 2, lengthCm: 10, widthCm: 10, heightCm: 10 }],
  items: [{ name: 'Item', sku: '', qty: 1 }],
  declaredValue: 100,
  currency: 'BRL',
  freightCost: 20,
  estimatedDelivery: '2026-11-25',
  ...over,
})

/** Cria uma remessa e ajusta direto os campos que as análises leem. */
function put(d: AppData, over: Partial<ShipmentInput>, patch: Partial<Shipment> = {}, createdAt = NOW): { d: AppData; id: string } {
  const r = createShipment(d, input(over), createdAt, 't')
  if (!r.ok) throw new Error(r.errors.join())
  const id = r.value.id
  return { d: { ...r.data, shipments: r.data.shipments.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, id }
}
const status = (to: Shipment['status'], at: string, note = ''): ShipmentEvent => ({ id: `e-${to}-${at}`, kind: 'status', at, toStatus: to, description: note, source: 'manual', actor: 't' })

describe('carrier performance', () => {
  test('rates, transit time, problems and average cost per currency', () => {
    let d = base()
    const add = (over: Partial<ShipmentInput>, patch: Partial<Shipment>) => {
      const r = put(d, over, patch)
      d = r.d
    }
    const ev = (days: string) => [status('dispatched', `${days}T09:00:00.000Z`)]
    add({ carrier: 'Alfa', estimatedDelivery: '2026-11-10' }, { status: 'delivered', deliveredAt: '2026-11-09', events: ev('2026-11-06') }) // no prazo, 3 dias
    add({ carrier: 'Alfa', estimatedDelivery: '2026-11-10' }, { status: 'delivered', deliveredAt: '2026-11-10', events: ev('2026-11-08') }) // no prazo, 2 dias
    add({ carrier: 'Alfa', estimatedDelivery: '2026-11-10' }, { status: 'delivered', deliveredAt: '2026-11-13', events: [...ev('2026-11-05'), status('delayed', '2026-11-11T09:00:00.000Z', 'chuva')] }) // atrasada, 8 dias, teve problema
    add({ carrier: 'Alfa', estimatedDelivery: '2026-12-10' }, { status: 'exception', events: [...ev('2026-11-15'), status('exception', '2026-11-16T09:00:00.000Z', 'endereço')] })
    add({ carrier: 'Beta', estimatedDelivery: '2026-11-10', currency: 'USD', freightCost: 40 }, { status: 'delivered', deliveredAt: '2026-11-10', events: ev('2026-11-09') })
    add({ carrier: 'Alfa' }, { status: 'draft' }) // rascunho não conta
    add({ carrier: 'Alfa' }, { status: 'cancelled' }) // cancelada não conta
    add({ carrier: 'Gama', estimatedDelivery: undefined }, { status: 'delivered', deliveredAt: '2026-11-10', events: ev('2026-11-09') }) // sem previsão: sem taxa

    const rows = carrierPerformance(d.shipments, '')
    const alfa = rows.find((r) => r.carrier === 'Alfa')!
    expect(alfa).toMatchObject({ handled: 4, delivered: 3, onTimeSample: 3, withProblems: 2 })
    expect(alfa.onTimeRate).toBeCloseTo(66.67, 1)
    expect(alfa.avgTransitDays).toBeCloseTo(4.33, 1)
    expect(alfa.problemRate).toBe(50)
    expect(alfa.avgCost).toEqual({ BRL: 20 })
    expect(rows.find((r) => r.carrier === 'Beta')).toMatchObject({ onTimeRate: 100, avgCost: { USD: 40 } })
    expect(rows.find((r) => r.carrier === 'Gama')?.onTimeRate).toBeNull()
    expect(rows.map((r) => r.carrier)).toEqual(['Beta', 'Alfa', 'Gama']) // melhor taxa primeiro, sem dados por último
    expect(carrierPerformance(d.shipments, '2027-01-01')).toEqual([])
  })
})

describe('delay risks (rules, not predictions)', () => {
  test('flags exception, overdue, stalled and due-soon shipments with severity', () => {
    let d = base()
    const add = (over: Partial<ShipmentInput>, patch: Partial<Shipment>) => {
      const r = put(d, over, patch, '2026-11-01T09:00:00.000Z')
      d = r.d
      return r.id
    }
    const old = (days: string) => [{ ...status('dispatched', `${days}T09:00:00.000Z`) }]
    const exc = add({ estimatedDelivery: '2026-12-30' }, { status: 'exception', updatedAt: NOW, events: old('2026-11-20') })
    const over = add({ estimatedDelivery: '2026-11-15' }, { status: 'in_transit', updatedAt: NOW, events: old('2026-11-20') })
    const stalled = add({ estimatedDelivery: '2026-12-30' }, { status: 'in_transit', updatedAt: '2026-11-16T09:00:00.000Z', events: old('2026-11-16') })
    const soon = add({ estimatedDelivery: '2026-11-22' }, { status: 'in_transit', updatedAt: NOW, events: old('2026-11-20') })
    const out = add({ estimatedDelivery: '2026-11-22' }, { status: 'out_for_delivery', updatedAt: NOW, events: old('2026-11-20') }) // já saiu para entrega
    add({ estimatedDelivery: '2026-11-10' }, { status: 'ready', updatedAt: NOW }) // pronta: fora
    add({ estimatedDelivery: '2026-11-10' }, { status: 'delivered', deliveredAt: '2026-11-10' }) // entregue: fora
    add({ estimatedDelivery: '2026-11-10' }, { status: 'draft' }) // rascunho: fora

    const risks = delayRisks(d.shipments, TODAY)
    const by = (id: string) => risks.find((r) => r.shipment.id === id)
    expect(by(exc)).toMatchObject({ severity: 'critical', reasons: ['exception'] })
    expect(by(over)?.reasons).toContain('overdue')
    expect(by(over)?.severity).toBe('critical')
    expect(by(stalled)).toMatchObject({ severity: 'warning', reasons: ['stalled'], idleDays: 5 })
    expect(by(soon)).toMatchObject({ severity: 'warning', reasons: ['due_soon'] })
    expect(by(out)).toBeUndefined()
    expect(risks).toHaveLength(4)
    expect(risks.slice(0, 2).every((r) => r.severity === 'critical')).toBe(true) // críticas primeiro
  })

  test('exception summaries are factual: since when, reason entered and last tracking', () => {
    let d = base()
    const r1 = put(d, { estimatedDelivery: '2026-12-30' }, { status: 'exception', events: [status('exception', '2026-11-18T10:00:00.000Z', 'Endereço não localizado')] })
    d = r1.d
    const r2 = put(d, { estimatedDelivery: '2026-11-10' }, { status: 'in_transit', events: [status('in_transit', '2026-11-09T10:00:00.000Z')] })
    d = r2.d
    const sum = exceptionSummaries(d.shipments, TODAY)
    expect(sum).toHaveLength(2)
    expect(sum.find((s) => s.shipment.id === r1.id)).toMatchObject({ state: 'exception', since: '2026-11-18', daysOpen: 3, note: 'Endereço não localizado' })
    expect(sum.find((s) => s.shipment.id === r2.id)).toMatchObject({ state: 'overdue', since: '2026-11-10', daysOpen: 11, note: '' })
    expect(sum[0]?.daysOpen).toBeGreaterThanOrEqual(sum[1]?.daysOpen ?? 0)
  })
})

describe('freight analysis', () => {
  test('cost per kg, lanes, overruns and share of declared value', () => {
    let d = base()
    const add = (over: Partial<ShipmentInput>, patch: Partial<Shipment> = {}) => {
      d = put(d, over, patch).d
    }
    add({ carrier: 'Alfa', freightCost: 40, packages: [{ weightKg: 4, lengthCm: 1, widthCm: 1, heightCm: 1 }], declaredValue: 400 }, { freight: { estimated: 30, insurance: 0, fees: [] } })
    add({ carrier: 'Alfa', freightCost: 20, packages: [{ weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 }], declaredValue: 100 })
    add({ carrier: 'Beta', freightCost: 100, packages: [{ weightKg: 5, lengthCm: 1, widthCm: 1, heightCm: 1 }], destination: { name: '', city: 'Recife', country: 'Brasil' }, declaredValue: 500 })
    add({ carrier: 'Beta', freightCost: 50, currency: 'USD', packages: [], declaredValue: 0 })
    add({ carrier: 'Beta', freightCost: 999 }, { status: 'cancelled' })
    add({ carrier: 'Beta', freightCost: 0 })

    const a = freightAnalysis(d.shipments, '')
    expect(a.perKg).toEqual([
      { carrier: 'Alfa', currency: 'BRL', costPerKg: 12, shipments: 2, kg: 5 }, // 60 / 5
      { carrier: 'Beta', currency: 'BRL', costPerKg: 20, shipments: 1, kg: 5 },
    ])
    expect(a.lanes.find((l) => l.lane === 'BR → PT' && l.currency === 'BRL')).toMatchObject({ shipments: 2, total: 60 })
    expect(a.lanes.find((l) => l.lane === 'BR → BR')).toMatchObject({ total: 100 })
    expect(a.lanes.find((l) => l.currency === 'USD')?.total).toBe(50)
    expect(a.overruns).toHaveLength(1)
    expect(a.overruns[0]?.variance).toBe(10)
    expect(a.shareOfValue).toEqual([{ currency: 'BRL', percent: 16 }]) // 160 / 1000, USD sem valor declarado fica de fora
    expect(freightAnalysis(d.shipments, '2027-01-01').lanes).toEqual([])
  })
})

describe('reorder suggestions', () => {
  test('counts only purchases waiting for receipt as incoming and suggests up to twice the minimum', () => {
    const d = base()
    d.purchases = [
      { id: 'PUR-0001', date: TODAY, supplierName: 'F', items: [{ productId: 'p1', name: 'Café', sku: '', qty: 4, cost: 1 }], total: 4, stockPosted: false, createdAt: NOW },
      { id: 'PUR-0002', date: TODAY, supplierName: 'F', items: [{ productId: 'p1', name: 'Café', sku: '', qty: 100, cost: 1 }], total: 100, stockPosted: true, createdAt: NOW }, // já somada
      { id: 'PUR-0003', date: TODAY, supplierName: 'F', items: [{ productId: 'p1', name: 'Café', sku: '', qty: 100, cost: 1 }], total: 100, stockPosted: false, receiptId: 'GR-1', createdAt: NOW }, // já recebida
    ]
    expect(incomingByProduct(d).get('p1')).toBe(4)
    const s = reorderSuggestions(d)
    expect(s).toEqual([{ productId: 'p1', name: 'Café', sku: 'CAF-001', stock: 3, minStock: 10, incoming: 4, suggested: 13 }]) // 20 - (3 + 4)
    d.purchases[0] = { ...d.purchases[0]!, items: [{ productId: 'p1', name: 'Café', sku: '', qty: 7, cost: 1 }] }
    expect(reorderSuggestions(d)).toEqual([]) // 3 + 7 chega ao mínimo
    // Produto sem mínimo nunca entra.
    d.products[0] = { ...d.products[0]!, minStock: 0 }
    expect(reorderSuggestions(base())).toHaveLength(1)
  })
})

describe('forecast', () => {
  const at = (daysAgo: number) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - daysAgo * 86_400_000).toISOString()
  test('needs enough history and then repeats the 4-week average', () => {
    let d = base()
    expect(forecast(d.shipments, TODAY).sufficient).toBe(false)
    // 2 remessas por semana durante 5 semanas = 10.
    for (let w = 0; w < 5; w++) for (let k = 0; k < 2; k++) d = put(d, {}, {}, at(w * 7 + k)).d
    const f = forecast(d.shipments, TODAY)
    expect(f.sufficient).toBe(true)
    expect(f.history).toHaveLength(8)
    expect(f.history.slice(-5)).toEqual([2, 2, 2, 2, 2])
    expect(f.average).toBe(2)
    expect(f.projection).toEqual([2, 2, 2, 2])
    // Pouca história: sem projeção.
    const few = forecast(base().shipments.concat(put(base(), {}).d.shipments), TODAY)
    expect(few.sufficient).toBe(false)
    expect(few.projection).toEqual([])
  })
})

// ---------- Webhooks de transportadoras ----------

describe('signed carrier webhooks (interface only)', () => {
  const secret = 'segredo-compartilhado'
  const body = JSON.stringify({ events: [{ id: '1' }] })

  test('verifies HMAC-SHA256 signatures and rejects everything else', async () => {
    const sig = await signWebhook(secret, body)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
    // Vetor conhecido (RFC 4231, caso 2).
    expect(await signWebhook('Jefe', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
    expect(await verifyWebhook({ secret, body, signature: sig })).toBe(true)
    expect(await verifyWebhook({ secret, body, signature: sig.toUpperCase() })).toBe(true)
    expect(await verifyWebhook({ secret: 'outro', body, signature: sig })).toBe(false)
    expect(await verifyWebhook({ secret, body: body + ' ', signature: sig })).toBe(false)
    expect(await verifyWebhook({ secret, body, signature: 'abc' })).toBe(false)
    expect(await verifyWebhook({ secret, body, signature: '' })).toBe(false)
    // Segredo vazio nunca valida (nem assina).
    expect(await verifyWebhook({ secret: '', body, signature: '0'.repeat(64) })).toBe(false)
    await expect(signWebhook('', body)).rejects.toBeDefined()
  })

  test('timestamped signatures protect against replay', async () => {
    const ts = Date.parse(NOW)
    const sig = await signWebhook(secret, body, ts)
    expect(await verifyWebhook({ secret, body, signature: sig, timestamp: ts, now: ts + 60_000 })).toBe(true)
    expect(await verifyWebhook({ secret, body, signature: sig, timestamp: ts, now: ts + 10 * 60_000 })).toBe(false) // velho
    expect(await verifyWebhook({ secret, body, signature: sig, timestamp: ts, now: ts - 10 * 60_000 })).toBe(false) // do futuro
    expect(await verifyWebhook({ secret, body, signature: sig, timestamp: ts + 1, now: ts })).toBe(false) // carimbo adulterado
    expect(await verifyWebhook({ secret, body, signature: await signWebhook(secret, body), timestamp: ts, now: ts })).toBe(false) // sem carimbo na assinatura
  })
})

describe('carrier event ingestion', () => {
  const mk = () => {
    let d = base()
    const r = put(d, { carrierId: 'CAR-0001', trackingNumber: 'AB123456789' }, { status: 'in_transit' })
    d = r.d
    const draft = put(d, { carrierId: 'CAR-0001', trackingNumber: 'DRAFT0001' }, { status: 'draft' })
    return { d: draft.d, id: r.id }
  }
  const ev = (over: Partial<NormalizedCarrierEvent> = {}): NormalizedCarrierEvent => ({ externalId: 'EV-1', trackingNumber: 'ab123456789', occurredAt: '2026-11-21T10:00:00.000Z', location: 'Campinas', description: 'Chegou ao centro de distribuição', ...over })

  test('adds verified events as carrier-sourced, without changing status, stock or finances', () => {
    const { d, id } = mk()
    const r = ingestCarrierEvents(d, 'CAR-0001', [ev()], NOW)
    if (!r.ok) throw new Error('ingest')
    expect(r.value).toEqual({ applied: 1, duplicates: 0, unmatched: 0, rejected: 0 })
    const s = r.data.shipments.find((x) => x.id === id)!
    const last = s.events.at(-1)!
    expect(last).toMatchObject({ kind: 'tracking', source: 'carrier', externalId: 'EV-1', actor: 'carrier:Alfa', location: 'Campinas' })
    expect(s.status).toBe('in_transit')
    expect(r.data.products).toBe(d.products)
    expect(r.data.accounts).toBe(d.accounts)
    expect(r.data.moves).toBe(d.moves)
  })

  test('is idempotent: same externalId or same fact never enters twice, including manual events', () => {
    const { d, id } = mk()
    const first = ingestCarrierEvents(d, 'CAR-0001', [ev()], NOW)
    if (!first.ok) throw new Error('ingest')
    const again = ingestCarrierEvents(first.data, 'CAR-0001', [ev(), ev({ externalId: 'EV-2' })], NOW)
    expect(again.ok && again.value).toEqual({ applied: 0, duplicates: 2, unmatched: 0, rejected: 0 })
    expect(again.ok && again.data).toBe(first.data)
    // O mesmo fato já registrado à mão também conta como duplicado.
    const manual = addTrackingEvent(d, id, { occurredAt: '2026-11-21T09:00:00.000Z', location: 'Santos', description: 'Saiu do porto' }, NOW, 'pessoa')
    if (!manual.ok) throw new Error('manual')
    const dup = ingestCarrierEvents(manual.data, 'CAR-0001', [ev({ externalId: 'EV-9', occurredAt: '2026-11-21T09:00:00.000Z', location: 'Santos', description: 'Saiu do porto' })], NOW)
    expect(dup.ok && dup.value.duplicates).toBe(1)
  })

  test('unmatched, invalid and future events are counted and never applied', () => {
    const { d } = mk()
    const r = ingestCarrierEvents(
      d,
      'CAR-0001',
      [ev({ trackingNumber: 'NAOEXISTE1' }), ev({ trackingNumber: 'DRAFT0001', externalId: 'E3' }), ev({ externalId: '' }), ev({ externalId: 'E4', description: 'a' }), ev({ externalId: 'E5', occurredAt: 'ontem' }), ev({ externalId: 'E6', occurredAt: '2026-12-31T10:00:00.000Z' })],
      NOW,
    )
    expect(r.ok && r.value).toEqual({ applied: 0, duplicates: 0, unmatched: 2, rejected: 4 })
    expect(r.ok && r.data).toBe(d)
    const other = ingestCarrierEvents(d, 'CAR-9999', [ev()], NOW)
    expect(!other.ok && other.errors).toContain('unknown_carrier')
  })
})

// ---------- Preparação para IA ----------

describe('AI readiness: anonymized, read-only', () => {
  const data = () => {
    let d = base()
    d = put(d, { recipientName: 'Maria Silva', senderName: 'Remetente Fulano', carrierId: 'CAR-0001', trackingNumber: 'AB123456789', estimatedDelivery: '2026-11-10', freightCost: 100, packages: [{ weightKg: 2, lengthCm: 1, widthCm: 1, heightCm: 1 }] }, { status: 'in_transit', events: [status('dispatched', '2026-11-06T09:00:00.000Z', 'nota privada do operador')] }).d
    d.shipments[0] = { ...d.shipments[0]!, documents: [{ id: 'd1', type: 'invoice', reference: 'NF-SECRETA-99', addedAt: NOW, addedBy: 'x' }], orderRef: { kind: 'purchase', label: 'Pedido do Cliente VIP' } }
    return d
  }

  test('the snapshot has no names, addresses, contacts, tracking codes, notes or references', () => {
    const snap = buildSnapshot(data(), TODAY)
    const json = JSON.stringify(snap)
    for (const secret of ['Maria Silva', 'Remetente Fulano', 'Armazém Secreto', 'São Paulo', 'Lisboa', 'AB123456789', 'nota privada', 'NF-SECRETA', 'Pedido do Cliente VIP', 'maria@alfa.com', '5511999990000', 'Maria Souza', 'Alfa']) {
      expect(json).not.toContain(secret)
    }
    expect(snap.shipments[0]).toMatchObject({ id: 'SHP-0001', lane: 'BR>PT', carrierId: 'CAR-0001', status: 'in_transit', cost: 100, weightKg: 2 })
    expect(snap.products.find((p) => p.id === 'p1')).toEqual({ id: 'p1', stock: 3, minStock: 10, incoming: 0 })
  })

  test('local rules produce structured, read-only insights', async () => {
    const d = data()
    d.purchases = [{ id: 'PUR-1', date: TODAY, supplierName: 'F', items: [{ productId: 'p1', name: 'Café', sku: '', qty: 2, cost: 1 }], total: 2, stockPosted: false, createdAt: NOW }]
    d.shipments[0] = { ...d.shipments[0]!, freight: { estimated: 50, insurance: 0, fees: [] } }
    const out = await runInsights(rulesProvider, buildSnapshot(d, TODAY))
    expect(rulesProvider.external).toBe(false)
    const codes = out.map((i) => i.code)
    expect(codes).toContain('overdue') // previsão 10/11 e ainda em trânsito
    expect(codes).toContain('cost_over_estimate') // 100 contra 50
    expect(codes).toContain('reorder') // 3 + 2 < 10
    expect(out[0]?.severity).toBe('critical')
    expect(out.find((i) => i.code === 'overdue')).toMatchObject({ action: 'review_shipment', targetId: 'SHP-0001', params: { days: 11 } })
    expect(out.find((i) => i.code === 'reorder')).toMatchObject({ action: 'review_product', targetId: 'p1', params: { stock: 3, incoming: 2, min: 10 } })
    // Toda ação é de revisão (abrir uma tela), nunca uma escrita.
    expect(out.every((i) => ['review_shipment', 'review_product', 'none'].includes(i.action))).toBe(true)
  })

  test('carrier ranking needs at least 3 timed deliveries per carrier', async () => {
    let d = base()
    d.carriers.push({ ...d.carriers[0]!, id: 'CAR-0002', name: 'Beta' })
    for (let i = 0; i < 3; i++) d = put(d, { carrierId: 'CAR-0001', estimatedDelivery: '2026-11-10' }, { status: 'delivered', deliveredAt: '2026-11-10' }).d
    for (let i = 0; i < 3; i++) d = put(d, { carrierId: 'CAR-0002', estimatedDelivery: '2026-11-10' }, { status: 'delivered', deliveredAt: i === 0 ? '2026-11-10' : '2026-11-14' }).d
    const out = await runInsights(rulesProvider, buildSnapshot(d, TODAY))
    expect(out.find((i) => i.code === 'carrier_ranking')).toMatchObject({ severity: 'info', action: 'none', params: { best: 'CAR-0001', bestRate: 100, worst: 'CAR-0002', worstRate: 33 } })
    expect((await runInsights(rulesProvider, buildSnapshot(put(base(), {}, { status: 'delivered' }).d, TODAY))).some((i) => i.code === 'carrier_ranking')).toBe(false)
  })

  test('any provider output is sanitized: unknown codes, write actions and markup are dropped', async () => {
    expect(sanitizeInsights('x')).toEqual([])
    expect(sanitizeInsights(null)).toEqual([])
    const cleaned = sanitizeInsights([
      { code: 'overdue', severity: 'critical', action: 'review_shipment', targetId: 'SHP-0001', params: { id: '<img src=x onerror=alert(1)>', days: 3, 'bad key!': 1, nested: { a: 1 } }, extra: 'ignorado' },
      { code: 'adjust_stock', severity: 'critical', action: 'review_shipment' },
      { code: 'reorder', severity: 'warning', action: 'adjust_stock' },
      { code: 'reorder', severity: 'warning', action: 'post_payment', targetId: 'p1' },
      { code: 'reorder', severity: 'nuclear', action: 'none' },
      { code: 'reorder', severity: 'warning', action: 'none', targetId: '../../etc/passwd' },
      42,
      null,
    ])
    expect(cleaned).toHaveLength(2)
    expect(cleaned[0]).toEqual({ code: 'overdue', severity: 'critical', action: 'review_shipment', targetId: 'SHP-0001', params: { id: 'img srcx onerroralert1', days: 3 } })
    expect(cleaned[1]).toMatchObject({ code: 'reorder', targetId: undefined })

    const malicious: LogisticsAiProvider = { id: 'bad', name: 'Mau', external: true, analyze: async () => [{ code: 'reorder', severity: 'critical', action: 'post_payment', targetId: 'p1', params: {} }] }
    expect(await runInsights(malicious, buildSnapshot(base(), TODAY))).toEqual([])
    const broken: LogisticsAiProvider = { id: 'broken', name: 'Quebrado', external: true, analyze: async () => { throw new Error('rede fora') } }
    expect(await runInsights(broken, buildSnapshot(base(), TODAY))).toEqual([])
    // O retrato não é alterado pelo provedor: nada do estado original muda.
    const before = base()
    await runInsights(rulesProvider, buildSnapshot(before, TODAY))
    expect(JSON.stringify(before)).toBe(JSON.stringify(base()))
  })
})
