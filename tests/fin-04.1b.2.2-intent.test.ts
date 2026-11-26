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
const { canTransitionIntent } = await import('../src/lib/payment-intent')

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

const BENEFICIARY = '0x000000000000000000000000000000000000000a'

const intentOf = (accountId: string, saleId: string, amount = 15): Parameters<Store['createPaymentIntent']>[0] => ({
  saleId,
  accountId,
  amount,
  usdcMinor: String(BigInt(amount) * 1_000_000n),
  currency: 'USDC',
  expiresAt: '2099-01-01T00:00:00.000Z',
})

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.1B.2.2A — Payment Intent autoritativo e protegido', () => {
  test('cria intenção parcial (15 sobre 40) resolvendo contratos e beneficiário automaticamente', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const pid = commit(store, (s) => s.addProduct({ sku: 'CAFE', name: 'Café', category: 'G', unit: 'un', cost: 2, price: 4, stock: 100, minStock: 0 }))
    const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!sale.ok || !sale.accountId) throw new Error('sale')
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(sale.accountId, sale.saleId, 15)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const intent = store().data.paymentIntents.find((i) => i.intentId === r.intentId)!
    expect(intent.amount).toBe(15)
    expect(intent.usdcMinor).toBe('15000000')
    expect(intent.chainId).toBe(5042)
    expect(intent.beneficiary).toBe(BENEFICIARY)
    expect(intent.token).toBe('0x3600000000000000000000000000000000000000')
    unmount()
  })

  test('rejeita quando não há beneficiário institucional configurado', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct({ sku: 'P', name: 'P', category: 'G', unit: 'un', cost: 1, price: 2, stock: 100, minStock: 0 }))
    const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!sale.ok || !sale.accountId) throw new Error('sale')
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(sale.accountId, sale.saleId))).ok).toBe(false)
    unmount()
  })

  test('rejeita valor acima do saldo e divergência monetária', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const pid = commit(store, (s) => s.addProduct({ sku: 'P', name: 'P', category: 'G', unit: 'un', cost: 1, price: 2, stock: 100, minStock: 0 }))
    const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!sale.ok || !sale.accountId) throw new Error('sale')
    // 50 sobre 40 → rejeitado.
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(sale.accountId, sale.saleId, 50))).ok).toBe(false)
    // valor 15 com usdcMinor de 150 USDC → rejeitado (divergência).
    expect(commit(store, (s) => s.createPaymentIntent({ ...intentOf(sale.accountId, sale.saleId, 15), usdcMinor: '150000000' })).ok).toBe(false)
    unmount()
  })

  test('reserva: intenção de 30 rejeitada após reserva de 15; 25 aceita', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const pid = commit(store, (s) => s.addProduct({ sku: 'P', name: 'P', category: 'G', unit: 'un', cost: 1, price: 2, stock: 100, minStock: 0 }))
    const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!sale.ok || !sale.accountId) throw new Error('sale')
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(sale.accountId, sale.saleId, 15))).ok).toBe(true)
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(sale.accountId, sale.saleId, 30))).ok).toBe(false) // 15+30 > 40
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(sale.accountId, sale.saleId, 25))).ok).toBe(true) // 15+25 = 40
    unmount()
  })

  test('idempotência: mesma chave retorna a intenção; parâmetros diferentes conflitam', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const pid = commit(store, (s) => s.addProduct({ sku: 'P', name: 'P', category: 'G', unit: 'un', cost: 1, price: 2, stock: 100, minStock: 0 }))
    const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!sale.ok || !sale.accountId) throw new Error('sale')
    const a = commit(store, (s) => s.createPaymentIntent({ ...intentOf(sale.accountId, sale.saleId), idempotencyKey: 'k1' }))
    const b = commit(store, (s) => s.createPaymentIntent({ ...intentOf(sale.accountId, sale.saleId), idempotencyKey: 'k1' }))
    expect(a.ok && b.ok && a.intentId === b.intentId).toBe(true)
    expect(store().data.paymentIntents).toHaveLength(1)
    const conflict = commit(store, (s) => s.createPaymentIntent({ ...intentOf(sale.accountId, sale.saleId, 20), idempotencyKey: 'k1' }))
    expect(conflict.ok ? '' : conflict.reason).toBe('conflict')
    unmount()
  })

  test('máquina de estados: proíbe CREATED → ONCHAIN_CONFIRMED', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const pid = commit(store, (s) => s.addProduct({ sku: 'P', name: 'P', category: 'G', unit: 'un', cost: 1, price: 2, stock: 100, minStock: 0 }))
    const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!sale.ok || !sale.accountId) throw new Error('sale')
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(sale.accountId, sale.saleId)))
    if (!r.ok) throw new Error('intent')
    expect(canTransitionIntent('CREATED', 'ONCHAIN_CONFIRMED')).toBe(false)
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'ONCHAIN_CONFIRMED'))).toBe(false)
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'AWAITING_WALLET'))).toBe(true)
    unmount()
  })
})
