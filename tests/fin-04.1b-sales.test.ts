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
const { kpis, monthPeriod, stockValue } = await import('../src/lib/selectors')

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

beforeEach(() => {
  localStorage.clear()
  setNetwork('testnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.1B — venda USDC cria obrigação, não caixa imediato', () => {
  test('venda USDC gera conta a receber e não registra entrada de caixa', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct({ sku: 'CAFE', name: 'Café', category: 'G', unit: 'un', cost: 2, price: 4, stock: 100, minStock: 0 }))
    const r = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    expect(r.ok).toBe(true)
    expect(r.accountId).toBeTruthy()
    const sale = store().data.sales[0]!
    expect(sale.method).toBe('usdc')
    expect(sale.accountId).toBe(r.accountId)
    // Estoque baixado uma vez.
    expect(store().data.products.find((p) => p.id === pid)!.stock).toBe(90)
    // Obrigação a receber criada, sem entrada de caixa.
    expect(store().data.accounts.find((a) => a.id === r.accountId)?.amount).toBe(40)
    expect(store().data.entries.filter((e) => e.type === 'in')).toHaveLength(0)
    const k = kpis(store().data, monthPeriod(0))
    expect(k.revenue).toBe(40)
    expect(k.cogs).toBe(20)
    expect(k.grossProfit).toBe(20)
    expect(k.inflow).toBe(0) // nada recebido ainda
    expect(stockValue(store().data)).toBe(90 * 2) // 90 unidades a 2
    unmount()
  })

  test('recebimento parcial e integral liquidam a obrigação sem duplicar receita/CMV/estoque', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct({ sku: 'CAFE', name: 'Café', category: 'G', unit: 'un', cost: 2, price: 4, stock: 100, minStock: 0 }))
    const r = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!r.ok || !r.accountId) throw new Error('sale')

    // Recebimento parcial de 15.
    commit(store, (s) => s.settleAccountPartial(r.accountId!, 15))
    expect(store().data.accounts.find((a) => a.id === r.accountId)?.status).toBe('open')
    expect(store().data.entries.filter((e) => e.type === 'in')).toHaveLength(1)

    // Recebimento do restante (25).
    commit(store, (s) => s.settleAccountPartial(r.accountId!, 25))
    expect(store().data.accounts.find((a) => a.id === r.accountId)?.status).toBe('paid')

    // Receita/CMV/estoque permanecem.
    const k = kpis(store().data, monthPeriod(0))
    expect(k.revenue).toBe(40)
    expect(k.cogs).toBe(20)
    expect(store().data.products.find((p) => p.id === pid)!.stock).toBe(90)
    // Entradas de caixa acumuladas = 40 (15 + 25), sem duplicar.
    expect(k.inflow).toBe(40)
    unmount()
  })

  test('venda a prazo continua criando conta a receber; demais meios criam caixa', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct({ sku: 'P', name: 'P', category: 'G', unit: 'un', cost: 1, price: 2, stock: 100, minStock: 0 }))
    const credit = commit(store, (s) => s.recordSale({ method: 'prazo', items: [{ productId: pid, qty: 5, price: 2 }] }))
    expect(credit.ok).toBe(true)
    expect(credit.accountId).toBeTruthy()
    expect(store().data.entries.filter((e) => e.type === 'in')).toHaveLength(0)
    const cash = commit(store, (s) => s.recordSale({ method: 'dinheiro', items: [{ productId: pid, qty: 5, price: 2 }] }))
    expect(cash.ok).toBe(true)
    expect(cash.accountId).toBeUndefined()
    expect(store().data.entries.filter((e) => e.type === 'in')).toHaveLength(1)
    unmount()
  })
})
