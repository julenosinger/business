/**
 * Projeção autoritativa das obrigações comerciais (FIN-04.1B.2.2B.3.2B).
 *
 * O cadastro financeiro é local-first (Store/AppData); esta projeção é a sincronização mínima
 * necessária ao checkout, persistida no SQLite do backend e versionada para impedir que um
 * cliente obsoleto sobrescreva liquidações já registradas.
 */
import type { LedgerDb } from './db'

export type GatewayEnvironment = 'mainnet' | 'testnet'

export interface CommercialObligation {
  organizationId: string
  environment: GatewayEnvironment
  obligationId: string
  sourceKind: string
  sourceId: string
  currency: string
  originalAmountMinor: string
  outstandingMinor: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface SyncObligationInput {
  obligationId: string
  sourceKind: string
  sourceId: string
  currency: string
  originalAmountMinor: string
  outstandingMinor: string
  version: number
}

export type ObligationSyncResult =
  | { ok: true; obligationId: string; version: number; duplicate: boolean }
  | { ok: false; reason: 'version_conflict' | 'invalid_obligation' }

const ENVIRONMENTS = new Set(['mainnet', 'testnet'])
const MINOR_RE = /^(0|[1-9]\d*)$/

export function syncObligation(db: LedgerDb, orgId: string, environment: GatewayEnvironment, input: SyncObligationInput): ObligationSyncResult {
  if (!ENVIRONMENTS.has(environment) || !input.obligationId || !input.sourceKind || !input.sourceId || !input.currency) return { ok: false, reason: 'invalid_obligation' }
  if (!MINOR_RE.test(input.originalAmountMinor) || !MINOR_RE.test(input.outstandingMinor)) return { ok: false, reason: 'invalid_obligation' }
  if (!Number.isInteger(input.version) || input.version < 0) return { ok: false, reason: 'invalid_obligation' }

  const now = new Date().toISOString()
  const existing = db.db
    .query('SELECT version FROM payment_obligations WHERE organization_id = ? AND environment = ? AND obligation_id = ?')
    .get(orgId, environment, input.obligationId) as { version: number } | undefined

  if (existing) {
    if (input.version < existing.version) return { ok: false, reason: 'version_conflict' }
    if (input.version === existing.version) return { ok: true, obligationId: input.obligationId, version: existing.version, duplicate: true }
    db.db
      .query(
        `UPDATE payment_obligations SET source_kind = ?, source_id = ?, currency = ?, original_amount_minor = ?, outstanding_minor = ?, version = ?, updated_at = ?
         WHERE organization_id = ? AND environment = ? AND obligation_id = ?`,
      )
      .run(input.sourceKind, input.sourceId, input.currency, input.originalAmountMinor, input.outstandingMinor, input.version, now, orgId, environment, input.obligationId)
    return { ok: true, obligationId: input.obligationId, version: input.version, duplicate: false }
  }

  db.db
    .query(
      `INSERT INTO payment_obligations (organization_id, environment, obligation_id, source_kind, source_id, currency, original_amount_minor, outstanding_minor, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(orgId, environment, input.obligationId, input.sourceKind, input.sourceId, input.currency, input.originalAmountMinor, input.outstandingMinor, input.version, now, now)
  return { ok: true, obligationId: input.obligationId, version: input.version, duplicate: false }
}

export function getObligation(db: LedgerDb, orgId: string, environment: GatewayEnvironment, obligationId: string): CommercialObligation | null {
  const r = db.db
    .query('SELECT * FROM payment_obligations WHERE organization_id = ? AND environment = ? AND obligation_id = ?')
    .get(orgId, environment, obligationId) as
    | { organization_id: string; environment: string; obligation_id: string; source_kind: string; source_id: string; currency: string; original_amount_minor: string; outstanding_minor: string; version: number; created_at: string; updated_at: string }
    | undefined
  if (!r) return null
  return {
    organizationId: r.organization_id,
    environment: r.environment as GatewayEnvironment,
    obligationId: r.obligation_id,
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    currency: r.currency,
    originalAmountMinor: r.original_amount_minor,
    outstandingMinor: r.outstanding_minor,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
