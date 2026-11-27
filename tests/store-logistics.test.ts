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
import type { ShipmentInput } from '../src/lib/logistics'

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

const shipmentInput = (over: Partial<ShipmentInput> = {}): ShipmentInput => ({
  direction: 'outbound',
  origin: { name: 'Depósito', city: 'São Paulo', country: 'BR' },
  destination: { name: 'Cliente', city: 'Rio de Janeiro', country: 'BR' },
  senderName: 'Depósito',
  recipientName: 'Cliente',
  carrier: '',
  trackingNumber: '',
  method: 'Padrão',
  packages: [],
  items: [],
  declaredValue: 0,
  currency: 'USDC',
  freightCost: 0,
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})

afterEach(() => {
  localStorage.clear()
})

describe('Logística (integridade de resultado no store real)', () => {
  test('criação válida de remessa retorna sucesso e altera o estado', () => {
    const { store, unmount } = renderStore()
    const res = commit(store, (s) => s.createShipment(shipmentInput()))
    expect(res.ok).toBe(true)
    const id = res.ok ? res.value.id : ''
    expect(store().data.shipments.find((s) => s.id === id)).toBeTruthy()
    unmount()
  })

  test('operação inválida retorna erro sem modificar o estado', () => {
    const { store, unmount } = renderStore()
    const before = store().data.shipments.length
    const res = commit(store, (s) => s.transitionShipment('SHP-9999', 'dispatched'))
    expect(res.ok).toBe(false)
    expect(store().data.shipments.length).toBe(before)
    unmount()
  })

  test('resultado retornado corresponde ao commit realizado', () => {
    const { store, unmount } = renderStore()
    const res = commit(store, (s) => s.createShipment(shipmentInput()))
    expect(res.ok).toBe(true)
    const id = res.ok ? res.value.id : ''
    // O ID retornado é exatamente o ID da remessa gravada.
    expect(store().data.shipments.find((s) => s.id === id)?.id).toBe(id)
    unmount()
  })

  test('duas operações rápidas no mesmo ciclo não duplicam remessas', () => {
    const { store, unmount } = renderStore()
    let r1: ReturnType<Store['createShipment']>
    let r2: ReturnType<Store['createShipment']>
    React.act(() => {
      r1 = store().createShipment(shipmentInput())
      r2 = store().createShipment(shipmentInput())
    })
    expect(r1!.ok).toBe(true)
    expect(r2!.ok).toBe(true)
    expect(store().data.shipments).toHaveLength(2)
    // IDs distintos, sem sobrescrita.
    expect(r1!.ok && r2!.ok ? r1!.value.id !== r2!.value.id : false).toBe(true)
    unmount()
  })

  test('atualizações intercaladas entre Logística e Estoque não se perdem', () => {
    const { store, unmount } = renderStore()
    React.act(() => {
      store().createShipment(shipmentInput())
      store().addProduct({ name: 'P', sku: 's', category: 'c', unit: 'un', cost: 1, price: 2, stock: 3, minStock: 0 })
      store().createShipment(shipmentInput())
    })
    expect(store().data.shipments).toHaveLength(2)
    expect(store().data.products).toHaveLength(1)
    unmount()
  })

  test('isolamento Mainnet/Testnet em remessas', () => {
    const { store, unmount } = renderStore()
    const sid = commit(store, (s) => s.createShipment(shipmentInput()))
    // Injeta uma remessa Testnet histórica (campo environment).
    commit(store, (s) => s.importData({ ...s.data, shipments: [...s.data.shipments, { ...s.data.shipments.find((x) => x.id === sid)!, id: 's-t', environment: 'testnet' }] }))
    const main = store().data.shipments.filter((s) => s.environment === 'mainnet')
    const test = store().data.shipments.filter((s) => s.environment === 'testnet')
    expect(main).toHaveLength(1)
    expect(test).toHaveLength(1)
    unmount()
  })
})
