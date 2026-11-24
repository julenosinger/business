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
const { StoreProvider, useStore } = await import('../src/lib/store')
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
  test('Receita bruta/fluxo refletem apenas o ambiente ativo (Mainnet e Testnet)', () => {
    // Cria um lançamento em cada ambiente, com valores distintos.
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        setNetwork('mainnet')
        store().addEntry({ type: 'in', category: 'Serviços prestados', description: 'Receita Mainnet', amount: 1234, date: '2026-11-20' })
      })
      React.act(() => {
        setNetwork('testnet')
        store().addEntry({ type: 'in', category: 'Serviços prestados', description: 'Receita Testnet', amount: 9876, date: '2026-11-20' })
      })
      unmount()
    }

    setNetwork('mainnet')
    const { container, unmount } = render(React.createElement(Accounting))
    expect(container.textContent).toContain('1.234')
    expect(container.textContent).not.toContain('9.876')
    unmount()

    setNetwork('testnet')
    const test = render(React.createElement(Accounting))
    expect(test.container.textContent).toContain('9.876')
    expect(test.container.textContent).not.toContain('1.234')
    test.unmount()
  })
})
