/**
 * Núcleo de automação financeira (FIN-04.1B.2.2B.3.2A.1).
 *
 * Jobs duráveis, idempotentes e protegidos por FENCING de lease (workerId + leaseVersion
 * monotônica + leaseUntil), para coordenar efeitos subsequentes a uma liquidação verificada
 * (estoque, contabilização, conciliação) SEM ser uma segunda autoridade de liquidação.
 */
import { randomUUID } from 'node:crypto'
import type { LedgerDb } from './db'

export type FinancialScope = { organizationId: string; environment: 'mainnet' | 'testnet' }
export type AutomationJobStatus = 'pending' | 'processing' | 'completed' | 'retryable' | 'requires_review'

export interface JobLease {
  jobId: string
  workerId: string
  leaseVersion: number
}

export interface AutomationJob {
  jobId: string
  organizationId: string
  environment: 'mainnet' | 'testnet'
  sourceKind: string
  sourceId: string
  operation: string
  idempotencyKey: string
  status: AutomationJobStatus
  attempts: number
  nextRetryAt: string | null
  leaseUntil: string | null
  workerId: string | null
  leaseVersion: number
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
}

export function automationKey(scope: FinancialScope, sourceKind: string, sourceId: string, operation: string): string {
  return JSON.stringify([scope.organizationId, scope.environment, sourceKind, sourceId, operation])
}

/** Identidade persistente de um EFEITO financeiro (estoque/contábil/liquidação) — executado uma única vez. */
export function financialEffectKey(scope: FinancialScope, sourceKind: string, sourceId: string, effectKind: string): string {
  return JSON.stringify([scope.organizationId, scope.environment, sourceKind, sourceId, effectKind])
}

const ENVIRONMENTS = new Set(['mainnet', 'testnet'])

export interface EnqueueInput {
  scope: FinancialScope
  sourceKind: string
  sourceId: string
  operation: string
}

export type EnqueueResult = { ok: true; jobId: string; duplicate: boolean } | { ok: false; reason: 'invalid_scope' }

interface Row {
  job_id: string
  organization_id: string
  environment: string
  source_kind: string
  source_id: string
  operation: string
  idempotency_key: string
  status: string
  attempts: number
  next_retry_at: string | null
  lease_until: string | null
  worker_id: string | null
  lease_version: number
  last_error_code: string | null
  created_at: string
  updated_at: string
}

function mapRow(r: Row | undefined): AutomationJob | null {
  if (!r) return null
  return {
    jobId: r.job_id,
    organizationId: r.organization_id,
    environment: r.environment as 'mainnet' | 'testnet',
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    operation: r.operation,
    idempotencyKey: r.idempotency_key,
    status: r.status as AutomationJobStatus,
    attempts: r.attempts,
    nextRetryAt: r.next_retry_at,
    leaseUntil: r.lease_until,
    workerId: r.worker_id,
    leaseVersion: r.lease_version,
    lastErrorCode: r.last_error_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export type AutomationFailure = { kind: 'retryable'; code: string } | { kind: 'requires_review'; code: string }

const RETRYABLE_CODES = new Set(['temporary_unavailable', 'read_timeout', 'db_busy', 'dependency_unavailable', 'persistence_failed'])

/** Backoff exponencial limitado (base 5s, máx 15min). */
export function calculateBackoff(attempts: number): number {
  const baseMs = 5_000
  const maxMs = 15 * 60_000
  const exponent = Math.min(20, Math.max(0, attempts - 1))
  return Math.min(maxMs, baseMs * 2 ** exponent)
}

/** Classifica falhas: transitórias → retryable; demais → requires_review (conservador). */
export function classifyAutomationFailure(error: unknown): AutomationFailure {
  const code = error instanceof Error ? error.message : String(error)
  return RETRYABLE_CODES.has(code) ? { kind: 'retryable', code } : { kind: 'requires_review', code }
}

export class AutomationJobs {
  constructor(private readonly db: LedgerDb) {}

  /** Enfileira um job de forma idempotente e CONCORRENTE-SAFE (ON CONFLICT DO NOTHING). */
  enqueue(input: EnqueueInput): EnqueueResult {
    const { scope } = input
    if (!ENVIRONMENTS.has(scope.environment) || !input.sourceKind || !input.sourceId || !input.operation) return { ok: false, reason: 'invalid_scope' }
    const key = automationKey(scope, input.sourceKind, input.sourceId, input.operation)
    const jobId = randomUUID()
    const now = new Date().toISOString()
    const result = this.db.db
      .query(
        `INSERT INTO automation_jobs (job_id, organization_id, environment, source_kind, source_id, operation, idempotency_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT (organization_id, environment, idempotency_key) DO NOTHING`,
      )
      .run(jobId, scope.organizationId, scope.environment, input.sourceKind, input.sourceId, input.operation, key, now, now)
    if (result.changes === 1) return { ok: true, jobId, duplicate: false }
    const existing = this.db.db.query('SELECT job_id FROM automation_jobs WHERE organization_id = ? AND environment = ? AND idempotency_key = ?').get(scope.organizationId, scope.environment, key) as { job_id: string }
    return { ok: true, jobId: existing.job_id, duplicate: true }
  }

  get(scope: FinancialScope, jobId: string): AutomationJob | null {
    return mapRow(this.db.db.query('SELECT * FROM automation_jobs WHERE job_id = ? AND organization_id = ? AND environment = ?').get(jobId, scope.organizationId, scope.environment) as Row | undefined)
  }

  /**
   * Claim atômico com fencing: exige escopo, workerId, leaseMs e maxAttempts válidos; respeita
   * next_retry_at, lease expirado e limite de tentativas. Incrementa lease_version monotononicamente.
   */
  claim(scope: FinancialScope, jobId: string, workerId: string, leaseMs = 60_000, maxAttempts = 8): AutomationJob | null {
    if (!workerId.trim()) return null
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) return null
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) return null
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const leaseUntil = new Date(now + leaseMs).toISOString()

    const row = this.db.db.transaction((): AutomationJob | null => {
      const result = this.db.db
        .query(
          `UPDATE automation_jobs
           SET status = 'processing', worker_id = ?, lease_version = lease_version + 1, lease_until = ?, attempts = attempts + 1, next_retry_at = NULL, updated_at = ?
           WHERE job_id = ? AND organization_id = ? AND environment = ? AND attempts < ?
             AND (
               status = 'pending'
               OR (status = 'retryable' AND (next_retry_at IS NULL OR next_retry_at <= ?))
               OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until <= ?)
             )`,
        )
        .run(workerId, leaseUntil, nowIso, jobId, scope.organizationId, scope.environment, maxAttempts, nowIso, nowIso)
      if (result.changes !== 1) return null
      return mapRow(this.db.db.query('SELECT * FROM automation_jobs WHERE job_id = ?').get(jobId) as Row | undefined)
    })()
    return row
  }

  /** Renova o lease somente se o worker ainda for o proprietário e o lease ainda estiver válido. */
  renewLease(scope: FinancialScope, lease: JobLease, extensionMs: number): boolean {
    if (!Number.isSafeInteger(extensionMs) || extensionMs <= 0) return false
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const nextLease = new Date(now + extensionMs).toISOString()
    const result = this.db.db
      .query(
        `UPDATE automation_jobs SET lease_until = ?, updated_at = ?
         WHERE job_id = ? AND organization_id = ? AND environment = ? AND status = 'processing' AND worker_id = ? AND lease_version = ? AND lease_until > ?`,
      )
      .run(nextLease, nowIso, lease.jobId, scope.organizationId, scope.environment, lease.workerId, lease.leaseVersion, nowIso)
    return result.changes === 1
  }

  /** Completa o job somente se o worker possuir o lease válido (fencing). */
  complete(scope: FinancialScope, lease: JobLease): boolean {
    const now = new Date().toISOString()
    const result = this.db.db
      .query(
        `UPDATE automation_jobs
         SET status = 'completed', worker_id = NULL, lease_until = NULL, next_retry_at = NULL, last_error_code = NULL, updated_at = ?
         WHERE job_id = ? AND organization_id = ? AND environment = ? AND status = 'processing' AND worker_id = ? AND lease_version = ? AND lease_until > ?`,
      )
      .run(now, lease.jobId, scope.organizationId, scope.environment, lease.workerId, lease.leaseVersion, now)
    return result.changes === 1
  }

  /** Registra falha somente se o worker possuir o lease válido (fencing); limite de tentativas → requires_review. */
  fail(scope: FinancialScope, lease: JobLease, failure: AutomationFailure, maxAttempts = 8): boolean {
    const now = new Date().toISOString()
    const job = this.get(scope, lease.jobId)
    const attempts = job?.attempts ?? 1
    const exhausted = attempts >= maxAttempts
    const status = failure.kind === 'requires_review' || exhausted ? 'requires_review' : 'retryable'
    const code = exhausted ? 'attempt_limit_reached' : failure.code
    const nextRetry = status === 'retryable' ? new Date(Date.now() + calculateBackoff(attempts)).toISOString() : null
    const result = this.db.db
      .query(
        `UPDATE automation_jobs
         SET status = ?, last_error_code = ?, next_retry_at = ?, lease_until = NULL, worker_id = NULL, updated_at = ?
         WHERE job_id = ? AND organization_id = ? AND environment = ? AND status = 'processing' AND worker_id = ? AND lease_version = ? AND lease_until > ?`,
      )
      .run(status, code, nextRetry, now, lease.jobId, scope.organizationId, scope.environment, lease.workerId, lease.leaseVersion, now)
    return result.changes === 1
  }

  /** Migra jobs cujo limite de tentativas foi atingido para requires_review; NUNCA interrompe worker com lease ativo. */
  sweepExhausted(scope: FinancialScope, maxAttempts = 8): number {
    const now = new Date().toISOString()
    const result = this.db.db
      .query(
        `UPDATE automation_jobs SET status = 'requires_review', last_error_code = 'attempt_limit_reached', lease_until = NULL, worker_id = NULL, updated_at = ?
         WHERE organization_id = ? AND environment = ? AND attempts >= ?
           AND (
             status = 'retryable'
             OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until <= ?)
           )`,
      )
      .run(now, scope.organizationId, scope.environment, maxAttempts, now)
    return result.changes
  }

  /** Descobre jobs elegíveis (pending, retryable com hora chegada, processing com lease expirado). */
  listEligible(scope: FinancialScope, maxAttempts = 8, limit = 50): AutomationJob[] {
    const nowIso = new Date().toISOString()
    const rows = this.db.db
      .query(
        `SELECT * FROM automation_jobs
         WHERE organization_id = ? AND environment = ? AND attempts < ?
           AND (
             status = 'pending'
             OR (status = 'retryable' AND (next_retry_at IS NULL OR next_retry_at <= ?))
             OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until <= ?)
           )
         ORDER BY created_at LIMIT ?`,
      )
      .all(scope.organizationId, scope.environment, maxAttempts, nowIso, nowIso, limit) as Row[]
    return rows.map((r) => mapRow(r)!)
  }
}

export type EffectResult = { ok: true; effectId: string; duplicate: boolean } | { ok: false; reason: 'invalid_effect' | 'effect_conflict' }

/** Idempotência dos EFEITOS financeiros: cada efeito é gravado uma única vez por (org, env, chave). */
export class AutomationEffects {
  constructor(private readonly db: LedgerDb) {}

  record(scope: FinancialScope, sourceKind: string, sourceId: string, effectKind: string, resultReference: string): EffectResult {
    if (!ENVIRONMENTS.has(scope.environment) || !sourceKind || !sourceId || !effectKind || !resultReference) return { ok: false, reason: 'invalid_effect' }
    const key = financialEffectKey(scope, sourceKind, sourceId, effectKind)
    const effectId = randomUUID()
    const now = new Date().toISOString()
    const result = this.db.db
      .query(
        `INSERT INTO automation_effects (effect_id, organization_id, environment, effect_key, source_id, effect_kind, result_reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (organization_id, environment, effect_key) DO NOTHING`,
      )
      .run(effectId, scope.organizationId, scope.environment, key, sourceId, effectKind, resultReference, now)
    if (result.changes === 1) return { ok: true, effectId, duplicate: false }
    // Chave já existe: repetição legítima somente se o resultReference for idêntico; senão, conflito.
    const existing = this.db.db.query('SELECT effect_id, result_reference FROM automation_effects WHERE organization_id = ? AND environment = ? AND effect_key = ?').get(scope.organizationId, scope.environment, key) as { effect_id: string; result_reference: string }
    if (existing.result_reference !== resultReference) return { ok: false, reason: 'effect_conflict' }
    return { ok: true, effectId: existing.effect_id, duplicate: true }
  }

  has(scope: FinancialScope, sourceKind: string, sourceId: string, effectKind: string): boolean {
    const key = financialEffectKey(scope, sourceKind, sourceId, effectKind)
    const row = this.db.db.query('SELECT 1 AS x FROM automation_effects WHERE organization_id = ? AND environment = ? AND effect_key = ?').get(scope.organizationId, scope.environment, key)
    return row != null
  }
}
