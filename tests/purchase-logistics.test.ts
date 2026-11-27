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

const addSupplier = (store: () => Store): string => {
  const r = commit(store, (s) => s.addContact({ kind: 'supplier', name: 'Fornecedor', doc: '', email: '', phone: '', wallet: '' }))
  return r.ok ? r.id : ''
}

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('Compras — aguardar recebimento cria remessa na Logística Global', () => {
  test('cria compra sem estoque + remessa de entrada ligada + conta a pagar', () => {
    const { store, unmount } = renderStore()
    const supplierId = addSupplier(store)
    const pid = commit(store, (s) => s.addProduct({ sku: 'P1', name: 'Produto', category: 'Geral', unit: 'un', cost: 5, price: 8, stock: 0, minStock: 0 }))

    const ok = commit(store, (s) => s.recordPurchase({ supplierId, paidNow: false, dueDate: '2026-12-31', awaitReceipt: true, items: [{ productId: pid, qty: 10, cost: 5 }] }))
    expect(ok).toBe(true)

    const d = store().data
    const purchase = d.purchases[0]!
    expect(purchase.stockPosted).toBe(false)
    expect(d.products.find((p) => p.id === pid)?.stock).toBe(0) // estoque não muda ainda
    expect(d.moves).toHaveLength(0)

    // Remessa de entrada criada automaticamente, ligada à compra, em `ready`.
    const shipment = d.shipments.find((s) => s.orderRef?.kind === 'purchase' && s.orderRef.id === purchase.id)
    expect(shipment).toBeTruthy()
    expect(shipment!.direction).toBe('inbound')
    expect(shipment!.status).toBe('ready')
    expect(shipment!.items).toHaveLength(1)
    expect(shipment!.items[0]!.productId).toBe(pid)
    expect(shipment!.items[0]!.qty).toBe(10)

    // Conta a pagar aberta (não há entrada de caixa).
    expect(d.accounts.some((a) => a.kind === 'payable' && a.source === 'purchase' && a.status === 'open')).toBe(true)
    expect(d.entries.filter((e) => e.sourceKind === 'purchase')).toHaveLength(0)
    unmount()
  })

  test('marcar como recebido soma estoque, recalcula custo médio e marca a compra como lançada', () => {
    const { store, unmount } = renderStore()
    const supplierId = addSupplier(store)
    const pid = commit(store, (s) => s.addProduct({ sku: 'P1', name: 'Produto', category: 'Geral', unit: 'un', cost: 5, price: 8, stock: 0, minStock: 0 }))

    commit(store, (s) => s.recordPurchase({ supplierId, paidNow: false, dueDate: '2026-12-31', awaitReceipt: true, items: [{ productId: pid, qty: 10, cost: 8 }] }))
    const shipment = store().data.shipments.find((s) => s.orderRef?.kind === 'purchase')!

    const res = commit(store, (s) =>
      s.receiveShipmentGoods(shipment.id, { lines: shipment.items.map((i) => ({ itemId: i.id, receivedQty: i.qty, damagedQty: 0 })), notes: '' }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const d = store().data
    const product = d.products.find((p) => p.id === pid)!
    expect(product.stock).toBe(10)
    expect(product.cost).toBeCloseTo(8, 10) // custo médio: 0@5 + 10@8 → 8
    expect(d.purchases[0]!.stockPosted).toBe(true)
    expect(d.receipts).toHaveLength(1)
    unmount()
  })

  test('lança na contabilidade ao receber quando o adaptador purchases está ligado', () => {
    const { store, unmount } = renderStore()
    const supplierId = addSupplier(store)
    const pid = commit(store, (s) => s.addProduct({ sku: 'P1', name: 'Produto', category: 'Geral', unit: 'un', cost: 5, price: 8, stock: 0, minStock: 0 }))
    commit(store, (s) => s.setLedgerAdapter('purchases', true))

    commit(store, (s) => s.recordPurchase({ supplierId, paidNow: false, dueDate: '2026-12-31', awaitReceipt: true, items: [{ productId: pid, qty: 10, cost: 8 }] }))
    const purchaseId = store().data.purchases[0]!.id
    // Antes do recebimento, nada lançado no razão.
    expect(store().data.ledger.events.some((e) => e.idempotencyKey === `purchase:${purchaseId}:recorded`)).toBe(false)

    const shipment = store().data.shipments.find((s) => s.orderRef?.kind === 'purchase')!
    commit(store, (s) => s.receiveShipmentGoods(shipment.id, { lines: shipment.items.map((i) => ({ itemId: i.id, receivedQty: i.qty, damagedQty: 0 })), notes: '' }))

    // Depois do recebimento, o evento purchase.recorded entra no razão.
    expect(store().data.ledger.events.some((e) => e.idempotencyKey === `purchase:${purchaseId}:recorded` && e.status === 'posted')).toBe(true)
    unmount()
  })
})

describe('Compras — "Pago agora" não liquida sem evidência', () => {
  test('cria conta a pagar (aberta) em vez de entrada de caixa', () => {
    const { store, unmount } = renderStore()
    const supplierId = addSupplier(store)
    const pid = commit(store, (s) => s.addProduct({ sku: 'P1', name: 'Produto', category: 'Geral', unit: 'un', cost: 5, price: 8, stock: 0, minStock: 0 }))

    const ok = commit(store, (s) => s.recordPurchase({ supplierId, paidNow: true, dueDate: '', items: [{ productId: pid, qty: 10, cost: 5 }] }))
    expect(ok).toBe(true)

    const d = store().data
    // Estoque somado imediatamente (compra sem aguardar recebimento).
    expect(d.products.find((p) => p.id === pid)?.stock).toBe(10)
    // Nenhuma entrada de caixa fabricada; existe uma conta a pagar aberta.
    expect(d.entries.filter((e) => e.sourceKind === 'purchase')).toHaveLength(0)
    const payable = d.accounts.find((a) => a.kind === 'payable' && a.source === 'purchase')
    expect(payable).toBeTruthy()
    expect(payable!.status).toBe('open')
    expect(payable!.dueDate).toBe(d.purchases[0]!.date) // vencimento hoje
    unmount()
  })

  test('compra sem aguardar recebimento continua somando estoque + custo imediatamente', () => {
    const { store, unmount } = renderStore()
    const supplierId = addSupplier(store)
    const pid = commit(store, (s) => s.addProduct({ sku: 'P1', name: 'Produto', category: 'Geral', unit: 'un', cost: 5, price: 8, stock: 10, minStock: 0 }))

    commit(store, (s) => s.recordPurchase({ supplierId, paidNow: false, dueDate: '2026-12-31', items: [{ productId: pid, qty: 10, cost: 8 }] }))
    const d = store().data
    const product = d.products.find((p) => p.id === pid)!
    expect(product.stock).toBe(20)
    expect(product.cost).toBeCloseTo((10 * 5 + 10 * 8) / 20, 10) // média ponderada
    expect(d.shipments).toHaveLength(0) // sem remessa (não aguardava recebimento)
    expect(d.moves.filter((m) => m.kind === 'in' && m.productId === pid)).toHaveLength(2) // estoque inicial + compra
    unmount()
  })
})
