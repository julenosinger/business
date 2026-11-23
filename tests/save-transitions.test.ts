import { describe, expect, test } from 'bun:test'

// O store importa módulos que tocam o DOM/localStorage no carregamento; stubs vêm antes dos imports dinâmicos.
const g = globalThis as unknown as Record<string, unknown>
const storage: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => void (storage[k] = v), removeItem: (k: string) => void delete storage[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { emptyData } = await import('../src/lib/store')
const { addContactTransition, updateContactTransition, addEmployeeTransition, updateEmployeeTransition } = await import('../src/lib/save-transitions')
import type { AppData, Contact, Employee } from '../src/lib/types'

const contact = (over: Partial<Contact> = {}): Contact => ({
  id: 'c',
  kind: 'customer',
  name: 'Nome',
  doc: '',
  email: '',
  phone: '',
  wallet: '',
  environment: 'mainnet',
  ...over,
})

const employee = (over: Partial<Employee> = {}): Employee => ({
  id: 'e',
  name: 'Nome',
  role: 'r',
  salary: 1000,
  wallet: '',
  admission: '2026-01-01',
  active: true,
  environment: 'mainnet',
  ...over,
})

const base = (over: Partial<AppData> = {}): AppData => ({ ...emptyData(), ...over })

describe('transições puras de cadastro (contato)', () => {
  test('cadastro válido retorna sucesso e altera o estado', () => {
    const d = base()
    const t = addContactTransition(d, { kind: 'customer', name: 'Fulano', doc: '', email: '', phone: '', wallet: '' }, 'mainnet')
    expect(t.result.ok).toBe(true)
    if (t.result.ok) expect(t.nextState.contacts).toHaveLength(1)
    expect(t.nextState.contacts[0]!.environment).toBe('mainnet')
  })

  test('duplicidade exata (CPF) retorna erro e não altera o estado', () => {
    const d = base({ contacts: [contact({ id: 'a', doc: '111.444.777-35' })] })
    const t = addContactTransition(d, { kind: 'customer', name: 'Outro', doc: '11144477735', email: '', phone: '', wallet: '' }, 'mainnet')
    expect(t.result).toEqual({ ok: false, code: 'duplicate' })
    expect(t.nextState).toBe(d)
  })

  test('documento inválido retorna invalid_document', () => {
    const d = base()
    const t = addContactTransition(d, { kind: 'customer', name: 'Fulano', doc: '111.444.777-36', email: '', phone: '', wallet: '' }, 'mainnet')
    expect(t.result).toEqual({ ok: false, code: 'invalid_document' })
    expect(t.nextState).toBe(d)
  })

  test('edição de registro inexistente retorna not_found', () => {
    const d = base()
    expect(updateContactTransition(d, 'x', { name: 'A' }, 'mainnet').result).toEqual({ ok: false, code: 'not_found' })
  })

  test('edição em outro ambiente retorna wrong_environment', () => {
    const d = base({ contacts: [contact({ id: 'a', environment: 'testnet' })] })
    expect(updateContactTransition(d, 'a', { name: 'A' }, 'mainnet').result).toEqual({ ok: false, code: 'wrong_environment' })
  })

  test('edição válida preserva id e ambiente (mesmo se o payload tentar alterá-lo)', () => {
    const d = base({ contacts: [contact({ id: 'a', environment: 'mainnet', name: 'Antes' })] })
    const t = updateContactTransition(d, 'a', { name: 'Depois', environment: 'testnet' as Contact['environment'] }, 'mainnet')
    expect(t.result.ok).toBe(true)
    const updated = t.nextState.contacts.find((c) => c.id === 'a')!
    expect(updated.name).toBe('Depois')
    expect(updated.environment).toBe('mainnet') // ambiente original preservado
  })

  test('duas submissões seguidas não criam duplicata (transição reaplicada sobre o estado atualizado)', () => {
    const input = { kind: 'customer' as const, name: 'Fulano', doc: '111.444.777-35', email: '', phone: '', wallet: '' }
    const first = addContactTransition(base(), input, 'mainnet')
    expect(first.result.ok).toBe(true)
    // A segunda execução usa o nextState da primeira (simulando o updater reaplicado).
    const second = addContactTransition(first.nextState, input, 'mainnet')
    expect(second.result).toEqual({ ok: false, code: 'duplicate' })
    expect(second.nextState).toBe(first.nextState)
  })
})

describe('transições puras de cadastro (funcionário)', () => {
  test('cadastro válido e duplicidade por matrícula', () => {
    const ok = addEmployeeTransition(base(), { name: 'F', role: 'r', salary: 1, wallet: '', admission: '2026-01-01', active: true }, 'mainnet')
    expect(ok.result.ok).toBe(true)
    const dup = addEmployeeTransition(base({ employees: [employee({ id: 'a', registration: 'MAT-001' })] }), { name: 'G', role: 'r', salary: 1, wallet: '', admission: '2026-01-01', active: true, registration: 'mat-001' }, 'mainnet')
    expect(dup.result).toEqual({ ok: false, code: 'duplicate' })
  })

  test('edição válida preserva id e ambiente', () => {
    const d = base({ employees: [employee({ id: 'a', environment: 'testnet', name: 'Antes' })] })
    const t = updateEmployeeTransition(d, 'a', { name: 'Depois' }, 'testnet')
    expect(t.result.ok).toBe(true)
    expect(t.nextState.employees.find((e) => e.id === 'a')!.name).toBe('Depois')
    expect(t.nextState.employees.find((e) => e.id === 'a')!.environment).toBe('testnet')
  })

  test('edição em outro ambiente retorna wrong_environment', () => {
    const d = base({ employees: [employee({ id: 'a', environment: 'testnet' })] })
    expect(updateEmployeeTransition(d, 'a', { name: 'A' }, 'mainnet').result).toEqual({ ok: false, code: 'wrong_environment' })
  })
})
