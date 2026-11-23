import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Store } from '../src/lib/store'

// Configura o DOM (happy-dom) ANTES de importar React/store, que leem localStorage/document no carregamento.
try {
  GlobalRegistrator.register()
} catch {
  // Já registrado em outro arquivo de teste do mesmo processo.
}

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { StoreProvider, useStore } = await import('../src/lib/store')
const { setNetwork } = await import('../src/lib/network')

// Captura o store real retornado pelo provider (via efeito, para evitar efeito colateral durante render).
let captured: Store | null = null
function Capture(): null {
  const store = useStore()
  React.useEffect(() => {
    captured = store
  })
  return null
}

interface Rendered {
  store: () => Store
  unmount: () => void
}

function renderStore(): Rendered {
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

/** Executa a operação dentro de act (flush do re-render) e devolve o resultado + store atualizado. */
function commit<T>(store: () => Store, op: (s: Store) => T): T {
  let out: T = undefined as unknown as T
  React.act(() => {
    out = op(store())
  })
  return out
}

const contactInput = (over: Partial<Parameters<Store['addContact']>[0]> = {}): Parameters<Store['addContact']>[0] => ({
  kind: 'customer',
  name: 'Fulano',
  doc: '',
  email: '',
  phone: '',
  wallet: '',
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})

afterEach(() => {
  localStorage.clear()
})

describe('StoreProvider (integração real React)', () => {
  test('monta e expõe o store', () => {
    const { store, unmount } = renderStore()
    expect(store()).toBeTruthy()
    expect(store().data.contacts).toEqual([])
    unmount()
  })

  test('addContact retorna o ID efetivamente inserido', () => {
    const { store, unmount } = renderStore()
    const res = commit(store, (s) => s.addContact(contactInput({ name: 'A' })))
    expect(res.ok).toBe(true)
    const id = res.ok ? res.id : ''
    expect(store().data.contacts.find((c) => c.id === id)?.name).toBe('A')
    unmount()
  })

  test('addEmployee retorna o ID efetivamente inserido', () => {
    const { store, unmount } = renderStore()
    const res = commit(store, (s) => s.addEmployee({ name: 'E', role: 'r', salary: 1000, wallet: '', admission: '2026-01-01', active: true }))
    expect(res.ok).toBe(true)
    const id = res.ok ? res.id : ''
    expect(store().data.employees.find((e) => e.id === id)?.name).toBe('E')
    unmount()
  })

  test('duas submissões rápidas (mesmo tick) não criam duplicata', () => {
    const { store, unmount } = renderStore()
    const input = contactInput({ name: 'A', doc: '111.444.777-35' })
    let r1: ReturnType<Store['addContact']>
    let r2: ReturnType<Store['addContact']>
    React.act(() => {
      r1 = store().addContact(input)
      r2 = store().addContact(input)
    })
    expect(r1!.ok).toBe(true)
    expect(r2!.ok).toBe(false)
    expect(r2!.ok ? '' : r2!.code).toBe('duplicate')
    expect(store().data.contacts).toHaveLength(1)
    unmount()
  })

  test('documento inválido é rejeitado sem gravar', () => {
    const { store, unmount } = renderStore()
    const res = commit(store, (s) => s.addContact(contactInput({ doc: '111.444.777-36' })))
    expect(res.ok).toBe(false)
    expect(store().data.contacts).toHaveLength(0)
    unmount()
  })

  test('edição em ambiente incorreto retorna wrong_environment', () => {
    const { store, unmount } = renderStore()
    const add = commit(store, (s) => s.addContact(contactInput({ name: 'Mainnet' })))
    const id = add.ok ? add.id : ''
    setNetwork('testnet')
    const res = commit(store, (s) => s.updateContact(id, { name: 'X' }))
    expect(res.ok).toBe(false)
    expect(res.ok ? '' : res.code).toBe('wrong_environment')
    unmount()
  })

  test('edição preserva id e ambiente (mesmo com payload tentando alterar)', () => {
    const { store, unmount } = renderStore()
    const add = commit(store, (s) => s.addContact(contactInput({ name: 'A' })))
    const id = add.ok ? add.id : ''
    const res = commit(store, (s) => s.updateContact(id, { name: 'B', environment: 'testnet' }))
    expect(res.ok).toBe(true)
    const updated = store().data.contacts.find((c) => c.id === id)!
    expect(updated.name).toBe('B')
    expect(updated.environment).toBe('mainnet')
    unmount()
  })

  test('edição de registro inexistente retorna not_found', () => {
    const { store, unmount } = renderStore()
    const res = commit(store, (s) => s.updateContact('nope', { name: 'X' }))
    expect(res.ok).toBe(false)
    expect(res.ok ? '' : res.code).toBe('not_found')
    unmount()
  })

  test('atualizações intercaladas entre módulos não se perdem', () => {
    const { store, unmount } = renderStore()
    React.act(() => {
      store().addContact(contactInput({ name: 'C1' }))
      store().addProduct({ name: 'P', sku: 's', category: 'c', unit: 'un', cost: 1, price: 2, stock: 3, minStock: 0 })
      store().addContact(contactInput({ name: 'C2' }))
    })
    expect(store().data.contacts).toHaveLength(2)
    expect(store().data.products).toHaveLength(1)
    unmount()
  })

  test('isolamento Mainnet/Testnet: cadastro de um ambiente não aparece no outro', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.addContact(contactInput({ name: 'MainnetOnly' })))
    setNetwork('testnet')
    commit(store, (s) => s.addContact(contactInput({ name: 'TestnetOne' })))
    const main = store().data.contacts.filter((c) => c.environment === 'mainnet')
    const test = store().data.contacts.filter((c) => c.environment === 'testnet')
    expect(main.map((c) => c.name)).toContain('MainnetOnly')
    expect(test.map((c) => c.name)).toContain('TestnetOne')
    unmount()
  })

  test('persistência: o estado é gravado no localStorage após o commit', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.addContact(contactInput({ name: 'Persisted' })))
    // O useEffect de persistência roda dentro do act (flush); força um re-render adicional para garantir.
    React.act(() => {})
    const raw = localStorage.getItem('gbos:v1')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).contacts.some((c: { name: string }) => c.name === 'Persisted')).toBe(true)
    unmount()
  })
})
