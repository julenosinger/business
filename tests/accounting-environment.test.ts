import { beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Store } from '../src/lib/store'

try {
  GlobalRegistrator.register()
} catch {
  // Já registrado em outro arquivo de teste do mesmo processo.
}

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { StoreProvider, useStore, emptyData } = await import('../src/lib/store')
const { NavContext } = await import('../src/lib/nav')
const { Accounting } = await import('../src/pages/Accounting')
const { setNetwork } = await import('../src/lib/network')
const { setLang } = await import('../src/lib/i18n')

let captured: Store | null = null
function Capture(): null {
  const store = useStore()
  React.useEffect(() => {
    captured = store
  })
  return null
}

function makeNav() {
  return {
    page: 'accounting',
    go: () => {},
    payAccountId: null,
    requestPay: () => {},
    intent: null,
    requestIntent: () => {},
    ledgerFocus: null,
    focusLedger: () => {},
    clearLedgerFocus: () => {},
    profileIntent: null,
    openProfileIntent: () => {},
    clearProfileIntent: () => {},
  }
}

function render(component: React.ReactElement): { container: HTMLElement; store: () => Store; unmount: () => void } {
  captured = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  React.act(() => {
    root.render(React.createElement(NavContext.Provider, { value: makeNav() }, React.createElement(StoreProvider, null, React.createElement(Capture), component)))
  })
  return {
    container,
    store: () => captured!,
    unmount: () => {
      React.act(() => root.unmount())
      container.remove()
      captured = null
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
  setLang('pt')
})

describe('Contabilidade (componente real): isolamento financeiro por ambiente', () => {
  test('Receita bruta/fluxo refletem apenas a Mainnet (dados Testnet históricos não aparecem)', () => {
    // Injeta um lançamento Mainnet e um Testnet histórico (campo environment), sem rede ativa mutável.
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        store().importData({
          ...emptyData(),
          entries: [
            { id: 'e-m', date: '2026-11-20', type: 'in', category: 'Serviços prestados', description: 'Receita Mainnet', amount: 1234, environment: 'mainnet' },
            { id: 'e-t', date: '2026-11-20', type: 'in', category: 'Serviços prestados', description: 'Receita Testnet', amount: 9876, environment: 'testnet' },
          ],
        })
      })
      unmount()
    }

    const { container, unmount } = render(React.createElement(Accounting))
    expect(container.textContent).toContain('1.234')
    expect(container.textContent).not.toContain('9.876')
    unmount()
  })
})

describe('proteção de lançamentos entre ambientes e classificação', () => {
  test('editar lançamento de outro ambiente é bloqueado (sem alteração)', () => {
    const { store, unmount } = render(React.createElement('div'))
    React.act(() => {
      store().importData({ ...emptyData(), entries: [{ id: 'e-t', date: '2026-11-20', type: 'in', category: 'Serviços prestados', description: 'Testnet', amount: 50, environment: 'testnet' }] })
    })
    React.act(() => {
      store().updateEntry('e-t', { description: 'Alterado' })
    })
    expect(store().data.entries.find((e) => e.id === 'e-t')!.description).toBe('Testnet')
    unmount()
  })

  test('excluir lançamento de outro ambiente é bloqueado (registro preservado)', () => {
    const { store, unmount } = render(React.createElement('div'))
    React.act(() => {
      store().importData({ ...emptyData(), entries: [{ id: 'e-t', date: '2026-11-20', type: 'in', category: 'Serviços prestados', description: 'Testnet', amount: 50, environment: 'testnet' }] })
    })
    React.act(() => {
      store().removeEntry('e-t')
    })
    expect(store().data.entries.some((e) => e.id === 'e-t')).toBe(true)
    unmount()
  })

  test('setEntryEnvironment classifica lançamento unassigned com auditoria', () => {
    const { store, unmount } = render(React.createElement('div'))
    React.act(() => {
      store().importData({
        ...emptyData(),
        entries: [{ id: 'legacy', date: '2026-11-20', type: 'in', category: 'Vendas', description: 'Legado', amount: 100 }],
      })
    })
    React.act(() => {
      expect(store().setEntryEnvironment('legacy', 'mainnet')).toEqual({ ok: true })
    })
    expect(store().data.entries.find((e) => e.id === 'legacy')!.environment).toBe('mainnet')
    unmount()
  })

  test('setEntryEnvironment recusa reclassificar lançamento já classificado', () => {
    let entryId = ''
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        store().addEntry({ type: 'in', category: 'Serviços prestados', description: 'Mainnet', amount: 10, date: '2026-11-20' })
      })
      entryId = store().data.entries.find((e) => e.description === 'Mainnet')!.id
      unmount()
    }
    const { store, unmount } = render(React.createElement('div'))
    React.act(() => {
      expect(store().setEntryEnvironment(entryId, 'testnet')).toEqual({ ok: false, reason: 'already_classified' })
    })
    expect(store().data.entries.find((e) => e.id === entryId)!.environment).toBe('mainnet')
    unmount()
  })

  test('clearSandboxData é inerte: o app é Mainnet-only (nada é removido)', () => {
    const { store, unmount } = render(React.createElement('div'))
    React.act(() => {
      store().importData({
        ...emptyData(),
        contacts: [
          { id: 'c-m', kind: 'customer', name: 'Mainnet', doc: '', email: '', phone: '', wallet: '', environment: 'mainnet' },
          { id: 'c-t', kind: 'customer', name: 'Testnet', doc: '', email: '', phone: '', wallet: '', environment: 'testnet' },
        ],
        entries: [
          { id: 'e-m', date: '2026-11-20', type: 'in', category: 'Vendas', description: 'M', amount: 10, environment: 'mainnet' },
          { id: 'e-t', date: '2026-11-20', type: 'in', category: 'Vendas', description: 'T', amount: 20, environment: 'testnet' },
        ],
      })
    })
    React.act(() => {
      store().clearSandboxData() // sem rede Testnet ativa → no-op
    })
    const d = store().data
    expect(d.contacts.some((c) => c.id === 'c-m')).toBe(true)
    expect(d.contacts.some((c) => c.id === 'c-t')).toBe(true) // preservado (sem exclusão)
    expect(d.entries.some((e) => e.id === 'e-t')).toBe(true)
    unmount()
  })

  test('loadSandboxDemo é inerte: retorna wrong_environment (sem rede Testnet)', () => {
    const { store, unmount } = render(React.createElement('div'))
    let res: unknown
    React.act(() => {
      res = store().loadSandboxDemo()
    })
    expect(res).toEqual({ ok: false, reason: 'wrong_environment' })
    expect(store().data.products).toHaveLength(0)
    unmount()
  })

  test('addEntry/updateEntry/removeEntry retornam resultado explícito (sem falso sucesso)', () => {
    const { store, unmount } = render(React.createElement('div'))
    setNetwork('mainnet')
    let entryId = ''
    React.act(() => {
      expect(store().addEntry({ type: 'in', category: 'Serviços prestados', description: 'X', amount: 10, date: '2026-11-20' })).toEqual({ ok: true })
    })
    entryId = store().data.entries.find((e) => e.description === 'X')!.id
    React.act(() => {
      expect(store().updateEntry(entryId, { description: 'Y' })).toEqual({ ok: true })
      expect(store().updateEntry('nao-existe', { description: 'Z' })).toEqual({ ok: false, reason: 'not_found' })
      expect(store().removeEntry('nao-existe')).toEqual({ ok: false, reason: 'not_found' })
    })
    expect(store().data.entries.find((e) => e.id === entryId)!.description).toBe('Y')
    unmount()
  })
})
