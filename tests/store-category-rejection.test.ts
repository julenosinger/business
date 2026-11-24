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

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})

afterEach(() => {
  localStorage.clear()
})

describe('rejeição de categoria não suportada no Store (FIN-03.2)', () => {
  test('addEntry rejeita categoria supported:false sem gravar', () => {
    const { store, unmount } = renderStore()
    const res = commit(store, (s) => s.addEntry({ date: '2026-11-22', type: 'in', category: 'Reembolsos', description: 'x', amount: 100 }))
    expect(res.ok).toBe(false)
    expect(res.ok ? '' : res.reason).toBe('unsupported_category')
    expect(store().data.entries).toHaveLength(0)
    unmount()
  })

  test('addAccount rejeita categoria supported:false sem gravar', () => {
    const { store, unmount } = renderStore()
    const id = commit(store, (s) => s.addAccount({ kind: 'payable', description: 'x', contactName: 'c', amount: 100, dueDate: '2026-12-01', category: 'Equipamentos' }))
    expect(id).toBe('')
    expect(store().data.accounts).toHaveLength(0)
    unmount()
  })

  test('categorias suportadas continuam sendo gravadas', () => {
    const { store, unmount } = renderStore()
    const res = commit(store, (s) => s.addEntry({ date: '2026-11-22', type: 'out', category: 'Aluguel', description: 'x', amount: 100 }))
    expect(res.ok).toBe(true)
    expect(store().data.entries).toHaveLength(1)
    unmount()
  })
})
