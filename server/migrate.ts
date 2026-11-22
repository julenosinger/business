/**
 * Migração segura do localStorage para o backend (fase 3.0 — P1.3).
 *
 * Sequência controlada: backup (feito pelo app), validação de schema (normalizeLedger), prévia de contagens,
 * importação idempotente (por organização) e verificação. Nunca apaga a origem; nunca adivinha moedas/redes.
 */
import { normalizeLedger } from '../src/lib/accounting/engine'
import type { LedgerState } from '../src/lib/accounting/types'
import type { LedgerDb } from './db'

export interface MigrationPreview {
  orgId: string
  events: number
  journal: number
  audit: number
  fees: number
  periods: number
  fxRates: number
}

export function previewLedger(ledger: LedgerState): MigrationPreview {
  const n = normalizeLedger(ledger, ledger.orgId)
  return {
    orgId: n.orgId,
    events: n.events.length,
    journal: n.journal.length,
    audit: n.audit.length,
    fees: n.fees.length,
    periods: n.periods.length,
    fxRates: n.fxRates.length,
  }
}

export type ImportLedgerResult = { ok: true; imported: boolean; preview: MigrationPreview } | { ok: false; reason: 'already_exists' }

/**
 * Importa o razão normalizado para o backend, de forma idempotente por organização.
 * Sem `force`, recusa sobrescrever um razão já existente (evita duplicidade de lançamentos).
 */
export function importLedger(db: LedgerDb, ledger: LedgerState, opts: { force?: boolean } = {}): ImportLedgerResult {
  const n = normalizeLedger(ledger, ledger.orgId)
  const existing = db.loadLedger(n.orgId)
  if (existing && !opts.force) return { ok: false, reason: 'already_exists' }
  db.saveLedger(n.orgId, n, new Date().toISOString())
  return { ok: true, imported: true, preview: previewLedger(n) }
}
