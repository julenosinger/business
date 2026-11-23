import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Store } from '../src/lib/store'

try {
  GlobalRegistrator.register()
} catch {
  // Já registrado em outro arquivo de teste do mesmo processo.
}

// Mock do sonner: captura a ação "Desfazer" e as mensagens info para testar o bloqueio do Undo.
const capturedActions: { label: string; onClick: () => void }[] = []
const infoMessages: string[] = []
const toastFn = ((message: string, opts?: { action?: { label: string; onClick: () => void } }) => {
  if (opts?.action) capturedActions.push(opts.action)
  return 'id'
}) as unknown as {
  (message: string, opts?: unknown): string
  info: (m: string) => void
  error: (m: string) => void
  success: (m: string) => void
}
toastFn.info = (m: string) => void infoMessages.push(m)
toastFn.error = () => {}
toastFn.success = () => {}

mock.module('sonner', () => ({ toast: toastFn }))

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

const contactInput = (name: string): Parameters<Store['addContact']>[0] => ({ kind: 'customer', name, doc: '', email: '', phone: '', wallet: '' })

beforeEach(() => {
  localStorage.clear()
  capturedActions.length = 0
  infoMessages.length = 0
  setNetwork('mainnet')
})

afterEach(() => {
  localStorage.clear()
})

describe('Undo sem perda de alterações posteriores', () => {
  test('desfazer funciona quando não houve alteração posterior', () => {
    const { store, unmount } = renderStore()
    let add: ReturnType<Store['addContact']>
    React.act(() => {
      add = store().addContact(contactInput('X'))
      store().removeContact(add!.ok ? add!.id : '')
    })
    expect(store().data.contacts).toHaveLength(0)
    expect(capturedActions).toHaveLength(1)
    // Sem alterações posteriores: o undo restaura o contato.
    React.act(() => {
      capturedActions[0]!.onClick()
    })
    expect(infoMessages).toHaveLength(0)
    expect(store().data.contacts.map((c) => c.name)).toEqual(['X'])
    unmount()
  })

  test('desfazer é bloqueado após alteração posterior (sem perda de dados)', () => {
    const { store, unmount } = renderStore()
    let add: ReturnType<Store['addContact']>
    React.act(() => {
      add = store().addContact(contactInput('X'))
      store().removeContact(add!.ok ? add!.id : '')
    })
    expect(store().data.contacts).toHaveLength(0)
    expect(capturedActions).toHaveLength(1)
    // Alteração posterior independente: novo contato.
    React.act(() => {
      store().addContact(contactInput('Y'))
    })
    // Tenta desfazer: deve ser bloqueado e preservar o contato Y (sem restaurar X indevidamente).
    React.act(() => {
      capturedActions[0]!.onClick()
    })
    expect(infoMessages.length).toBeGreaterThan(0)
    expect(store().data.contacts.map((c) => c.name)).toEqual(['Y'])
    unmount()
  })
})
