/**
 * Interfaces tipadas para futuros agentes de IA (nenhum agente existe nesta fase).
 *
 * Princípios:
 * - Leitura: saldos, razão e auditoria, sempre como CÓPIAS profundas (um agente não consegue mutar o estado).
 * - Escrita: um agente só pode PREPARAR um lançamento e PEDIR APROVAÇÃO. Quem aprova é sempre um usuário.
 * - O motor recusa postagem direta de atores `agent` (`agent_cannot_post`).
 */
import { accountBalance, decideApproval, prepareEntry, requestApproval, trialBalance, type OpResult, type PreparedEntry, type TrialBalance } from './engine'
import type { CurrencyCode } from '../types'
import type { Actor, AuditRecord, EventDraft, EventStatus, FinancialEvent, JournalEntry, LedgerState } from './types'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export interface JournalFilter {
  from?: string
  to?: string
  accountCode?: string
  limit?: number
}

export interface AccountingReadApi {
  trialBalance(opts?: { currency?: CurrencyCode; upToDate?: string }): TrialBalance[]
  accountBalance(code: string, currency: CurrencyCode, upToDate?: string): bigint
  listJournal(filter?: JournalFilter): JournalEntry[]
  listEvents(filter?: { status?: EventStatus; limit?: number }): FinancialEvent[]
  auditTrail(filter?: { limit?: number }): AuditRecord[]
}

/** Visão somente leitura do razão. Retorna cópias; não expõe o estado interno. */
export function createReadApi(ledger: LedgerState): AccountingReadApi {
  const snapshot = clone(ledger)
  return {
    trialBalance: (opts) => trialBalance(snapshot, opts),
    accountBalance: (code, currency, upToDate) => accountBalance(snapshot, code, currency, upToDate),
    listJournal: (filter = {}) =>
      clone(
        snapshot.journal
          .filter((j) => (!filter.from || j.accountingDate >= filter.from) && (!filter.to || j.accountingDate <= filter.to) && (!filter.accountCode || j.lines.some((l) => l.accountCode === filter.accountCode)))
          .slice(-(filter.limit ?? 200)),
      ),
    listEvents: (filter = {}) => clone(snapshot.events.filter((e) => !filter.status || e.status === filter.status).slice(-(filter.limit ?? 200))),
    auditTrail: (filter = {}) => clone(snapshot.audit.slice(-(filter.limit ?? 200))),
  }
}

export interface AccountingProposalApi {
  /** Valida e mostra as linhas que seriam lançadas, sem gravar nada. */
  prepare(ledger: LedgerState, draft: EventDraft): PreparedEntry
  /** Agente pede aprovação: o ator é SEMPRE `agent`, qualquer que seja o que o chamador informe. */
  propose(ledger: LedgerState, draft: EventDraft, agentId: string, note: string, now: string): OpResult<{ approvalId: string }>
  /** Somente um usuário humano aprova; o lançamento nasce com a identidade dele. */
  approve(ledger: LedgerState, approvalId: string, userId: string, now: string, note?: string): OpResult<{ entryId: string | null }>
  reject(ledger: LedgerState, approvalId: string, userId: string, now: string, note?: string): OpResult<{ entryId: string | null }>
}

export const proposalApi: AccountingProposalApi = {
  prepare: (ledger, draft) => prepareEntry(ledger, draft),
  propose: (ledger, draft, agentId, note, now) => requestApproval(ledger, draft, { id: agentId, kind: 'agent' } satisfies Actor, note, now),
  approve: (ledger, approvalId, userId, now, note) => decideApproval(ledger, approvalId, { id: userId, kind: 'user' }, 'approve', now, note),
  reject: (ledger, approvalId, userId, now, note) => decideApproval(ledger, approvalId, { id: userId, kind: 'user' }, 'reject', now, note),
}
