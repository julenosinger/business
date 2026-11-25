import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Store } from '../src/lib/store'

try {
  GlobalRegistrator.register()
} catch {
  // já registrado
}

const React = await import('react')

// framer-motion não é relevante para a lógica testada; substituído por elementos simples.
const MOTION_PROPS = new Set(['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'variants', 'drag', 'dragConstraints', 'layout', 'layoutId'])
mock.module('framer-motion', () => {
  const el = (tag: string) => ({ children, ...props }: Record<string, unknown>) => {
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(props)) if (!MOTION_PROPS.has(k)) clean[k] = v
    return React.createElement(tag, clean, children)
  }
  return {
    motion: new Proxy({}, { get: (_t, tag: string) => el(tag) }),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children ?? null,
    LazyMotion: ({ children }: { children?: React.ReactNode }) => children ?? null,
    MotionConfig: ({ children }: { children?: React.ReactNode }) => children ?? null,
    useReducedMotion: () => false,
  }
})

const { createRoot } = await import('react-dom/client')
const { StoreProvider, useStore } = await import('../src/lib/store')
const { NavContext } = await import('../src/lib/nav')
const { Purchases } = await import('../src/pages/Purchases')
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
    page: 'dashboard',
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

function renderPurchases(): { container: HTMLElement; store: () => Store; unmount: () => void } {
  captured = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  React.act(() => {
    root.render(React.createElement(NavContext.Provider, { value: makeNav() }, React.createElement(StoreProvider, null, React.createElement(Capture), React.createElement(Purchases))))
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

function setSelect(select: HTMLSelectElement, value: string): void {
  React.act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  localStorage.clear()
  setNetwork('testnet')
  setLang('pt')
})
afterEach(() => {
  localStorage.clear()
})

describe('independência da aba Compras (FIN-02.0.1)', () => {
  test('formulário de compra fica disponível com catálogo vazio', () => {
    const { container, unmount } = renderPurchases()
    expect(container.textContent).not.toContain('Cadastre produtos primeiro')
    expect(container.textContent).toContain('Nova compra')
    expect(container.textContent).toContain('Registrar compra')
    expect(container.textContent).toContain('Cadastrar novo produto')
    unmount()
  })

  test('cadastro rápido abre o modal com os campos de produto', () => {
    const { container, unmount } = renderPurchases()

    // Abre o modal selecionando a opção de cadastro rápido.
    const productSelect = [...container.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === 'Produto')
    expect(productSelect).toBeTruthy()
    setSelect(productSelect as HTMLSelectElement, '__new__')
    expect(container.textContent).toContain('Custo de referência')
    expect(container.textContent).toContain('Preço de venda')
    unmount()
  })

  test('addProduct com estoque zero não gera movimentação financeira nem patrimonial', () => {
    const { store, unmount } = renderPurchases()
    let id = ''
    React.act(() => {
      id = store().addProduct({ sku: 'P', name: 'P', category: 'G', unit: 'un', cost: 5, price: 8, stock: 0, minStock: 0 })
    })
    expect(id).toBeTruthy()
    expect(store().data.products.find((p) => p.id === id)?.stock).toBe(0)
    expect(store().data.moves).toHaveLength(0)
    expect(store().data.entries).toHaveLength(0)
    expect(store().data.accounts).toHaveLength(0)
    unmount()
  })
})
