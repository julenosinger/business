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
  sku: 'SKU', name: 'Produto', category: 'Geral', unit: 'un', cost: 5, price: 8, stock: 0, minStock: 0, ...over,
})
const supplier = (): Parameters<Store['addContact']>[0] => ({ kind: 'supplier', name: 'Fornecedor', doc: '', email: '', phone: '', wallet: '' })

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.0 — integridade de recordPurchase e vínculos (pendências INV-1.0.1)', () => {
  test('recordPurchase retorna false e não grava para quantidade inválida (sem conversão em zero)', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct(prod({ sku: 'P1' })))
    const before = JSON.stringify(store().data)
    expect(commit(store, (s) => s.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: pid, qty: Number.NaN, cost: 5 }] }))).toBe(false)
    expect(commit(store, (s) => s.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: pid, qty: -3, cost: 5 }] }))).toBe(false)
    expect(commit(store, (s) => s.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: pid, qty: 5, cost: Number.NaN }] }))).toBe(false)
    expect(JSON.stringify(store().data)).toBe(before)
    expect(store().data.purchases).toHaveLength(0)
    unmount()
  })

  test('recordPurchase retorna false para produto de outro ambiente', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct(prod({ sku: 'P1' })))
    setNetwork('testnet')
    expect(commit(store, (s) => s.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: pid, qty: 5, cost: 5 }] }))).toBe(false)
    expect(store().data.purchases).toHaveLength(0)
    unmount()
  })

  test('recordPurchase retorna false para fornecedor de outro ambiente', () => {
    const { store, unmount } = renderStore()
    const sid = commit(store, (s) => { const r = s.addContact(supplier()); return r.ok ? r.id : '' })
    setNetwork('testnet')
    const pid = commit(store, (s) => s.addProduct(prod({ sku: 'P1' })))
    expect(commit(store, (s) => s.recordPurchase({ supplierId: sid, paidNow: false, dueDate: '2026-12-31', items: [{ productId: pid, qty: 5, cost: 5 }] }))).toBe(false)
    expect(store().data.purchases).toHaveLength(0)
    unmount()
  })

  test('addProduct rejeita fornecedor vinculado de outro ambiente', () => {
    const { store, unmount } = renderStore()
    const sid = commit(store, (s) => { const r = s.addContact(supplier()); return r.ok ? r.id : '' })
    setNetwork('testnet')
    expect(commit(store, (s) => s.addProduct(prod({ sku: 'P1', primarySupplierId: sid })))).toBe('')
    expect(store().data.products).toHaveLength(0)
    unmount()
  })

  test('addProduct normaliza SKU (trim)', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addProduct(prod({ sku: '  ABC123  ' })))
    expect(store().data.products.find((x) => x.id === id)?.sku).toBe('ABC123')
    unmount()
  })

  test('recordPurchase aceita compra válida e retorna true', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct(prod({ sku: 'P1' })))
    expect(commit(store, (s) => s.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: pid, qty: 10, cost: 5 }] }))).toBe(true)
    expect(store().data.purchases).toHaveLength(1)
    unmount()
  })
})
