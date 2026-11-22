/**
 * Lógica do servidor (fase 2.9): autenticação de dono único, validação server-side e persistência atômica.
 *
 * Reusa o motor contábil (`postEvent`) como a ÚNICA fonte de validação/posta. O cliente NUNCA é confiado
 * para `actor`, `orgId`, valores ou status de confirmação: o servidor impõe o ator do dono e o orgId.
 *
 * Todas as mutações financeiras rodam em uma transação SQLite: uma falha deixa o estado anterior intacto.
 */
import { emptyLedger, postEvent, type PostResult } from '../src/lib/accounting/engine'
import type { EventDraft, LedgerState } from '../src/lib/accounting/types'
import type { LedgerDb } from './db'

export interface ApiConfig {
  token: string
  orgId: string
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
    this.name = 'UnauthorizedError'
  }
}

const OWNER_ACTOR = { id: 'owner', kind: 'user' as const, role: 'owner' as const }

export interface LedgerApi {
  getLedger(auth: string | undefined): LedgerState
  postEvent(auth: string | undefined, draft: EventDraft): PostResult
  recordSettlement(auth: string | undefined, input: { settlementId: string; opId: string; payload: string }): { ok: true } | { ok: false; conflict: true }
  cfg: ApiConfig
}

export function createApi(db: LedgerDb, cfg: ApiConfig): LedgerApi {
  const authorize = (auth: string | undefined): void => {
    if (!auth || auth !== `Bearer ${cfg.token}`) throw new UnauthorizedError()
  }

  return {
    cfg,
    getLedger(auth) {
      authorize(auth)
      return db.loadLedger(cfg.orgId) ?? emptyLedger(cfg.orgId)
    },
    postEvent(auth, draft) {
      authorize(auth)
      if (draft.orgId !== cfg.orgId) throw new Error('org_mismatch')
      const now = new Date().toISOString()
      // Transação: valida + posta + persiste tudo ou nada.
      const run = db.db.transaction((): PostResult => {
        const ledger = db.loadLedger(cfg.orgId) ?? emptyLedger(cfg.orgId)
        const result = postEvent(ledger, draft, { now, actor: OWNER_ACTOR })
        // Persiste o evento novo (idempotência durável pela constraint UNIQUE).
        if (result.ok && result.eventId && !result.duplicate) {
          const event = result.ledger.events.find((e) => e.id === result.eventId)
          if (event) {
            try {
              db.insertEvent(cfg.orgId, event)
            } catch {
              // Race/retry: mesma chave já persistida por outra requisição.
              const raced = db.getEvent(cfg.orgId, draft.idempotencyKey)
              if (raced) {
                return { ok: true, ledger, eventId: raced.id, entryId: raced.journalEntryId ?? null, status: raced.status, duplicate: true }
              }
              throw new Error('insert_event_failed')
            }
          }
        }
        const newAudit = result.ledger.audit.slice(ledger.audit.length)
        if (newAudit.length > 0) db.insertAudit(cfg.orgId, newAudit)
        db.saveLedger(cfg.orgId, result.ledger, now)
        return result
      })
      return run()
    },
    recordSettlement(auth, input) {
      authorize(auth)
      if (db.hasSettlement(cfg.orgId, input.settlementId)) return { ok: false, conflict: true }
      try {
        db.insertSettlement(cfg.orgId, input.settlementId, input.opId, input.payload, new Date().toISOString())
        return { ok: true }
      } catch {
        return { ok: false, conflict: true }
      }
    },
  }
}
