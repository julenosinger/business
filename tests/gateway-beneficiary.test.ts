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
const { treasuryRecipientFor } = await import('../src/lib/gateway-config')

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

const A = '0x000000000000000000000000000000000000000a'
const B = '0x000000000000000000000000000000000000000b'

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.1B.2.1A — isolamento de beneficiários por ambiente', () => {
  test('beneficiários independentes por ambiente, sem fallback entre si', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: A } }))
    expect(treasuryRecipientFor(store().data.settings, 'mainnet')).toBe(A)
    expect(treasuryRecipientFor(store().data.settings, 'testnet')).toBe('') // não configurado

    commit(store, (s) => s.updateSettings({ treasuryRecipients: { ...s.data.settings.treasuryRecipients, testnet: B } }))
    expect(treasuryRecipientFor(store().data.settings, 'mainnet')).toBe(A) // não sobrescrito
    expect(treasuryRecipientFor(store().data.settings, 'testnet')).toBe(B)

    // Remover testnet não reativa mainnet nem legado.
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: A } }))
    expect(treasuryRecipientFor(store().data.settings, 'testnet')).toBe('')
    expect(treasuryRecipientFor(store().data.settings, 'mainnet')).toBe(A)
    unmount()
  })
})
