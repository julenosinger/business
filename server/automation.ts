/**
 * Núcleo de automação financeira (FIN-04.1B.2.2B.3.2A).
 *
 * Jobs duráveis e idempotentes para coordenar efeitos subsequentes a uma liquidação verificada
 * (propagação de estoque, lançamento contábil, conciliação), SEM ser uma segunda autoridade de
 * liquidação. A liquidação financeira continua sendo a autoridade; este núcleo apenas consome
 * resultados verificados e produz efeitos comprovadamente ausentes.
 */
import { randomUUID } from 'node:crypto'
import type { LedgerDb } from './db'

export type FinancialScope = { organizationId: string; environment: 'mainnet' | 'testnet' }
export type AutomationJobStatus = 'pending' | 'processing' | 'completed' | 'retryable' | 'requires_review'

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
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
}

/** Chave de automação estável e com escopo explícito (organização + ambiente + origem + operação). */
export function automationKey(scope: FinancialScope, sourceKind: string, sourceId: string, operation: string): string {
  return JSON.stringify([scope.organizationId, scope.environment, sourceKind, sourceId, operation])
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
    lastErrorCode: r.last_error_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class AutomationJobs {
  constructor(private readonly db: LedgerDb) {}

  /** Enfileira um job de forma idempotente (chave única por org+env+idempotency_key). */
  enqueue(input: EnqueueInput): EnqueueResult {
    const { scope } = input
    if (!ENVIRONMENTS.has(scope.environment) || !input.sourceKind || !input.sourceId || !input.operation) return { ok: false, reason: 'invalid_scope' }
    const key = automationKey(scope, input.sourceKind, input.sourceId, input.operation)
    const existing = this.db.db.query('SELECT job_id FROM automation_jobs WHERE organization_id = ? AND environment = ? AND idempotency_key = ?').get(scope.organizationId, scope.environment, key) as { job_id: string } | undefined
    if (existing) return { ok: true, jobId: existing.job_id, duplicate: true }
    const jobId = randomUUID()
    const now = new Date().toISOString()
    this.db.db
      .query('INSERT INTO automation_jobs (job_id, organization_id, environment, source_kind, source_id, operation, idempotency_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(jobId, scope.organizationId, scope.environment, input.sourceKind, input.sourceId, input.operation, key, 'pending', now, now)
    return { ok: true, jobId, duplicate: false }
  }

  get(jobId: string): AutomationJob | null {
    return mapRow(this.db.db.query('SELECT * FROM automation_jobs WHERE job_id = ?').get(jobId) as Row | undefined)
  }

  /** Claim atômico (lease) — impede dois workers processarem o mesmo job; lease expirado permite re-claim. */
  claim(jobId: string, leaseMs = 60_000): AutomationJob | null {
    const now = Date.now()
    const leaseUntil = new Date(now + leaseMs).toISOString()
    const nowIso = new Date(now).toISOString()
    const result = this.db.db
      .query(
        `UPDATE automation_jobs SET status = 'processing', lease_until = ?, attempts = attempts + 1, updated_at = ?
         WHERE job_id = ?
           AND ((status = 'pending' OR status = 'retryable')
                OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until <= ?))`,
      )
      .run(leaseUntil, nowIso, jobId, nowIso)
    if (result.changes !== 1) return null
    return this.get(jobId)
  }

  complete(jobId: string): void {
    this.db.db.query("UPDATE automation_jobs SET status = 'completed', lease_until = NULL, updated_at = ? WHERE job_id = ?").run(new Date().toISOString(), jobId)
  }

  fail(jobId: string, errorCode: string, retryable: boolean, backoffMs = 60_000): void {
    const now = new Date().toISOString()
    const nextRetry = retryable ? new Date(Date.now() + backoffMs).toISOString() : null
    this.db.db
      .query("UPDATE automation_jobs SET status = ?, last_error_code = ?, next_retry_at = ?, lease_until = NULL, updated_at = ? WHERE job_id = ?")
      .run(retryable ? 'retryable' : 'requires_review', errorCode, nextRetry, now, jobId)
  }

  listPending(scope: FinancialScope): AutomationJob[] {
    const rows = this.db.db
      .query("SELECT * FROM automation_jobs WHERE organization_id = ? AND environment = ? AND status IN ('pending', 'retryable') ORDER BY created_at")
      .all(scope.organizationId, scope.environment) as Row[]
    return rows.map((r) => mapRow(r)!)
  }
}
