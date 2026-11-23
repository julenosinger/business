import { normalizeDoc, normalizeEmail } from './documents'
import type { Contact, Employee } from './types'

export interface DupResult<T> {
  /** Duplicidade exata (documento/código/matrícula idênticos). */
  exact: T[]
  /** Possível duplicidade (nome/email coincidentes). Não é definitiva. */
  possible: T[]
}

export interface ContactDupInput {
  doc: string
  internalCode: string
  name: string
  email: string
  kind: 'customer' | 'supplier'
}

/**
 * Duplicidades de Cliente/Fornecedor (nunca mistura clientes com fornecedores).
 * - Exata: CPF/CNPJ normalizado ou código interno idênticos.
 * - Possível: nome ou email coincidentes.
 */
export function findContactDuplicates(contacts: Contact[], input: ContactDupInput, excludeId?: string): DupResult<Contact> {
  const exact: Contact[] = []
  const possible: Contact[] = []
  const doc = normalizeDoc(input.doc)
  const code = input.internalCode.trim().toLowerCase()
  const email = normalizeEmail(input.email)
  const name = input.name.trim().toLowerCase()
  for (const c of contacts) {
    if (c.id === excludeId) continue
    if (c.kind !== input.kind) continue
    if (doc && normalizeDoc(c.doc) === doc) {
      exact.push(c)
      continue
    }
    if (code && (c.internalCode ?? '').trim().toLowerCase() === code) {
      exact.push(c)
      continue
    }
    if (email && normalizeEmail(c.email) === email) {
      possible.push(c)
      continue
    }
    if (name && c.name.trim().toLowerCase() === name) {
      possible.push(c)
    }
  }
  return { exact, possible }
}

export interface EmployeeDupInput {
  registration: string
  email: string
  name: string
}

/**
 * Duplicidades de Funcionário.
 * - Exata: matrícula interna idêntica.
 * - Possível: email ou nome coincidentes (nome isolado não é definitivo).
 */
export function findEmployeeDuplicates(employees: Employee[], input: EmployeeDupInput, excludeId?: string): DupResult<Employee> {
  const exact: Employee[] = []
  const possible: Employee[] = []
  const reg = input.registration.trim().toLowerCase()
  const email = normalizeEmail(input.email)
  const name = input.name.trim().toLowerCase()
  for (const e of employees) {
    if (e.id === excludeId) continue
    if (reg && (e.registration ?? '').trim().toLowerCase() === reg) {
      exact.push(e)
      continue
    }
    if (email && normalizeEmail(e.email ?? '') === email) {
      possible.push(e)
      continue
    }
    if (name && e.name.trim().toLowerCase() === name) {
      possible.push(e)
    }
  }
  return { exact, possible }
}
