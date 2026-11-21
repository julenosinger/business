import { describe, expect, test } from 'bun:test'
import {
  addDocument,
  addTrackingEvent,
  alerts,
  canTransition,
  clean,
  createShipment,
  kpis,
  nextShipmentId,
  removeDraft,
  transitionShipment,
  updateShipment,
  ALL_STATUSES,
  TRANSITIONS,
  type ShipmentInput,
} from '../src/lib/logistics'
import type { AppData } from '../src/lib/types'

const NOW = '2026-11-21T12:00:00.000Z'
const TODAY = '2026-11-21'

const base = (): AppData =>
  ({
    products: [{ id: 'p1', sku: 'CAF-001', name: 'Café', category: 'x', unit: 'un', cost: 1, price: 2, stock: 10, minStock: 1 }],
    moves: [],
    contacts: [],
    entries: [],
    accounts: [],
    sales: [{ id: 's1', date: TODAY, customerName: 'Ana', items: [], total: 10, cogs: 5, method: 'pix' }],
    employees: [],
    treasuryOps: [],
    requests: [],
    shipments: [],
    settings: { company: 'X', branch: 'Y', owner: 'Z', currency: 'BRL', usdcRate: null, approvalLimit: null },
  }) as unknown as AppData

const input = (over: Partial<ShipmentInput> = {}): ShipmentInput => ({
  direction: 'outbound',
  origin: { name: 'Armazém', city: 'São Paulo', country: 'BR' },
  destination: { name: 'Loja', city: 'Lisboa', country: 'PT' },
  senderName: 'Minha Empresa',
  recipientName: 'Ana',
  carrier: 'Transportadora X',
  trackingNumber: 'AB123456789',
  method: 'Standard',
  packages: [{ weightKg: 2, lengthCm: 10, widthCm: 10, heightCm: 10 }],
  items: [{ productId: 'p1', name: 'Café', sku: 'CAF-001', qty: 2 }],
  declaredValue: 100,
  currency: 'BRL',
  freightCost: 25.5,
  estimatedDelivery: '2026-11-25',
  ...over,
})

function created(over: Partial<ShipmentInput> = {}) {
  const r = createShipment(base(), input(over), NOW, 'tester')
  if (!r.ok) throw new Error(r.errors.join(','))
  return { d: r.data, id: r.value.id }
}

/** Leva uma remessa até o status desejado pelo caminho válido. */
function advance(d: AppData, id: string, path: Parameters<typeof transitionShipment>[2][]): AppData {
  let cur = d
  for (const to of path) {
    const r = transitionShipment(cur, id, to, { note: 'ok nota' }, NOW, TODAY, 'tester')
    if (!r.ok) throw new Error(`${to}: ${r.errors.join(',')}`)
    cur = r.data
  }
  return cur
}

describe('state machine', () => {
  test('every status has a transition entry and never points to itself', () => {
    for (const s of ALL_STATUSES) {
      expect(TRANSITIONS[s]).toBeDefined()
      expect(TRANSITIONS[s]).not.toContain(s)
    }
  })
  test('happy path is allowed, shortcuts are not', () => {
    expect(canTransition('draft', 'ready')).toBe(true)
    expect(canTransition('ready', 'dispatched')).toBe(true)
    expect(canTransition('dispatched', 'in_transit')).toBe(true)
    expect(canTransition('in_transit', 'out_for_delivery')).toBe(true)
    expect(canTransition('out_for_delivery', 'delivered')).toBe(true)
    expect(canTransition('draft', 'delivered')).toBe(false)
    expect(canTransition('ready', 'delivered')).toBe(false)
    expect(canTransition('cancelled', 'ready')).toBe(false)
    expect(canTransition('returned', 'delivered')).toBe(false)
  })
})

describe('create and validate', () => {
  test('creates a draft with audit event, unique sequential ids and tenant reference', () => {
    const a = created()
    expect(a.id).toBe('SHP-0001')
    const s = a.d.shipments[0]!
    expect(s.status).toBe('draft')
    expect(s.orgId).toBe('local')
    expect(s.events).toHaveLength(1)
    expect(s.events[0]?.kind).toBe('created')
    const b = createShipment(a.d, input(), NOW, 'tester')
    expect(b.ok && b.value.id).toBe('SHP-0002')
    expect(nextShipmentId([])).toBe('SHP-0001')
  })
  test('rejects invalid data', () => {
    const d = base()
    const bad = (over: Partial<ShipmentInput>) => {
      const r = createShipment(d, input(over), NOW, 't')
      return r.ok ? [] : r.errors
    }
    expect(bad({ recipientName: '  ' })).toContain('missing_recipient')
    expect(bad({ destination: { name: '', city: '', country: '' } })).toContain('missing_destination')
    expect(bad({ trackingNumber: '<script>' })).toContain('invalid_tracking')
    expect(bad({ freightCost: -1 })).toContain('invalid_number')
    expect(bad({ declaredValue: Number.NaN })).toContain('invalid_number')
    expect(bad({ estimatedDelivery: '2026-13-45' })).toContain('invalid_date')
    expect(bad({ currency: 'XXX' as never })).toContain('invalid_currency')
    expect(bad({ direction: 'sideways' as never })).toContain('invalid_direction')
    expect(bad({ items: [{ productId: 'nope', name: 'x', sku: '', qty: 1 }] })).toContain('unknown_product')
    expect(bad({ items: [{ name: 'x', sku: '', qty: 0 }] })).toContain('invalid_item')
    expect(bad({ orderRef: { kind: 'sale', id: 'missing', label: '' } })).toContain('unknown_sale')
  })
  test('links a valid sale and ignores canceled sales', () => {
    const ok = createShipment(base(), input({ orderRef: { kind: 'sale', id: 's1', label: '' } }), NOW, 't')
    expect(ok.ok && ok.data.shipments[0]?.orderRef).toEqual({ kind: 'sale', id: 's1', label: 's1' })
    const d = base()
    d.sales[0]!.canceledAt = TODAY
    const r = createShipment(d, input({ orderRef: { kind: 'sale', id: 's1', label: '' } }), NOW, 't')
    expect(!r.ok && r.errors).toContain('unknown_sale')
  })
  test('sanitizes text', () => {
    expect(clean('  a\u0000b\n\tc  ', 10)).toBe('a b c')
    expect(clean('x'.repeat(200), 5)).toBe('xxxxx')
    expect(clean(42 as never, 5)).toBe('')
  })
})

describe('transitions with audit', () => {
  test('full delivery path records one audit event per step', () => {
    const { d, id } = created()
    const out = advance(d, id, ['ready', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'])
    const s = out.shipments[0]!
    expect(s.status).toBe('delivered')
    expect(s.deliveredAt).toBe(TODAY)
    expect(s.events.filter((e) => e.kind === 'status')).toHaveLength(5)
  })
  test('arbitrary jumps are refused and leave data untouched', () => {
    const { d, id } = created()
    const r = transitionShipment(d, id, 'delivered', {}, NOW, TODAY, 't')
    expect(!r.ok && r.errors).toContain('not_allowed')
    expect(d.shipments[0]?.status).toBe('draft')
  })
  test('readiness and dispatch rules', () => {
    const empty = created({ items: [], packages: [] })
    const r1 = transitionShipment(empty.d, empty.id, 'ready', {}, NOW, TODAY, 't')
    expect(!r1.ok && r1.errors).toContain('missing_contents')
    const noCountry = created({ destination: { name: '', city: 'Lisboa', country: '' } })
    const r2 = transitionShipment(noCountry.d, noCountry.id, 'ready', {}, NOW, TODAY, 't')
    expect(!r2.ok && r2.errors).toContain('missing_destination')
    const noCarrier = created({ carrier: '' })
    const ready = advance(noCarrier.d, noCarrier.id, ['ready'])
    const r3 = transitionShipment(ready, noCarrier.id, 'dispatched', {}, NOW, TODAY, 't')
    expect(!r3.ok && r3.errors).toContain('missing_carrier')
  })
  test('exception, delay, cancel and return need a written reason', () => {
    const { d, id } = created()
    const moving = advance(d, id, ['ready', 'dispatched', 'in_transit'])
    for (const to of ['delayed', 'exception', 'returned'] as const) {
      const r = transitionShipment(moving, id, to, { note: ' ' }, NOW, TODAY, 't')
      expect(!r.ok && r.errors).toContain('note_required')
    }
    const ok = transitionShipment(moving, id, 'delayed', { note: 'Greve no porto' }, NOW, TODAY, 't')
    expect(ok.ok).toBe(true)
  })
  test('delivery date cannot be in the future or before creation', () => {
    const { d, id } = created()
    const out = advance(d, id, ['ready', 'dispatched', 'in_transit'])
    const future = transitionShipment(out, id, 'delivered', { deliveredAt: '2026-12-01' }, NOW, TODAY, 't')
    expect(!future.ok && future.errors).toContain('invalid_date')
    const past = transitionShipment(out, id, 'delivered', { deliveredAt: '2026-01-01' }, NOW, TODAY, 't')
    expect(!past.ok && past.errors).toContain('invalid_date')
  })
  test('final states are locked', () => {
    const { d, id } = created()
    const cancelled = advance(d, id, ['cancelled'])
    const r = updateShipment(cancelled, id, input({ carrier: 'Outra' }), NOW, 't')
    expect(!r.ok && r.errors).toContain('locked')
    expect(canTransition('cancelled', 'draft')).toBe(false)
  })
})

describe('tracking events', () => {
  const moving = () => {
    const { d, id } = created()
    return { d: advance(d, id, ['ready', 'dispatched']), id }
  }
  test('adds a manual event with attribution and refuses duplicates', () => {
    const { d, id } = moving()
    const ev = { occurredAt: '2026-11-21T09:30:00Z', location: 'CD São Paulo', description: 'Coletado' }
    const r = addTrackingEvent(d, id, ev, NOW, 'Maria')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const e = r.data.shipments[0]!.events.at(-1)!
    expect(e.source).toBe('manual')
    expect(e.actor).toBe('Maria')
    const dup = addTrackingEvent(r.data, id, { ...ev, description: '  coletado ', location: 'cd são paulo' }, NOW, 'Maria')
    expect(!dup.ok && dup.errors).toContain('duplicate_event')
  })
  test('refuses future events, empty text and untracked states', () => {
    const { d, id } = moving()
    const future = addTrackingEvent(d, id, { occurredAt: '2026-11-22T12:00:00Z', location: '', description: 'Chegou' }, NOW, 't')
    expect(!future.ok && future.errors).toContain('future_event')
    const empty = addTrackingEvent(d, id, { occurredAt: '2026-11-21T09:00:00Z', location: '', description: ' ' }, NOW, 't')
    expect(!empty.ok && empty.errors).toContain('empty_description')
    const draft = created()
    const r = addTrackingEvent(draft.d, draft.id, { occurredAt: '2026-11-21T09:00:00Z', location: '', description: 'Algo' }, NOW, 't')
    expect(!r.ok && r.errors).toContain('not_allowed')
  })
})

describe('documents, removal and audit trail', () => {
  test('documents are referenced, deduplicated and audited', () => {
    const { d, id } = created()
    const a = addDocument(d, id, { type: 'invoice', reference: 'NF-123' }, NOW, 't')
    expect(a.ok).toBe(true)
    if (!a.ok) return
    const dup = addDocument(a.data, id, { type: 'invoice', reference: 'nf-123' }, NOW, 't')
    expect(!dup.ok && dup.errors).toContain('duplicate_document')
    expect(a.data.shipments[0]?.events.at(-1)?.kind).toBe('document')
  })
  test('only drafts can be removed', () => {
    const { d, id } = created()
    const ready = advance(d, id, ['ready'])
    const r = removeDraft(ready, id)
    expect(!r.ok && r.errors).toContain('only_draft_removable')
    const ok = removeDraft(d, id)
    expect(ok.ok && ok.data.shipments).toHaveLength(0)
  })
  test('edits are audited and no-op edits are silent', () => {
    const { d, id } = created()
    const same = updateShipment(d, id, input(), NOW, 't')
    expect(same.ok && same.value.changed).toEqual([])
    const r = updateShipment(d, id, input({ carrier: 'Nova', freightCost: 40 }), NOW, 'Maria')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.changed).toEqual(['carrier', 'freightCost'])
    expect(r.data.shipments[0]?.events.at(-1)).toMatchObject({ kind: 'edit', fields: ['carrier', 'freightCost'], actor: 'Maria' })
  })
  test('direction cannot be changed after creation', () => {
    const { d, id } = created()
    const r = updateShipment(d, id, input({ direction: 'inbound', carrier: 'Z' }), NOW, 't')
    expect(r.ok && r.data.shipments[0]?.direction).toBe('outbound')
  })
})

describe('integrity: inventory and finance are never touched', () => {
  test('no operation changes products, moves, entries or accounts', () => {
    const { d, id } = created()
    const out = advance(d, id, ['ready', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'])
    const tracked = addTrackingEvent(out, id, { occurredAt: '2026-11-20T10:00:00Z', location: '', description: 'Entregue ao destinatário' }, NOW, 't')
    for (const next of [out, tracked.ok ? tracked.data : out]) {
      expect(next.products).toBe(d.products)
      expect(next.moves).toBe(d.moves)
      expect(next.entries).toBe(d.entries)
      expect(next.accounts).toBe(d.accounts)
      expect(next.sales).toBe(d.sales)
    }
  })
  test('input data is not mutated', () => {
    const d = base()
    const snapshot = JSON.stringify(d)
    createShipment(d, input(), NOW, 't')
    expect(JSON.stringify(d)).toBe(snapshot)
  })
})

describe('indicators', () => {
  test('on-time rate, active counts and freight by currency use only recorded data', () => {
    let d = base()
    const mk = (over: Partial<ShipmentInput>, path: Parameters<typeof transitionShipment>[2][], delivered?: string) => {
      const r = createShipment(d, input(over), NOW, 't')
      if (!r.ok) throw new Error('x')
      d = r.data
      d = advance(d, r.value.id, path)
      if (delivered) {
        const t = transitionShipment(d, r.value.id, 'delivered', { deliveredAt: delivered }, NOW, TODAY, 't')
        if (!t.ok) throw new Error(t.errors.join())
        d = t.data
      }
      return r.value.id
    }
    mk({ estimatedDelivery: '2026-11-21' }, ['ready', 'dispatched', 'in_transit'], '2026-11-21') // no prazo
    mk({ estimatedDelivery: '2026-11-19' }, ['ready', 'dispatched', 'in_transit'], '2026-11-21') // atrasada
    mk({ estimatedDelivery: '2026-11-10' }, ['ready', 'dispatched', 'in_transit']) // em trânsito e vencida
    mk({ currency: 'USD', freightCost: 10 }, ['ready'])
    const k = kpis(d.shipments, { from: '' }, TODAY)
    expect(k.delivered).toBe(2)
    expect(k.onTimeSample).toBe(2)
    expect(k.onTimeRate).toBe(50)
    expect(k.moving).toBe(1)
    expect(k.active).toBe(2)
    expect(k.problems).toBe(1)
    expect(k.freightByCurrency.BRL).toBe(76.5)
    expect(k.freightByCurrency.USD).toBe(10)
    expect(alerts(d.shipments, TODAY).map((a) => a.reason)).toEqual(['overdue'])
    expect(kpis([], { from: '' }, TODAY).onTimeRate).toBeNull()
  })
})
