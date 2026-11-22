/**
 * Autorização e papéis (fase 2.2).
 *
 * Este módulo define o MODELO de autorização do razão. Os papéis e permissões são puros e testáveis.
 *
 * IMPORTANTE (segurança): a persistência atual é `localStorage`, sem servidor. Por isso, o "usuário" é o
 * proprietário cadastrado nas Configurações — isso NÃO é uma identidade autenticada. As checagens abaixo
 * são o CONTRATO que um backend deve impor; no app cliente elas são apenas informativas e NÃO são uma
 * fronteira de segurança (um usuário pode editar o armazenamento local).
 *
 * Em produção, o servidor mapeia o principal autenticado para um `Role` e recusa qualquer operação cuja
 * permissão o papel não tenha. O app roda como `owner` (todas as permissões) enquanto for de usuário único.
 */

export type Role = 'owner' | 'accountant' | 'financial_manager' | 'operator' | 'auditor'

export type Permission =
  | 'ledger.read'
  | 'entry.post'
  | 'entry.reverse'
  | 'posting.approve'
  | 'chart.manage'
  | 'rules.manage'
  | 'period.close'
  | 'period.reopen'
  | 'reconciliation.review'
  | 'fee.record'
  | 'fx.record'
  | 'purchase.reconcile'
  | 'account.settle'

export const ROLES: Role[] = ['owner', 'accountant', 'financial_manager', 'operator', 'auditor']

const ALL: Permission[] = [
  'ledger.read',
  'entry.post',
  'entry.reverse',
  'posting.approve',
  'chart.manage',
  'rules.manage',
  'period.close',
  'period.reopen',
  'reconciliation.review',
  'fee.record',
  'fx.record',
  'purchase.reconcile',
  'account.settle',
]

/** Permissões por papel. `owner` tem todas; `auditor` é somente leitura. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL,
  accountant: [
    'ledger.read',
    'entry.post',
    'entry.reverse',
    'posting.approve',
    'chart.manage',
    'period.close',
    'period.reopen',
    'reconciliation.review',
    'fee.record',
    'fx.record',
    'purchase.reconcile',
  ],
  financial_manager: [
    'ledger.read',
    'entry.post',
    'entry.reverse',
    'posting.approve',
    'period.close',
    'period.reopen',
    'reconciliation.review',
    'fee.record',
    'purchase.reconcile',
    'account.settle',
  ],
  operator: ['ledger.read', 'entry.post', 'account.settle'],
  auditor: ['ledger.read'],
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role]
}

export function can(role: Role | undefined, permission: Permission): boolean {
  // Sem papel explícito, o app de usuário único roda como owner (comportamento legado preservado).
  const r: Role = role ?? 'owner'
  return ROLE_PERMISSIONS[r].includes(permission)
}

export interface AuthorizeResult {
  ok: boolean
  /** Papel efetivo usado na decisão. */
  role: Role
  permission: Permission
}

/** Decisão de autorização explícita, para o servidor (ou para instrumentação no cliente). */
export function authorize(role: Role | undefined, permission: Permission): AuthorizeResult {
  return { ok: can(role, permission), role: role ?? 'owner', permission }
}

/** Descrição legível de cada papel (PT/EN), para exibição. */
export const ROLE_LABELS: Record<Role, { pt: string; en: string }> = {
  owner: { pt: 'Proprietário/Administrador', en: 'Owner / Admin' },
  accountant: { pt: 'Contador', en: 'Accountant' },
  financial_manager: { pt: 'Gerente financeiro', en: 'Financial manager' },
  operator: { pt: 'Operador', en: 'Operator' },
  auditor: { pt: 'Auditor (somente leitura)', en: 'Read-only auditor' },
}
