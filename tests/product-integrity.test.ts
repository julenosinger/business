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

const prod = (over: Partial<Parameters<Store['addProduct']>[0]> = {}): Parameters<Store['addProduct']>[0] => ({
  sku: 'SKU',
  name: 'Produto',
  category: 'Geral',
  unit: 'un',
  cost: 5,
  price: 8,
  stock: 0,
  minStock: 0,
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('integridade do cadastro de produto (INV-1.0)', () => {
  test('addProduct rejeita nome vazio e custo negativo (sem gravar)', () => {
    const { store, unmount } = renderStore()
    expect(commit(store, (s) => s.addProduct(prod({ name: '' })))).toBe('')
    expect(commit(store, (s) => s.addProduct(prod({ cost: -1 })))).toBe('')
    expect(store().data.products).toHaveLength(0)
    unmount()
  })

  test('addProduct aceita produto válido e preserva campos novos', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addProduct(prod({ name: 'Arroz', brand: 'Marca X', barcode: '7891234567890', referenceCost: 4.5, wholesalePrice: 7, maxStock: 1000, reorderPoint: 50 })))
    expect(id).toBeTruthy()
    const p = store().data.products.find((x) => x.id === id)!
    expect(p.brand).toBe('Marca X')
    expect(p.barcode).toBe('7891234567890')
    expect(p.referenceCost).toBe(4.5)
    expect(p.wholesalePrice).toBe(7)
    unmount()
  })

  test('updateProduct rejeita alteração de custo médio e estoque', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addProduct(prod({ cost: 5, stock: 100 })))
    expect(commit(store, (s) => s.updateProduct(id, { cost: 9 }))).toBe(false)
    expect(commit(store, (s) => s.updateProduct(id, { stock: 999 }))).toBe(false)
    const p = store().data.products.find((x) => x.id === id)!
    expect(p.cost).toBe(5)
    expect(p.stock).toBe(100)
    unmount()
  })

  test('updateProduct permite editar marca e preço sem afetar custo/estoque/CMV', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addProduct(prod({ cost: 5, price: 8, stock: 100 })))
    const ok = commit(store, (s) => s.updateProduct(id, { brand: 'Nova Marca', price: 10 }))
    expect(ok).toBe(true)
    const p = store().data.products.find((x) => x.id === id)!
    expect(p.brand).toBe('Nova Marca')
    expect(p.price).toBe(10)
    expect(p.cost).toBe(5)
    expect(p.stock).toBe(100)
    unmount()
  })

  test('updateProduct rejeita edição de produto de outro ambiente', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addProduct(prod({ name: 'Mainnet' })))
    setNetwork('testnet')
    expect(commit(store, (s) => s.updateProduct(id, { name: 'X' }))).toBe(false)
    expect(store().data.products.find((x) => x.id === id)?.name).toBe('Mainnet')
    unmount()
  })

  test('SKU duplicado é rejeitado na Mainnet, permitido na Testnet', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.addProduct(prod({ sku: 'DUP' })))
    expect(commit(store, (s) => s.addProduct(prod({ sku: 'DUP' })))).toBe('')
    setNetwork('testnet')
    expect(commit(store, (s) => s.addProduct(prod({ sku: 'DUP' })))).toBeTruthy()
    unmount()
  })
})

describe('consolidação de produtos repetidos na compra (INV-1.0)', () => {
  test('100@5 + 20@6 do mesmo produto consolida estoque e custo médio', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct(prod({ name: 'Arroz', cost: 5, stock: 0 })))
    commit(store, (s) =>
      s.recordPurchase({
        paidNow: false,
        dueDate: '2026-12-31',
        items: [
          { productId: pid, qty: 100, cost: 5 },
          { productId: pid, qty: 20, cost: 6 },
        ],
      }),
    )
    const p = store().data.products.find((x) => x.id === pid)!
    expect(p.stock).toBe(120)
    expect(p.cost).toBeCloseTo(620 / 120, 10)
    expect(store().data.purchases[0]!.total).toBe(620)
    // A obrigação considera o total das duas linhas (620), não apenas a primeira (500).
    expect(store().data.accounts[0]!.amount).toBe(620)
    unmount()
  })

  test('compra com produto novo e existente na mesma operação', () => {
    const { store, unmount } = renderStore()
    const existing = commit(store, (s) => s.addProduct(prod({ sku: 'E1', name: 'Existente', cost: 5, stock: 50 })))
    const fresh = commit(store, (s) => s.addProduct(prod({ sku: 'N1', name: 'Novo', cost: 0, stock: 0 })))
    commit(store, (s) =>
      s.recordPurchase({
        paidNow: false,
        dueDate: '2026-12-31',
        items: [
          { productId: existing, qty: 10, cost: 6 },
          { productId: fresh, qty: 30, cost: 4 },
        ],
      }),
    )
    expect(store().data.products.find((x) => x.id === existing)!.stock).toBe(60)
    expect(store().data.products.find((x) => x.id === fresh)!.stock).toBe(30)
    expect(store().data.purchases[0]!.total).toBe(10 * 6 + 30 * 4)
    unmount()
  })
})
