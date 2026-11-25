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
const { kpis, monthPeriod, stockValue, accountTotals } = await import('../src/lib/selectors')
const { trialBalance } = await import('../src/lib/accounting/engine')

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

describe('cenário de certificação FIN-02.0.1 (catálogo vazio → primeira compra)', () => {
  test('reprodução integral: começa do zero, sem estoque fictício', () => {
    const { store, unmount } = renderStore()
    const s = store()

    // Catálogo e estoque vazios no início.
    expect(s.data.products).toHaveLength(0)
    expect(s.data.sales).toHaveLength(0)
    expect(s.data.accounts).toHaveLength(0)

    // Adapters contábeis relevantes habilitados.
    commit(store, (x) => x.setLedgerAdapter('purchases', true))
    commit(store, (x) => x.setLedgerAdapter('payables', true))
    commit(store, (x) => x.setLedgerAdapter('sales', true))

    // 1) Cadastrar produto pelo formulário de compras (quantidade zero, custo 5, preço 8).
    const pid = commit(store, (x) => x.addProduct({ sku: 'P1', name: 'Produto', category: 'Geral', unit: 'un', cost: 5, price: 8, stock: 0, minStock: 0 }))
    expect(typeof pid).toBe('string')
    expect(store().data.products.find((p) => p.id === pid)?.stock).toBe(0)
    expect(store().data.moves).toHaveLength(0) // sem movimentação fictícia

    // 2) Comprar 100 a 5 (a prazo).
    commit(store, (x) => x.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: pid, qty: 100, cost: 5 }] }))
    // 3) Comprar 20 a 6 (a prazo).
    commit(store, (x) => x.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: pid, qty: 20, cost: 6 }] }))

    const beforeSale = store().data.products.find((p) => p.id === pid)!
    expect(beforeSale.stock).toBe(120)
    expect(beforeSale.cost).toBeCloseTo(620 / 120, 10) // custo médio ~5,1667

    // 4) Vender 30 a 8.
    commit(store, (x) => x.recordSale({ method: 'pix', items: [{ productId: pid, qty: 30, price: 8 }] }))

    // 5) Liquidar as duas obrigações.
    for (const a of store().data.accounts.filter((a) => a.kind === 'payable')) commit(store, (x) => x.settleAccount(a.id))

    // 6) Despesa operacional de 10 (paga).
    commit(store, (x) => x.addEntry({ date: new Date().toISOString().slice(0, 10), type: 'out', category: 'Aluguel', description: 'Despesa', amount: 10 }))

    const d = store().data
    const k = kpis(d, monthPeriod(0))

    // Total de compras (a prazo, reconhecido no estoque).
    expect(d.purchases.reduce((sum, p) => sum + p.total, 0)).toBe(620)

    // Estoque final e valor.
    const prod = d.products.find((p) => p.id === pid)!
    expect(prod.stock).toBe(90)
    expect(Math.round(stockValue(d) * 100) / 100).toBe(465)

    // Resultado econômico.
    expect(k.revenue).toBe(240)
    expect(k.cogs).toBe(155)
    expect(k.grossProfit).toBe(85)
    expect(k.opex).toBe(10)
    expect(k.profit).toBe(75)
    expect(Math.round((k.profit / k.revenue) * 10000) / 100).toBe(31.25)

    // Fluxo de caixa.
    expect(k.inflow).toBe(240)
    expect(k.outflow).toBe(630)
    expect(k.inflow - k.outflow).toBe(-390)

    // Obrigações em aberto: zero.
    expect(accountTotals(d).payable).toBe(0)
    expect(d.accounts.filter((a) => a.status === 'open')).toHaveLength(0)

    // Débitos e créditos equilibrados.
    const tb = trialBalance(d.ledger, { currency: 'USDC' })[0]
    expect(tb?.balanced).toBe(true)

    unmount()
  })

  test('addProduct retorna o id e não gera movimentação quando estoque é zero', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (x) => x.addProduct({ sku: 'P', name: 'P', category: 'G', unit: 'un', cost: 5, price: 8, stock: 0, minStock: 0 }))
    expect(id).toBeTruthy()
    expect(store().data.products.find((p) => p.id === id)).toBeTruthy()
    expect(store().data.moves).toHaveLength(0)
    expect(store().data.entries).toHaveLength(0)
    unmount()
  })
})
