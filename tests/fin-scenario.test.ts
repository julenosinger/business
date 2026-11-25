import { describe, expect, test } from 'bun:test'

// Stubs leves.
const g = globalThis as unknown as Record<string, unknown>
const storage: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => void (storage[k] = v), removeItem: (k: string) => void delete storage[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { emptyData } = await import('../src/lib/store')
const { kpis, monthPeriod, stockValue } = await import('../src/lib/selectors')
const { weightedAverageCost } = await import('../src/lib/costing')
import { CAT_PURCHASE, CAT_SALES } from '../src/lib/types'
import type { AppData, Entry, Sale } from '../src/lib/types'

const P = monthPeriod(0)
const entry = (over: Partial<Entry>): Entry => ({ id: 'e', date: P.from, type: 'in', category: 'Outras receitas', description: 'd', amount: 0, ...over })
const sale = (over: Partial<Sale>): Sale => ({ id: 's', date: P.from, customerName: 'c', items: [], total: 0, cogs: 0, method: 'pix', ...over })

describe('reprodução integral do cenário real (FIN-02 hotfix)', () => {
  test('fluxo de caixa, CMV e estoque do cenário ETH FOOD/AVAX', () => {
    const d: AppData = {
      ...emptyData(),
      // Feijão 100.000×6, Arroz 150.000×5, Café 100.000×9.
      products: [
        { id: 'p-f', sku: 'F', name: 'Feijão', category: 'x', unit: 'un', cost: 6, price: 8, stock: 90000, minStock: 0, environment: 'mainnet' },
        { id: 'p-a', sku: 'A', name: 'Arroz', category: 'x', unit: 'un', cost: weightedAverageCost(150000, 5, 30000, 6), price: 7, stock: 180000, minStock: 0, environment: 'mainnet' },
        { id: 'p-c', sku: 'C', name: 'Café', category: 'x', unit: 'un', cost: 9, price: 15, stock: 100000, minStock: 0, environment: 'mainnet' },
      ],
      // Venda de 10.000 feijão: receita 80.000, CMV 60.000.
      sales: [sale({ id: 's1', total: 80000, cogs: 60000, items: [{ productId: 'p-f', name: 'Feijão', qty: 10000, price: 8, cost: 6 }] })],
      entries: [
        entry({ id: 'e-venda', type: 'in', category: CAT_SALES, amount: 80000 }),
        entry({ id: 'e-manual', type: 'in', category: 'Venda de mercadorias', amount: 1000000, description: 'Recebimento manual de cliente' }),
        entry({ id: 'e-eth', type: 'out', category: CAT_PURCHASE, amount: 180000 }),
        entry({ id: 'e-avax', type: 'out', category: 'Outras despesas', amount: 500000 }),
        entry({ id: 'e-aluguel', type: 'out', category: 'Aluguel', amount: 5000 }),
      ],
    }
    const k = kpis(d, P)
    expect(k.inflow).toBe(1080000)
    expect(k.outflow).toBe(685000)
    expect(k.inflow - k.outflow).toBe(395000)
    expect(k.cogs).toBe(60000) // CMV comprovado da venda
    expect(k.cogsIncomplete).toBe(true) // receita manual de mercadorias sem CMV
    expect(k.grossProfit).toBe(1020000)
    // Estoque pelo custo médio ponderado.
    expect(stockValue(d)).toBe(2370000)
  })
})
