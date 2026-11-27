/**
 * Lógica do servidor (fases 2.9 → 3.0): autenticação de dono único, validação server-side e persistência atômica.
 *
 * Reusa o motor contábil (`postEvent`) como a ÚNICA fonte de validação/posta. O cliente NUNCA é confiado
 * para `actor`, `orgId`, valores ou status de confirmação: o servidor impõe o ator do dono e o `orgId`.
 *
 * Todas as mutações financeiras rodam em transações SQLite (atômico: tudo ou nada).
 */
import { emptyLedger, postEvent, type PostResult } from '../src/lib/accounting/engine'
import { verifyUsdcReceipt } from '../src/lib/accounting/verify'
import type { EventDraft, LedgerState } from '../src/lib/accounting/types'
import type { LedgerDb } from './db'
import { settleOperation, type SettleInput, type SettleResult } from './settle'
import { createGatewayCharge, listPaymentIntents, getPaymentIntent, sharePaymentIntent, type CreateCommercialChargeInput, type CreateGatewayChargeResult, type PaymentIntentSummary, type ShareResult } from './payments'
import { syncObligation, type SyncObligationInput, type ObligationSyncResult } from './obligations'

export interface ApiConfig {
  token: string
  orgId: string
  /** Conta institucional CREDITADA pelo Gateway por ambiente (config do servidor, nunca do cliente). */
  depositors?: Partial<Record<'mainnet' | 'testnet', string>>
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
  /** Liquidação atômica + idempotente por operação, com verificação on-chain server-side. */
  settle(auth: string | undefined, input: SettleInput): Promise<SettleResult>
  /** Cria cobrança Gateway compartilhável (autenticada pela organização; autoridade do servidor). */
  createPaymentIntent(auth: string | undefined, environment: 'mainnet' | 'testnet', input: CreateCommercialChargeInput): CreateGatewayChargeResult
  listPaymentIntents(auth: string | undefined, environment: 'mainnet' | 'testnet'): PaymentIntentSummary[]
  getPaymentIntent(auth: string | undefined, intentId: string): PaymentIntentSummary | null
  sharePaymentIntent(auth: string | undefined, intentId: string): ShareResult
  /** Variantes sem `authorize` (orgId resolvido pelo handler, via sessão comercial). */
  createPaymentIntentForOrg(orgId: string, environment: 'mainnet' | 'testnet', input: CreateCommercialChargeInput): CreateGatewayChargeResult
  listPaymentIntentsForOrg(orgId: string, environment: 'mainnet' | 'testnet'): PaymentIntentSummary[]
  sharePaymentIntentForOrg(orgId: string, intentId: string): ShareResult
  /** Sincronização autoritativa da obrigação comercial (projeção do checkout). */
  syncObligationForOrg(orgId: string, environment: 'mainnet' | 'testnet', input: SyncObligationInput): ObligationSyncResult
  cfg: ApiConfig
}

export function createApi(db: LedgerDb, cfg: ApiConfig, verify: typeof verifyUsdcReceipt = verifyUsdcReceipt): LedgerApi {
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
        if (result.ok && result.eventId && !result.duplicate) {
          const event = result.ledger.events.find((e) => e.id === result.eventId)
          if (event) db.insertEvent(cfg.orgId, event)
        }
        const newAudit = result.ledger.audit.slice(ledger.audit.length)
        if (newAudit.length > 0) db.insertAudit(cfg.orgId, newAudit)
        db.saveLedger(cfg.orgId, result.ledger, now)
        return result
      })
      return run()
    },
    settle(auth, input) {
      authorize(auth)
      return settleOperation(db, cfg.orgId, input, verify)
    },
    createPaymentIntent(auth, environment, input) {
      authorize(auth)
      const depositor = cfg.depositors?.[environment]?.trim() || null
      return createGatewayCharge(db, cfg.orgId, environment, input, depositor)
    },
    listPaymentIntents(auth, environment) {
      authorize(auth)
      return listPaymentIntents(db, cfg.orgId, environment)
    },
    getPaymentIntent(auth, intentId) {
      authorize(auth)
      return getPaymentIntent(db, cfg.orgId, intentId)
    },
    sharePaymentIntent(auth, intentId) {
      authorize(auth)
      return sharePaymentIntent(db, cfg.orgId, intentId)
    },
    createPaymentIntentForOrg(orgId, environment, input) {
      const depositor = cfg.depositors?.[environment]?.trim() || null
      return createGatewayCharge(db, orgId, environment, input, depositor)
    },
    listPaymentIntentsForOrg(orgId, environment) {
      return listPaymentIntents(db, orgId, environment)
    },
    sharePaymentIntentForOrg(orgId, intentId) {
      return sharePaymentIntent(db, orgId, intentId)
    },
    syncObligationForOrg(orgId, environment, input) {
      return syncObligation(db, orgId, environment, input)
    },
  }
}
