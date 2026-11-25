import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Store } from '../src/lib/store'

try {
  GlobalRegistrator.register()
} catch {
  // já registrado
}

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { StoreProvider, useStore } = await import('../src/lib/store')
const { setNetwork } = await import('../src/lib/network')

let captured: Store | null = null
function Capture(): null {
  const store = useStore()
  React.useEffect(() => {
    captured = store
  })
  return null
}
function renderStore(): { store: () => Store; unmount: () => void } {
  captured = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  React.act(() => root.render(React.createElement(StoreProvider, null, React.createElement(Capture))))
  return {
    store: () => captured!,
    unmount: () => {
      React.act(() => root.unmount())
      container.remove()
      captured = null
    },
  }
}
function commit<T>(store: () => Store, op: (s: Store) => T): T {
  let out: T = undefined as unknown as T
  React.act(() => {
    out = op(store())
  })
  return out
}

const prod = (sku: string, name: string, cost: number, price: number, stock: number): Parameters<Store['addProduct']>[0] => ({
  sku,
  name,
  category: 'Geral',
  unit: 'un',
  cost,
  price,
  stock,
  minStock: 0,
})

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('valorização de estoque no Store (FIN-02 hotfix)', () => {
  test('compra de arroz recalcula custo médio ponderado, não o último custo', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.addProduct(prod('ARROZ', 'Arroz', 5, 7, 150000)))
    const arrozId = store().data.products[0]!.id
    commit(store, (s) => s.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: arrozId, qty: 30000, cost: 6 }] }))
    const arroz = store().data.products.find((p) => p.id === arrozId)!
    expect(arroz.stock).toBe(180000)
    expect(arroz.cost).toBeCloseTo(5.1666667, 6)
    unmount()
  })

  test('CMV da venda é capturado no momento da venda e não muda com compras futuras', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.addProduct(prod('FEIJAO', 'Feijão', 6, 8, 100000)))
    commit(store, (s) => s.addProduct(prod('ARROZ', 'Arroz', 5, 7, 150000)))
    const feijaoId = store().data.products.find((p) => p.sku === 'FEIJAO')!.id
    const arrozId = store().data.products.find((p) => p.sku === 'ARROZ')!.id
    commit(store, (s) => s.recordSale({ method: 'pix', items: [{ productId: feijaoId, qty: 10000, price: 8 }] }))
    const sale = store().data.sales[0]!
    expect(sale.total).toBe(80000)
    expect(sale.cogs).toBe(60000) // 10.000 × 6 (custo do feijão)
    // Compra futura de arroz não altera o CMV já registrado.
    commit(store, (s) => s.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: arrozId, qty: 30000, cost: 6 }] }))
    expect(store().data.sales[0]!.cogs).toBe(60000)
    unmount()
  })

  test('pagamento de fornecedor não aumenta estoque', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.addProduct(prod('ARROZ', 'Arroz', 5, 7, 150000)))
    const arrozId = store().data.products[0]!.id
    // Compra a prazo cria a obrigação e soma estoque uma única vez.
    commit(store, (s) => s.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: arrozId, qty: 30000, cost: 6 }] }))
    const stockAfterPurchase = store().data.products.find((p) => p.id === arrozId)!.stock
    const payableId = store().data.accounts.find((a) => a.kind === 'payable' && a.source === 'purchase')!.id
    // Pagar a obrigação movimenta caixa, mas NÃO soma estoque de novo.
    commit(store, (s) => s.settleAccount(payableId))
    expect(store().data.products.find((p) => p.id === arrozId)!.stock).toBe(stockAfterPurchase)
    unmount()
  })
})
