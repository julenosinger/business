import { describe, expect, test } from 'bun:test'

// Stubs leves (store importa módulos que tocam DOM/localStorage).
const g = globalThis as unknown as Record<string, unknown>
const storage: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => void (storage[k] = v), removeItem: (k: string) => void delete storage[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { emptyData } = await import('../src/lib/store')
const { autoPost } = await import('../src/lib/accounting/autopost')
const { allocatePurchaseValue } = await import('../src/lib/receiving')
import type { AppData, Sale, Entry } from '../src/lib/types'

const TODAY = '2026-11-22'
const opts = { today: TODAY, actorId: 'Dono', now: '2026-11-22T10:00:00.000Z' }
const base = (on: Partial<AppData['ledger']['flags']['adapters']>): AppData => ({
  ...emptyData(),
  settings: { ...emptyData().settings, currency: 'BRL' },
  ledger: { ...emptyData().ledger, flags: { adapters: { ...emptyData().ledger.flags.adapters, ...on } } },
})
const sale = (over: Partial<Sale> = {}): Sale => ({ id: 's1', date: TODAY, customerName: 'Ana', items: [], total: 100, cogs: 40, method: 'dinheiro', ...over })
const entry = (over: Partial<Entry> = {}): Entry => ({ id: 'e1', date: TODAY, type: 'in', category: 'Vendas', description: 'venda', amount: 100, sourceKind: 'sale', sourceId: 's1', ...over })

describe('FIN-04.0.1 — vínculos contábeis determinísticos', () => {
  test('duas vendas idênticas (mesmo valor/data) não são confundidas: cada uma liga à sua entrada', () => {
    const prev = base({ sales: true })
    const out = autoPost(
      prev,
      {
        ...prev,
        sales: [sale({ id: 's-a', total: 100 }), sale({ id: 's-b', total: 100 })],
        entries: [entry({ id: 'ea', sourceId: 's-a' }), entry({ id: 'eb', sourceId: 's-b' })],
      },
      opts,
    )
    const links = out.ledger.journal.map((j) => j.links.cashEntryId).sort()
    expect(links).toEqual(['ea', 'eb'])
    expect(out.ledger.journal).toHaveLength(2)
  })

  test('entrada de caixa sem vínculo (legado) não é associada por coincidência', () => {
    const prev = base({ sales: true })
    const out = autoPost(
      prev,
      { ...prev, sales: [sale({ id: 's1' })], entries: [entry({ id: 'e1', sourceKind: undefined, sourceId: undefined })] },
      opts,
    )
    // A venda é reconhecida, mas sem vínculo de caixa (fica para conciliação).
    expect(out.ledger.journal[0]!.links.cashEntryId).toBeUndefined()
    expect(out.ledger.journal[0]!.links.saleId).toBe('s1')
  })
})

describe('FIN-04.0.1 — custo de aquisição no recebimento (alocação determinística)', () => {
  test('mesmo produto em duas linhas com custos diferentes: consome em ordem', () => {
    const queue = [
      { cost: 5, qty: 100 },
      { cost: 6, qty: 20 },
    ]
    // Recebe 120 unidades → valor total = 100*5 + 20*6 = 620.
    expect(allocatePurchaseValue(queue, 120)).toEqual({ value: 620, excess: 0 })
    expect(queue).toHaveLength(0) // fila consumida
  })

  test('recebimento parcial usa só a primeira linha', () => {
    const queue = [
      { cost: 5, qty: 100 },
      { cost: 6, qty: 20 },
    ]
    expect(allocatePurchaseValue(queue, 60)).toEqual({ value: 300, excess: 0 })
    expect(queue[0]).toEqual({ cost: 5, qty: 40 }) // 40 restantes na primeira linha
  })

  test('excedente além da compra NÃO é valorizado pelo último custo', () => {
    const queue = [{ cost: 5, qty: 10 }]
    expect(allocatePurchaseValue(queue, 15)).toEqual({ value: 50, excess: 5 }) // só os 10 comprados
  })

  test('sem compra, sem alocação (excedente integral)', () => {
    expect(allocatePurchaseValue([], 10)).toEqual({ value: 0, excess: 10 })
  })
})
