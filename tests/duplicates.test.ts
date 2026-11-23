import { describe, expect, test } from 'bun:test'
import { findContactDuplicates, findEmployeeDuplicates } from '../src/lib/duplicates'
import type { Contact, Employee } from '../src/lib/types'

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

describe('duplicidade de contatos', () => {
  test('exata por CPF/CNPJ normalizado', () => {
    const list = [contact({ id: 'a', doc: '111.444.777-35' })]
    const r = findContactDuplicates(list, { doc: '11144477735', internalCode: '', name: '', email: '', kind: 'customer' })
    expect(r.exact.map((c) => c.id)).toEqual(['a'])
    expect(r.possible).toHaveLength(0)
  })

  test('exata por código interno', () => {
    const list = [contact({ id: 'a', internalCode: 'C-001' })]
    const r = findContactDuplicates(list, { doc: '', internalCode: 'c-001', name: '', email: '', kind: 'customer' })
    expect(r.exact.map((c) => c.id)).toEqual(['a'])
  })

  test('possível por nome ou email (não exata)', () => {
    const list = [contact({ id: 'a', name: 'Fulano', email: 'f@x.com' })]
    const r = findContactDuplicates(list, { doc: '', internalCode: '', name: 'fulano', email: '', kind: 'customer' })
    expect(r.possible.map((c) => c.id)).toEqual(['a'])
    expect(r.exact).toHaveLength(0)
  })

  test('não mistura cliente com fornecedor', () => {
    const list = [contact({ id: 'a', kind: 'supplier', doc: '111.444.777-35' })]
    const r = findContactDuplicates(list, { doc: '11144477735', internalCode: '', name: '', email: '', kind: 'customer' })
    expect(r.exact).toHaveLength(0)
    expect(r.possible).toHaveLength(0)
  })

  test('exclui o próprio registro durante edição', () => {
    const list = [contact({ id: 'self', doc: '111.444.777-35' })]
    const r = findContactDuplicates(list, { doc: '11144477735', internalCode: '', name: '', email: '', kind: 'customer' }, 'self')
    expect(r.exact).toHaveLength(0)
  })
})

describe('duplicidade de funcionários', () => {
  test('exata por matrícula', () => {
    const list = [employee({ id: 'a', registration: 'MAT-001' })]
    const r = findEmployeeDuplicates(list, { registration: 'mat-001', email: '', name: '' })
    expect(r.exact.map((e) => e.id)).toEqual(['a'])
  })

  test('possível por email ou nome', () => {
    const list = [employee({ id: 'a', email: 'x@x.com' })]
    const r = findEmployeeDuplicates(list, { registration: '', email: 'X@X.COM', name: '' })
    expect(r.possible.map((e) => e.id)).toEqual(['a'])
    expect(r.exact).toHaveLength(0)
  })

  test('exclui o próprio registro durante edição', () => {
    const list = [employee({ id: 'self', registration: 'MAT-001' })]
    const r = findEmployeeDuplicates(list, { registration: 'MAT-001', email: '', name: '' }, 'self')
    expect(r.exact).toHaveLength(0)
  })
})
