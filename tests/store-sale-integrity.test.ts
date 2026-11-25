import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Store } from '../src/lib/store'

try {
  GlobalRegistrator.register()
} catch {
  // Já registrado em outro arquivo de teste do mesmo processo.
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
  React.act(() => {
    root.render(React.createElement(StoreProvider, null, React.createElement(Capture)))
  })
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

const product = (over: Partial<Parameters<Store['addProduct']>[0]> = {}): Parameters<Store['addProduct']>[0] => ({
  sku: 'SKU1',
  name: 'Produto',
  category: 'Geral',
  unit: 'un',
  cost: 10,
  price: 20,
  stock: 100,
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

describe('integridade da execução de vendas (FIN-03.2.1)', () => {
  const addProduct = (store: () => Store, over: Partial<Parameters<Store['addProduct']>[0]> = {}): string => {
    commit(store, (s) => s.addProduct(product(over)))
    return store().data.products[0]!.id
  }

  test('produtos repetidos são consolidados: 60 + 60 acima do estoque de 100 é rejeitado sem mutação', () => {
    const { store, unmount } = renderStore()
    const pid = addProduct(store, { stock: 100 })
    // snapshot para verificar que nada muda
    const before = JSON.stringify(store().data)
    const ok = commit(store, (s) =>
      s.recordSale({
        method: 'pix',
        items: [
          { productId: pid, qty: 60, price: 20 },
          { productId: pid, qty: 60, price: 20 },
        ],
      }),
    )
    expect(ok.ok).toBe(false)
    expect(store().data.sales).toHaveLength(0)
    expect(store().data.products.find((p) => p.id === pid)?.stock).toBe(100) // estoque intacto
    expect(JSON.stringify(store().data)).toBe(before) // nenhuma mutação parcial
    unmount()
  })

  test('produtos repetidos válidos são consolidados e a venda é registrada com estoque correto', () => {
    const { store, unmount } = renderStore()
    const pid = addProduct(store, { stock: 100, price: 20, cost: 10 })
    const ok = commit(store, (s) =>
      s.recordSale({
        method: 'pix',
        items: [
          { productId: pid, qty: 60, price: 20 },
          { productId: pid, qty: 30, price: 20 },
        ],
      }),
    )
    expect(ok.ok).toBe(true)
    const sale = store().data.sales[0]!
    expect(sale.items).toHaveLength(1) // consolidado
    expect(sale.items[0]!.qty).toBe(90)
    expect(sale.total).toBe(1800)
    expect(sale.cogs).toBe(900)
    expect(store().data.products.find((p) => p.id === pid)?.stock).toBe(10)
    unmount()
  })

  test('quantidade acima do estoque é rejeitada e preserva o carrinho (sem venda)', () => {
    const { store, unmount } = renderStore()
    const pid = addProduct(store, { stock: 1000000 })
    const ok = commit(store, (s) => s.recordSale({ method: 'pix', items: [{ productId: pid, qty: 2000000, price: 20 }] }))
    expect(ok.ok).toBe(false)
    expect(store().data.sales).toHaveLength(0)
    expect(store().data.products.find((p) => p.id === pid)?.stock).toBe(1000000)
    unmount()
  })
})

describe('proteção de mutações financeiras (FIN-03.2.1)', () => {
  test('updateAccount rejeita categoria incompatível com o tipo da conta', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addAccount({ kind: 'payable', description: 'x', contactName: 'c', amount: 100, dueDate: '2026-12-01', category: 'Aluguel' }))
    const ok = commit(store, (s) => s.updateAccount(id, { category: 'Venda de mercadorias' })) // income em payable
    expect(ok).toBe(false)
    expect(store().data.accounts.find((a) => a.id === id)?.category).toBe('Aluguel')
    unmount()
  })

  test('updateAccount rejeita edição de conta de outro ambiente', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addAccount({ kind: 'payable', description: 'x', contactName: 'c', amount: 100, dueDate: '2026-12-01', category: 'Aluguel' }))
    setNetwork('testnet')
    const ok = commit(store, (s) => s.updateAccount(id, { amount: 200 }))
    expect(ok).toBe(false)
    expect(store().data.accounts.find((a) => a.id === id)?.amount).toBe(100)
    unmount()
  })

  test('updateAccount não permite alterar o environment em edição comum', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addAccount({ kind: 'payable', description: 'x', contactName: 'c', amount: 100, dueDate: '2026-12-01', category: 'Aluguel' }))
    const ok = commit(store, (s) => s.updateAccount(id, { environment: 'testnet' as never }))
    expect(ok).toBe(false)
    expect(store().data.accounts.find((a) => a.id === id)?.environment).toBe('mainnet')
    unmount()
  })

  test('updateAccount aceita edição válida dentro do mesmo ambiente', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addAccount({ kind: 'payable', description: 'x', contactName: 'c', amount: 100, dueDate: '2026-12-01', category: 'Aluguel' }))
    const ok = commit(store, (s) => s.updateAccount(id, { amount: 150, category: 'Impostos' }))
    expect(ok).toBe(true)
    expect(store().data.accounts.find((a) => a.id === id)?.amount).toBe(150)
    unmount()
  })
})
