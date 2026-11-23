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
const { ContactProfile } = await import('../src/components/profiles/ContactProfile')
const { EmployeeProfile } = await import('../src/components/profiles/EmployeeProfile')
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

function render(component: React.ReactElement): { container: HTMLElement; store: () => Store; unmount: () => void } {
  captured = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  React.act(() => {
    root.render(React.createElement(StoreProvider, null, React.createElement(Capture), component))
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

function clickTab(container: HTMLElement, label: string): void {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
  if (!btn) throw new Error(`aba não encontrada: ${label}`)
  React.act(() => {
    btn.click()
  })
}

const customerInput = (over: Partial<Parameters<Store['addContact']>[0]> = {}): Parameters<Store['addContact']>[0] => ({
  kind: 'customer',
  name: 'Fulano Silva',
  doc: '111.444.777-35',
  email: 'f@x.com',
  phone: '',
  wallet: '',
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
  setLang('pt')
})

afterEach(() => {
  localStorage.clear()
})

describe('Perfis empresariais (render real no StoreProvider)', () => {
  test('perfil de cliente exibe dados por ID (nome, documento, email)', () => {
    let id = ''
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        const res = store().addContact(customerInput())
        id = res.ok ? res.id : ''
      })
      unmount()
    }
    expect(id).not.toBe('')
    const { container, unmount } = render(React.createElement(ContactProfile, { contactId: id, kind: 'customer', onBack: () => {}, onEdit: () => {} }))
    expect(container.textContent).toContain('Fulano Silva')
    expect(container.textContent).toContain('111.444.777-35')
    expect(container.textContent).toContain('f@x.com')
    unmount()
  })

  test('perfil de fornecedor exibe razão social', () => {
    let id = ''
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        const res = store().addContact({ kind: 'supplier', name: 'Fornecedor LTDA', doc: '', email: '', phone: '', wallet: '', legalName: 'Fornecedor S/A' })
        id = res.ok ? res.id : ''
      })
      unmount()
    }
    const { container, unmount } = render(React.createElement(ContactProfile, { contactId: id, kind: 'supplier', onBack: () => {}, onEdit: () => {} }))
    expect(container.textContent).toContain('Fornecedor S/A')
    unmount()
  })

  test('perfil de funcionário exibe cargo e matrícula', () => {
    let id = ''
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        const res = store().addEmployee({ name: 'Maria', role: 'Gerente', salary: 5000, wallet: '', admission: '2025-01-01', active: true, registration: 'MAT-001', department: 'Comercial' })
        id = res.ok ? res.id : ''
      })
      unmount()
    }
    const { container, unmount } = render(React.createElement(EmployeeProfile, { employeeId: id, onBack: () => {}, onEdit: () => {} }))
    expect(container.textContent).toContain('Maria')
    expect(container.textContent).toContain('Gerente')
    expect(container.textContent).toContain('MAT-001')
    unmount()
  })

  test('registro inexistente exibe estado vazio (não encontrado)', () => {
    const { container, unmount } = render(React.createElement(ContactProfile, { contactId: 'nao-existe', kind: 'customer', onBack: () => {}, onEdit: () => {} }))
    expect(container.textContent).toContain('Cadastro não encontrado')
    unmount()
  })

  test('isolamento Mainnet/Testnet: perfil não encontra cadastro de outro ambiente', () => {
    let id = ''
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        const res = store().addContact(customerInput())
        id = res.ok ? res.id : ''
      })
      unmount()
    }
    setNetwork('testnet')
    const { container, unmount } = render(React.createElement(ContactProfile, { contactId: id, kind: 'customer', onBack: () => {}, onEdit: () => {} }))
    expect(container.textContent).toContain('Cadastro não encontrado')
    unmount()
  })
})

describe('Integridade financeira dos perfis (moeda e valor)', () => {
  test('conta BRL é apresentada como BRL (não a moeda do app)', () => {
    let contactId = ''
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        const c = store().addContact(customerInput())
        contactId = c.ok ? c.id : ''
        store().addAccount({ kind: 'receivable', description: 'Recebível', contactId, contactName: 'Fulano Silva', amount: 100, dueDate: '2026-12-01', category: 'Vendas', currency: 'BRL' })
      })
      unmount()
    }
    const { container, unmount } = render(React.createElement(ContactProfile, { contactId, kind: 'customer', onBack: () => {}, onEdit: () => {} }))
    clickTab(container, 'Financeiro')
    expect(container.textContent).toContain('R$')
    expect(container.textContent).not.toContain('USDC')
    unmount()
  })

  test('conta USDC é apresentada como USDC', () => {
    let contactId = ''
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        const c = store().addContact(customerInput())
        contactId = c.ok ? c.id : ''
        store().addAccount({ kind: 'receivable', description: 'Recebível', contactId, contactName: 'Fulano Silva', amount: 100, dueDate: '2026-12-01', category: 'Vendas', currency: 'USDC' })
      })
      unmount()
    }
    const { container, unmount } = render(React.createElement(ContactProfile, { contactId, kind: 'customer', onBack: () => {}, onEdit: () => {} }))
    clickTab(container, 'Financeiro')
    expect(container.textContent).toContain('USDC')
    expect(container.textContent).not.toContain('R$')
    unmount()
  })

  test('moedas diferentes aparecem separadas (não somadas em uma única moeda)', () => {
    let contactId = ''
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        const c = store().addContact(customerInput())
        contactId = c.ok ? c.id : ''
        store().addAccount({ kind: 'receivable', description: 'A', contactId, contactName: 'Fulano Silva', amount: 100, dueDate: '2026-12-01', category: 'Vendas', currency: 'BRL' })
        store().addAccount({ kind: 'receivable', description: 'B', contactId, contactName: 'Fulano Silva', amount: 50, dueDate: '2026-12-01', category: 'Vendas', currency: 'USDC' })
      })
      unmount()
    }
    const { container, unmount } = render(React.createElement(ContactProfile, { contactId, kind: 'customer', onBack: () => {}, onEdit: () => {} }))
    clickTab(container, 'Financeiro')
    expect(container.textContent).toContain('R$')
    expect(container.textContent).toContain('USDC')
    expect(container.textContent).toContain('100')
    expect(container.textContent).toContain('50')
    unmount()
  })

  test('conta sem moeda não recebe símbolo arbitrário', () => {
    let contactId = ''
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        const c = store().addContact(customerInput())
        contactId = c.ok ? c.id : ''
        const accId = store().addAccount({ kind: 'receivable', description: 'Sem moeda', contactId, contactName: 'Fulano Silva', amount: 100, dueDate: '2026-12-01', category: 'Vendas', currency: 'BRL' })
        store().updateAccount(accId, { currency: undefined })
      })
      unmount()
    }
    const { container, unmount } = render(React.createElement(ContactProfile, { contactId, kind: 'customer', onBack: () => {}, onEdit: () => {} }))
    clickTab(container, 'Financeiro')
    // A conta sem moeda não deve exibir nenhum símbolo de moeda (moeda não especificada).
    expect(container.textContent).not.toContain('R$')
    expect(container.textContent).not.toContain('USDC')
    expect(container.textContent).not.toContain('USD')
    expect(container.textContent).toContain('100')
    unmount()
  })

  test('folha paga na atividade recente exibe o valor original (não zero)', () => {
    let empId = ''
    let payrollId = ''
    {
      const { store, unmount } = render(React.createElement('div'))
      React.act(() => {
        const e = store().addEmployee({ name: 'Maria', role: 'Gerente', salary: 1234.56, wallet: '', admission: '2025-01-01', active: true })
        empId = e.ok ? e.id : ''
        store().runPayroll('2026-11', '2026-12-05')
      })
      React.act(() => {
        payrollId = store().data.accounts.find((a) => a.employeeId === empId && a.source === 'payroll')?.id ?? ''
        if (payrollId) store().settleAccount(payrollId)
      })
      unmount()
    }
    const { container, unmount } = render(React.createElement(EmployeeProfile, { employeeId: empId, onBack: () => {}, onEdit: () => {} }))
    const li = [...container.querySelectorAll('li')].find((el) => el.textContent?.includes('Salário Maria'))
    expect(li).toBeDefined()
    expect(li!.textContent).toContain('1.234,56')
    expect(li!.textContent).not.toContain('0,00 USDC')
    unmount()
  })
})
