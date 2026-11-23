/**
 * Transições PURAS de gravação de cadastros (fase UI 2.1.2).
 *
 * Recebem o estado autoritativo (`AppData`) + comando e retornam `{ nextState, result }`,
 * garantindo que `result.ok === true` somente quando a operação foi aceita sobre o MESMO snapshot
 * usado para a mutação. Sem efeitos colaterais, sem dependência de updaters React e sem mensagens
 * localizadas (o código de erro é mapeado para texto no store). Testável e determinístico.
 */
import type { AppData, Contact, Employee } from './types'
import type { NetworkId } from './network'
import { docValidForSubmit } from './documents'
import { findContactDuplicates, findEmployeeDuplicates } from './duplicates'

export type SaveCode = 'invalid_document' | 'duplicate' | 'not_found' | 'wrong_environment'

export type TransitionResult = { ok: true; id: string } | { ok: false; code: SaveCode }

export interface Transition {
  nextState: AppData
  result: TransitionResult
}

/**
 * O ID é gerado UMA vez por tentativa (no store) e passado como parte do comando. Isso torna as
 * transições determinísticas: a mesma entrada produz a mesma saída, sem gerar IDs divergentes em
 * reexecuções.
 */
export function addContactTransition(d: AppData, c: Omit<Contact, 'id'>, env: NetworkId, id: string): Transition {
  if (!docValidForSubmit(c.doc, c.personType ?? 'fisica')) {
    return { nextState: d, result: { ok: false, code: 'invalid_document' } }
  }
  const dupInput = { doc: c.doc, internalCode: c.internalCode ?? '', name: c.name, email: c.email, kind: c.kind }
  if (findContactDuplicates(d.contacts.filter((x) => x.kind === c.kind && x.environment === env), dupInput).exact.length > 0) {
    return { nextState: d, result: { ok: false, code: 'duplicate' } }
  }
  return { nextState: { ...d, contacts: [{ ...c, id, environment: env }, ...d.contacts] }, result: { ok: true, id } }
}

export function updateContactTransition(d: AppData, id: string, patch: Partial<Contact>, env: NetworkId): Transition {
  const cur = d.contacts.find((x) => x.id === id)
  if (!cur) return { nextState: d, result: { ok: false, code: 'not_found' } }
  if (cur.environment !== env) return { nextState: d, result: { ok: false, code: 'wrong_environment' } }
  // O ambiente original é preservado: o payload não pode alterá-lo.
  const next = { ...cur, ...patch, environment: cur.environment }
  if (!docValidForSubmit(next.doc, next.personType ?? 'fisica')) return { nextState: d, result: { ok: false, code: 'invalid_document' } }
  const dupInput = { doc: next.doc, internalCode: next.internalCode ?? '', name: next.name, email: next.email, kind: next.kind }
  if (findContactDuplicates(d.contacts.filter((x) => x.kind === next.kind && x.environment === env), dupInput, id).exact.length > 0) {
    return { nextState: d, result: { ok: false, code: 'duplicate' } }
  }
  return { nextState: { ...d, contacts: d.contacts.map((x) => (x.id === id ? next : x)) }, result: { ok: true, id } }
}

export function addEmployeeTransition(d: AppData, e: Omit<Employee, 'id'>, env: NetworkId, id: string): Transition {
  const dupInput = { registration: e.registration ?? '', email: e.email ?? '', name: e.name }
  if (findEmployeeDuplicates(d.employees.filter((x) => x.environment === env), dupInput).exact.length > 0) {
    return { nextState: d, result: { ok: false, code: 'duplicate' } }
  }
  return { nextState: { ...d, employees: [{ ...e, id, environment: env }, ...d.employees] }, result: { ok: true, id } }
}

export function updateEmployeeTransition(d: AppData, id: string, patch: Partial<Employee>, env: NetworkId): Transition {
  const cur = d.employees.find((x) => x.id === id)
  if (!cur) return { nextState: d, result: { ok: false, code: 'not_found' } }
  if (cur.environment !== env) return { nextState: d, result: { ok: false, code: 'wrong_environment' } }
  const next = { ...cur, ...patch, environment: cur.environment }
  const dupInput = { registration: next.registration ?? '', email: next.email ?? '', name: next.name }
  if (findEmployeeDuplicates(d.employees.filter((x) => x.environment === env), dupInput, id).exact.length > 0) {
    return { nextState: d, result: { ok: false, code: 'duplicate' } }
  }
  return { nextState: { ...d, employees: d.employees.map((x) => (x.id === id ? next : x)) }, result: { ok: true, id } }
}
