import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Store } from '../src/lib/store'

try {
  GlobalRegistrator.register()
} catch {
  // Já registrado em outro arquivo de teste do mesmo processo.
}

const React = await import('react')

// framer-motion não é relevante para a lógica de negócio testada aqui; em happy-dom a animação
// nativa (Animation API) é cancelada no unmount e rejeita com AbortError. Substituímos por
// elementos simples — a estrutura do DOM e os fluxos testados permanecem reais.
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
const { Sales } = await import('../src/pages/Sales')
const { Finance } = await import('../src/pages/Finance')
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

// Nav com a intenção de perfil já definida (simula a navegação disparada pelo perfil).
function makeNav(profileIntent: Record<string, unknown> | null) {
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
    profileIntent,
    openProfileIntent: () => {},
    clearProfileIntent: () => {},
  }
}

function renderPage(component: React.ReactElement, profileIntent: Record<string, unknown> | null = null): { container: HTMLElement; store: () => Store; unmount: () => void } {
  captured = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  React.act(() => {
    root.render(React.createElement(NavContext.Provider, { value: makeNav(profileIntent) }, React.createElement(StoreProvider, null, React.createElement(Capture), component)))
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

function customerInput(): Parameters<Store['addContact']>[0] {
  return { kind: 'customer', name: 'Fulano Silva', doc: '111.444.777-35', email: 'f@x.com', phone: '', wallet: '' }
}

function clickLabel(container: HTMLElement, label: string): void {
  const btn = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label))
  if (!btn) throw new Error(`botão não encontrado: ${label}`)
  React.act(() => {
    btn.click()
  })
}

// Monta a página com controle da intenção, para testar intenções consecutivas sem remontar.
function renderPageWithIntent(component: React.ReactElement): { container: HTMLElement; store: () => Store; setIntent: (i: Record<string, unknown> | null) => void; unmount: () => void } {
  captured = null
  let current: Record<string, unknown> | null = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const apply = () => {
    React.act(() => {
      root.render(React.createElement(NavContext.Provider, { value: makeNav(current) }, React.createElement(StoreProvider, null, React.createElement(Capture), component)))
    })
  }
  apply()
  return {
    container,
    store: () => captured!,
    setIntent: (i) => {
      current = i
      apply()
    },
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

afterEach(() => {
  localStorage.clear()
})

describe('Navegação perfil → módulo (integração real)', () => {
  test('Vendas pré-seleciona o cliente transportado por ID', () => {
    let customerId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const r = store().addContact(customerInput())
        customerId = r.ok ? r.id : ''
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Sales), { kind: 'sale', customerId })
    const selects = [...container.querySelectorAll('select')]
    expect(selects.some((s) => s.value === customerId)).toBe(true)
    unmount()
  })

  test('Vendas filtra a lista pelo cliente (por ID, não por nome)', () => {
    let customerId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const r = store().addContact(customerInput())
        customerId = r.ok ? r.id : ''
        store().recordSale({ customerId, method: 'pix', items: [] })
        store().recordSale({ method: 'pix', items: [] }) // consumidor final
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Sales), { kind: 'sales', customerId, customerName: 'Fulano Silva' })
    expect(container.textContent).toContain('Limpar filtro')
    const tbody = container.querySelector('tbody')
    expect(tbody?.textContent).toContain('Fulano Silva')
    expect(tbody?.textContent).not.toContain('Consumidor final')
    unmount()
  })

  test('Compras pré-seleciona o fornecedor transportado por ID', () => {
    let supplierId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        store().addProduct({ sku: 'SKU1', name: 'Produto', category: 'Geral', unit: 'un', cost: 10, price: 20, stock: 5, minStock: 1 })
        const r = store().addContact({ kind: 'supplier', name: 'Fornecedor LTDA', doc: '', email: '', phone: '', wallet: '' })
        supplierId = r.ok ? r.id : ''
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Purchases), { kind: 'purchase', supplierId })
    const selects = [...container.querySelectorAll('select')]
    expect(selects.some((s) => s.value === supplierId)).toBe(true)
    unmount()
  })

  test('Financeiro abre nova conta a receber com cliente pré-selecionado', () => {
    let customerId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const r = store().addContact(customerInput())
        customerId = r.ok ? r.id : ''
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Finance), { kind: 'account', accountKind: 'receivable', contactId: customerId, contactName: 'Fulano Silva' })
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeDefined()
    expect(dialog!.textContent).toContain('Nova conta')
    const receivableBtn = [...dialog!.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('A receber'))
    expect(receivableBtn).toBeDefined()
    expect(receivableBtn!.getAttribute('aria-pressed')).toBe('true')
    const selects = [...dialog!.querySelectorAll('select')]
    expect(selects.some((s) => s.value === customerId)).toBe(true)
    unmount()
  })

  test('Financeiro filtra as contas pelo contato (por ID)', () => {
    let aId = ''
    let bId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const a = store().addContact(customerInput())
        const b = store().addContact({ kind: 'customer', name: 'Outro Cliente', doc: '', email: '', phone: '', wallet: '' })
        aId = a.ok ? a.id : ''
        bId = b.ok ? b.id : ''
        store().addAccount({ kind: 'receivable', description: 'Conta A', contactId: aId, contactName: 'Fulano Silva', amount: 100, dueDate: '2026-12-01', category: 'Vendas', currency: 'BRL' })
        store().addAccount({ kind: 'receivable', description: 'Conta B', contactId: bId, contactName: 'Outro Cliente', amount: 50, dueDate: '2026-12-01', category: 'Vendas', currency: 'BRL' })
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Finance), { kind: 'accounts', contactId: aId, label: 'Fulano Silva' })
    expect(container.textContent).toContain('Limpar filtro')
    const tbody = container.querySelector('tbody')
    expect(tbody?.textContent).toContain('Conta A')
    expect(tbody?.textContent).not.toContain('Conta B')
    unmount()
  })

  test('Financeiro filtra as obrigações pelo funcionário (por employeeId)', () => {
    let empId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const e = store().addEmployee({ name: 'Maria', role: 'Gerente', salary: 5000, wallet: '', admission: '2025-01-01', active: true })
        empId = e.ok ? e.id : ''
        store().runPayroll('2026-11', '2026-12-05')
        store().addAccount({ kind: 'payable', description: 'Conta Manual', contactName: 'Avulso', amount: 20, dueDate: '2026-12-01', category: 'Impostos', currency: 'BRL' })
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Finance), { kind: 'accounts', employeeId: empId, label: 'Maria' })
    expect(container.textContent).toContain('Limpar filtro')
    const tbody = container.querySelector('tbody')
    expect(tbody?.textContent).toContain('Salário Maria')
    expect(tbody?.textContent).not.toContain('Conta Manual')
    unmount()
  })

  test('Financeiro abre nova conta a pagar com fornecedor válido', () => {
    let supplierId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const r = store().addContact({ kind: 'supplier', name: 'Fornecedor LTDA', doc: '', email: '', phone: '', wallet: '' })
        supplierId = r.ok ? r.id : ''
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Finance), { kind: 'account', accountKind: 'payable', contactId: supplierId, contactName: 'Fornecedor LTDA' })
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeDefined()
    const payableBtn = [...dialog!.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('A pagar'))
    expect(payableBtn?.getAttribute('aria-pressed')).toBe('true')
    const selects = [...dialog!.querySelectorAll('select')]
    expect(selects.some((s) => s.value === supplierId)).toBe(true)
    unmount()
  })

  test('Financeiro rejeita tipo de contato incorreto (receber com fornecedor)', () => {
    let supplierId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const r = store().addContact({ kind: 'supplier', name: 'Fornecedor LTDA', doc: '', email: '', phone: '', wallet: '' })
        supplierId = r.ok ? r.id : ''
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Finance), { kind: 'account', accountKind: 'receivable', contactId: supplierId, contactName: 'Fornecedor LTDA' })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    unmount()
  })

  test('Financeiro rejeita tipo de contato incorreto (pagar com cliente)', () => {
    let customerId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const r = store().addContact(customerInput())
        customerId = r.ok ? r.id : ''
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Finance), { kind: 'account', accountKind: 'payable', contactId: customerId, contactName: 'Fulano Silva' })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    unmount()
  })

  test('Financeiro rejeita contato inexistente (não abre o formulário)', () => {
    const { container, unmount } = renderPage(React.createElement(Finance), { kind: 'account', accountKind: 'receivable', contactId: 'nao-existe', contactName: 'Fulano Silva' })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    unmount()
  })

  test('Financeiro rejeita contato de outro ambiente', () => {
    let testnetId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        setNetwork('testnet')
        const r = store().addContact(customerInput())
        testnetId = r.ok ? r.id : ''
        setNetwork('mainnet')
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Finance), { kind: 'account', accountKind: 'receivable', contactId: testnetId, contactName: 'Fulano Silva' })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    unmount()
  })

  test('abrir conta via perfil não grava automaticamente', () => {
    let customerId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const r = store().addContact(customerInput())
        customerId = r.ok ? r.id : ''
      })
      unmount()
    }
    const { container, store, unmount } = renderPage(React.createElement(Finance), { kind: 'account', accountKind: 'receivable', contactId: customerId, contactName: 'Fulano Silva' })
    expect(container.querySelector('[role="dialog"]')).toBeDefined()
    expect(store().data.accounts.length).toBe(0)
    unmount()
  })

  test('filtro permite alternar para contas liquidadas', () => {
    let contactId = ''
    let accId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const c = store().addContact(customerInput())
        contactId = c.ok ? c.id : ''
        accId = store().addAccount({ kind: 'receivable', description: 'Conta A', contactId, contactName: 'Fulano Silva', amount: 100, dueDate: '2026-12-01', category: 'Vendas', currency: 'BRL' })
      })
      React.act(() => {
        store().settleAccount(accId)
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Finance), { kind: 'accounts', contactId, label: 'Fulano Silva' })
    // Aba "Em aberto" (padrão): sem contas, mas sem dizer que não há histórico.
    expect(container.textContent).toContain('Nenhuma conta nesta situação')
    clickLabel(container, 'Liquidadas')
    expect(container.querySelector('tbody')?.textContent).toContain('Conta A')
    unmount()
  })

  test('limpeza de filtro restaura a lista completa', () => {
    let aId = ''
    let bId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const a = store().addContact(customerInput())
        const b = store().addContact({ kind: 'customer', name: 'Outro Cliente', doc: '', email: '', phone: '', wallet: '' })
        aId = a.ok ? a.id : ''
        bId = b.ok ? b.id : ''
        store().addAccount({ kind: 'receivable', description: 'Conta A', contactId: aId, contactName: 'Fulano Silva', amount: 100, dueDate: '2026-12-01', category: 'Vendas', currency: 'BRL' })
        store().addAccount({ kind: 'receivable', description: 'Conta B', contactId: bId, contactName: 'Outro Cliente', amount: 50, dueDate: '2026-12-01', category: 'Vendas', currency: 'BRL' })
      })
      unmount()
    }
    const { container, unmount } = renderPage(React.createElement(Finance), { kind: 'accounts', contactId: aId, label: 'Fulano Silva' })
    expect(container.querySelector('tbody')?.textContent).toContain('Conta A')
    expect(container.querySelector('tbody')?.textContent).not.toContain('Conta B')
    clickLabel(container, 'Limpar filtro')
    expect(container.querySelector('tbody')?.textContent).toContain('Conta A')
    expect(container.querySelector('tbody')?.textContent).toContain('Conta B')
    unmount()
  })

  test('duas intenções consecutivas não reutilizam o ID anterior', () => {
    let aId = ''
    let bId = ''
    {
      const { store, unmount } = renderPage(React.createElement('div'))
      React.act(() => {
        const a = store().addContact(customerInput())
        const b = store().addContact({ kind: 'customer', name: 'Cliente B', doc: '', email: '', phone: '', wallet: '' })
        aId = a.ok ? a.id : ''
        bId = b.ok ? b.id : ''
      })
      unmount()
    }
    const { container, setIntent, unmount } = renderPageWithIntent(React.createElement(Sales))
    setIntent({ kind: 'sale', customerId: aId })
    expect([...container.querySelectorAll('select')].some((s) => s.value === aId)).toBe(true)
    setIntent({ kind: 'sale', customerId: bId })
    expect([...container.querySelectorAll('select')].some((s) => s.value === bId)).toBe(true)
    expect([...container.querySelectorAll('select')].some((s) => s.value === aId)).toBe(false)
    unmount()
  })
})
