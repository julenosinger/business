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
const { accountOutstanding } = await import('../src/lib/selectors')

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

const requestOf = (accountId: string, fiatAmount: number): Parameters<Store['addRequest']>[0] => ({
  accountId,
  description: 'Venda',
  fiatAmount,
  amount: `${fiatAmount}.000308`,
  chainKey: 'Arc',
  chainId: 5042,
  recipient: '0xInstitucional',
  fromBlock: '1',
})

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.1B.1 — liquidação baseada no valor efetivamente recebido', () => {
  test('receiveRequest liquida exatamente o valor recebido, não o saldo em aberto', () => {
    const { store, unmount } = renderStore()
    const accId = commit(store, (s) => s.addAccount({ kind: 'receivable', description: 'Venda USDC', contactName: 'Cliente', amount: 40, dueDate: '2026-12-31', category: 'Vendas' }))
    const reqId = commit(store, (s) => s.addRequest(requestOf(accId, 15)))
    commit(store, (s) => s.receiveRequest(reqId, '0xabc', 'payer', 'https://x/0xabc'))
    const acc = store().data.accounts.find((a) => a.id === accId)!
    expect(accountOutstanding(acc)).toBe(25) // 40 - 15, nunca 0
    expect(acc.status).toBe('open')
    expect((acc.settlements ?? []).reduce((s, x) => s + x.amount, 0)).toBe(15)
    expect(store().data.requests.find((r) => r.id === reqId)?.status).toBe('paid')
    unmount()
  })

  test('receiveRequest sem obrigação aberta não fabrica entrada de caixa genérica', () => {
    const { store, unmount } = renderStore()
    const accId = commit(store, (s) => s.addAccount({ kind: 'receivable', description: 'Venda USDC', contactName: 'Cliente', amount: 40, dueDate: '2026-12-31', category: 'Vendas' }))
    commit(store, (s) => s.settleAccount(accId)) // já liquidada
    const reqId = commit(store, (s) => s.addRequest(requestOf(accId, 15)))
    const entriesBefore = store().data.entries.length
    commit(store, (s) => s.receiveRequest(reqId, '0xabc', 'payer', 'https://x/0xabc'))
    expect(store().data.requests.find((r) => r.id === reqId)?.status).toBe('paid')
    expect(store().data.entries.length).toBe(entriesBefore) // nenhuma entrada nova
    unmount()
  })

  test('cancelSale não registra estorno quando a venda USDC não foi recebida', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct({ sku: 'CAFE', name: 'Café', category: 'G', unit: 'un', cost: 2, price: 4, stock: 100, minStock: 0 }))
    const r = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!r.ok) throw new Error('sale')
    const outsBefore = store().data.entries.filter((e) => e.type === 'out').length
    commit(store, (s) => s.cancelSale(r.saleId))
    expect(store().data.entries.filter((e) => e.type === 'out')).toHaveLength(outsBefore) // sem saída fictícia
    unmount()
  })

  test('cancelSale estorna somente o valor efetivamente recebido', () => {
    const { store, unmount } = renderStore()
    const pid = commit(store, (s) => s.addProduct({ sku: 'CAFE', name: 'Café', category: 'G', unit: 'un', cost: 2, price: 4, stock: 100, minStock: 0 }))
    const r = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
    if (!r.ok || !r.accountId) throw new Error('sale')
    commit(store, (s) => s.settleAccountPartial(r.accountId!, 15))
    commit(store, (s) => s.cancelSale(r.saleId))
    const refund = store().data.entries.find((e) => e.type === 'out' && e.sourceId === r.saleId)
    expect(refund?.amount).toBe(15) // só os 15 recebidos, nunca 40
    unmount()
  })
})
