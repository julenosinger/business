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

const intentOf = (accountId: string, saleId: string, amount = 15): Parameters<Store['createPaymentIntent']>[0] => ({
  saleId,
  accountId,
  amount,
  usdcMinor: String(BigInt(amount) * 1_000_000n),
  chainId: 5042,
  beneficiary: '0x000000000000000000000000000000000000000a',
  gatewayWallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
  token: '0x3600000000000000000000000000000000000000',
  currency: 'USDC',
  expiresAt: '2026-12-31T00:00:00.000Z',
})

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.1B.2.2 — Payment Intent persistente', () => {
  test('cria intenção vinculada à venda com valor exato (parcial 15 sobre 40)', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct({ sku: 'CAFE', name: 'Café', category: 'G', unit: 'un', cost: 2, price: 4, stock: 100, minStock: 0 }))
    const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!sale.ok || !sale.accountId) throw new Error('sale')
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(sale.accountId, sale.saleId, 15)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const intent = store().data.paymentIntents.find((i) => i.intentId === r.intentId)!
    expect(intent.saleId).toBe(sale.saleId)
    expect(intent.accountId).toBe(sale.accountId)
    expect(intent.amount).toBe(15)
    expect(intent.usdcMinor).toBe('15000000')
    expect(intent.state).toBe('CREATED')
    expect(intent.environment).toBe('mainnet')
    unmount()
  })

  test('rejeita obrigação inválida (não aberta ou de outra venda)', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct({ sku: 'P', name: 'P', category: 'G', unit: 'un', cost: 1, price: 2, stock: 100, minStock: 0 }))
    const s1 = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    const s2 = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!s1.ok || !s2.ok || !s1.accountId || !s2.accountId) throw new Error('sales')
    // obrigação de outra venda → not_found
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(s2.accountId!, s1.saleId))).ok).toBe(false)
    // valor inválido
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(s1.accountId, s1.saleId, 0))).ok).toBe(false)
    unmount()
  })

  test('transições de estado preservam campos financeiros e registram histórico', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct({ sku: 'P', name: 'P', category: 'G', unit: 'un', cost: 1, price: 2, stock: 100, minStock: 0 }))
    const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!sale.ok || !sale.accountId) throw new Error('sale')
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(sale.accountId, sale.saleId)))
    if (!r.ok) throw new Error('intent')
    const before = store().data.paymentIntents.find((i) => i.intentId === r.intentId)!
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'AWAITING_WALLET'))).toBe(true)
    const after = store().data.paymentIntents.find((i) => i.intentId === r.intentId)!
    expect(after.state).toBe('AWAITING_WALLET')
    expect(after.history).toHaveLength(2)
    // campos financeiros imutáveis
    expect(after.amount).toBe(before.amount)
    expect(after.beneficiary).toBe(before.beneficiary)
    expect(after.accountId).toBe(before.accountId)
    unmount()
  })
})
