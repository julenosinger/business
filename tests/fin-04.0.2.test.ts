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
const { remainingPurchaseAllocation, allocatePurchaseValue } = await import('../src/lib/receiving')
import type { PurchaseRef, GoodsReceipt } from '../src/lib/types'

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

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.0.2 — custo zero e alocação determinística', () => {
  test('aquisição de custo zero dilui o custo médio (recordPurchase)', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct(prod({ cost: 5, stock: 10 })))
    commit(store, (s) => s.recordPurchase({ paidNow: false, dueDate: '2026-12-31', items: [{ productId: pid, qty: 10, cost: 0 }] }))
    const p = store().data.products.find((x) => x.id === pid)!
    expect(p.stock).toBe(20)
    expect(p.cost).toBeCloseTo(2.5, 10) // (10*5 + 10*0)/20
    unmount()
  })

  test('allocatePurchaseValue trata custo zero válido', () => {
    expect(allocatePurchaseValue([{ cost: 0, qty: 10 }], 10, 5)).toBe(0)
  })

  test('remainingPurchaseAllocation consome recebimentos anteriores (alocação persistente)', () => {
    const purchase = {
      id: 'PUR-1',
      items: [
        { productId: 'p', name: 'Arroz', sku: 'A', qty: 100, cost: 5 },
        { productId: 'p', name: 'Arroz', sku: 'A', qty: 20, cost: 6 },
      ],
    } as unknown as PurchaseRef
    const prior: GoodsReceipt[] = [
      { id: 'GR-1', orgId: 'local', shipmentId: 'S1', purchaseId: 'PUR-1', lines: [{ itemId: 'i1', productId: 'p', name: 'Arroz', sku: 'A', expectedQty: 60, receivedQty: 60, damagedQty: 0, acceptedQty: 60, discrepancy: 'short' }], stockMode: 'posted', notes: '', receivedAt: '2026-11-21T10:00:00.000Z', receivedBy: 't' },
    ]
    const remaining = remainingPurchaseAllocation(purchase, prior)
    expect(remaining.get('p')).toEqual([
      { cost: 5, qty: 40 },
      { cost: 6, qty: 20 },
    ])
    // Segundo recebimento: 40 a 5 + 20 a 6 = 320.
    expect(allocatePurchaseValue(remaining.get('p')!, 60, 0)).toBeCloseTo(320, 10)
  })
})

describe('FIN-04.0.2 — associação individual por liquidação', () => {
  test('três liquidações da mesma conta geram entradas com settlementId distintos', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addAccount({ kind: 'receivable', description: 'Serviço', contactName: 'Cliente', amount: 100, dueDate: '2026-12-31', category: 'Serviços prestados' }))
    commit(store, (s) => s.settleAccountPartial(id, 30))
    commit(store, (s) => s.settleAccountPartial(id, 20))
    commit(store, (s) => s.settleAccountPartial(id, 50))
    const entries = store().data.entries.filter((e) => e.sourceKind === 'account' && e.sourceId === id)
    expect(entries).toHaveLength(3)
    // settlementId único por liquidação (vínculo inequívoco).
    expect(new Set(entries.map((e) => e.settlementId)).size).toBe(3)
    expect(entries.map((e) => e.amount).sort((a, b) => a - b)).toEqual([20, 30, 50])
    // saldo pendente zero
    expect(store().data.accounts.find((a) => a.id === id)?.status).toBe('paid')
    unmount()
  })
})
