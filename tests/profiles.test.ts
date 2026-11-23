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
