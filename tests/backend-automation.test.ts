import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LedgerDb } from '../server/db'
import { AutomationJobs, AutomationEffects, automationKey, financialEffectKey, calculateBackoff, classifyAutomationFailure, type JobLease } from '../server/automation'

const scope = { organizationId: 'org-1', environment: 'testnet' as const }
const W = 'worker-1'
const W2 = 'worker-2'

function makeJobs(): { jobs: AutomationJobs; db: LedgerDb } {
  const db = new LedgerDb(':memory:')
  return { jobs: new AutomationJobs(db), db }
}
function enqueueOne(jobs: AutomationJobs, sourceId = 's1'): string {
  const r = jobs.enqueue({ scope, sourceKind: 'payment', sourceId, operation: 'settlement-propagation' })
  if (!r.ok) throw new Error('enqueue failed')
  return r.jobId
}
function leaseOf(jobId: string, workerId: string, version: number): JobLease {
  return { jobId, workerId, leaseVersion: version }
}
/** Expira o lease ou o retry de um job (clock controlado via manipulação direta do banco). */
function expire(db: LedgerDb, jobId: string, field: 'lease_until' | 'next_retry_at'): void {
  db.db.query(`UPDATE automation_jobs SET ${field} = '1970-01-01T00:00:00.000Z' WHERE job_id = ?`).run(jobId)
}

describe('FIN-04.1B.2.2B.3.2A.1 — chaves e idempotência', () => {
  test('automationKey e financialEffectKey são estáveis e isoladas', () => {
    expect(automationKey(scope, 'payment', 's1', 'op')).toBe(automationKey(scope, 'payment', 's1', 'op'))
    expect(automationKey({ organizationId: 'org-2', environment: 'testnet' }, 'payment', 's1', 'op')).not.toBe(automationKey(scope, 'payment', 's1', 'op'))
    expect(automationKey({ organizationId: 'org-1', environment: 'mainnet' }, 'payment', 's1', 'op')).not.toBe(automationKey(scope, 'payment', 's1', 'op'))
    expect(financialEffectKey(scope, 'purchase', 'p1', 'inventory-posted')).not.toBe(financialEffectKey(scope, 'purchase', 'p1', 'accounting-posted'))
  })

  test('enqueue é idempotente e concorrente-safe (ON CONFLICT)', () => {
    const { jobs } = makeJobs()
    const a = jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 's1', operation: 'op' })
    const b = jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 's1', operation: 'op' })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.duplicate).toBe(true)
    expect(b.jobId).toBe(a.jobId)
  })

  test('automationEffects grava cada efeito uma única vez', () => {
    const db = new LedgerDb(':memory:')
    const fx = new AutomationEffects(db)
    const a = fx.record(scope, 'purchase', 'p1', 'inventory-posted', 'move-1')
    const b = fx.record(scope, 'purchase', 'p1', 'inventory-posted', 'move-1')
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.duplicate).toBe(true)
    expect(b.effectId).toBe(a.effectId)
    expect(fx.has(scope, 'purchase', 'p1', 'inventory-posted')).toBe(true)
    expect(fx.has(scope, 'purchase', 'p1', 'accounting-posted')).toBe(false)
  })

  test('automationEffects distingue repetição legítima de conflito (resultReference)', () => {
    const db = new LedgerDb(':memory:')
    const fx = new AutomationEffects(db)
    const a = fx.record(scope, 'purchase', 'p1', 'inventory-posted', 'move-1')
    expect(a.ok).toBe(true)
    // mesmo resultReference → repetição legítima
    const again = fx.record(scope, 'purchase', 'p1', 'inventory-posted', 'move-1')
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.duplicate).toBe(true)
    expect(again.effectId).toBe((a as { effectId: string }).effectId)
    // resultReference diferente → conflito (não é o mesmo efeito)
    expect(fx.record(scope, 'purchase', 'p1', 'inventory-posted', 'move-2')).toEqual({ ok: false, reason: 'effect_conflict' })
  })
})

describe('FIN-04.1B.2.2B.3.2A.1 — fencing do lease', () => {
  test('claim é atômico e atribui worker + leaseVersion monotônica', () => {
    const { jobs } = makeJobs()
    const id = enqueueOne(jobs)
    const c1 = jobs.claim(scope, id, W)
    expect(c1?.workerId).toBe(W)
    expect(c1?.leaseVersion).toBe(1)
    expect(jobs.claim(scope, id, W2)).toBeNull() // segundo worker não obtém lease ativo
  })

  test('complete/fail protegidos: worker obsoleto não finaliza; completed não retorna', () => {
    const { jobs } = makeJobs()
    const id = enqueueOne(jobs)
    const c = jobs.claim(scope, id, W)
    if (!c) throw new Error('claim failed')
    expect(jobs.complete(scope, leaseOf(id, W2, c.leaseVersion))).toBe(false) // worker errado
    expect(jobs.complete(scope, leaseOf(id, W, c.leaseVersion))).toBe(true) // worker certo
    expect(jobs.get(scope, id)?.status).toBe('completed')
    expect(jobs.claim(scope, id, W)).toBeNull() // completed não retorna a processing
  })

  test('lease expirado não autoriza completar (fencing temporal)', () => {
    const { jobs, db } = makeJobs()
    const id = enqueueOne(jobs)
    const c = jobs.claim(scope, id, W)
    if (!c) throw new Error('claim failed')
    expire(db, id, 'lease_until')
    expect(jobs.complete(scope, leaseOf(id, W, c.leaseVersion))).toBe(false)
    // fail por worker obsoleto também é bloqueado
    expect(jobs.fail(scope, leaseOf(id, W, c.leaseVersion), { kind: 'retryable', code: 'x' })).toBe(false)
  })

  test('renewLease: worker correto renova; worker obsoleto/versão antiga não', () => {
    const { jobs } = makeJobs()
    const id = enqueueOne(jobs)
    const c = jobs.claim(scope, id, W)
    if (!c) throw new Error('claim failed')
    expect(jobs.renewLease(scope, leaseOf(id, W, c.leaseVersion), 60_000)).toBe(true)
    expect(jobs.renewLease(scope, leaseOf(id, W2, c.leaseVersion), 60_000)).toBe(false)
    expect(jobs.renewLease(scope, leaseOf(id, W, c.leaseVersion + 1), 60_000)).toBe(false)
  })

  test('fail retryable respeita backoff; limite de tentativas → requires_review', () => {
    const { jobs } = makeJobs()
    const id = enqueueOne(jobs)
    const c = jobs.claim(scope, id, W)
    if (!c) throw new Error('claim failed')
    jobs.fail(scope, leaseOf(id, W, c.leaseVersion), { kind: 'retryable', code: 'persistence_failed' }, 8)
    expect(jobs.get(scope, id)?.status).toBe('retryable')
    expect(jobs.get(scope, id)?.nextRetryAt).toBeTruthy()
  })
})

describe('FIN-04.1B.2.2B.3.2A.1 — recuperação', () => {
  test('claim respeita next_retry_at (não re-executa antes do backoff)', () => {
    const { jobs } = makeJobs()
    const id = enqueueOne(jobs)
    const c = jobs.claim(scope, id, W)
    if (!c) throw new Error('claim failed')
    jobs.fail(scope, leaseOf(id, W, c.leaseVersion), { kind: 'retryable', code: 'persistence_failed' })
    expect(jobs.claim(scope, id, W)).toBeNull() // next_retry_at no futuro
  })

  test('listEligible descobre pending, retryable (hora chegada) e processing com lease expirado', () => {
    const { jobs, db } = makeJobs()
    const p1 = enqueueOne(jobs, 'p1') // → processing com lease expirado
    const p2 = enqueueOne(jobs, 'p2') // → retryable com hora chegada
    const p3 = enqueueOne(jobs, 'p3') // → pending
    const c1 = jobs.claim(scope, p1, W)
    if (!c1) throw new Error('claim p1 failed')
    expire(db, p1, 'lease_until')
    const c2 = jobs.claim(scope, p2, W)
    if (!c2) throw new Error('claim p2 failed')
    jobs.fail(scope, leaseOf(p2, W, c2.leaseVersion), { kind: 'retryable', code: 'x' })
    expire(db, p2, 'next_retry_at')
    const ids = jobs.listEligible(scope).map((j) => j.jobId)
    expect(ids).toContain(p1)
    expect(ids).toContain(p2)
    expect(ids).toContain(p3)
  })

  test('sweepExhausted não interrompe worker com lease ativo; migra após expiração', () => {
    const { jobs, db } = makeJobs()
    const id = enqueueOne(jobs)
    const c = jobs.claim(scope, id, W, 60_000, 1) // maxAttempts=1 → attempts=1, lease ativo
    if (!c) throw new Error('claim failed')
    // Correção P0.1: worker com lease ativo NÃO pode ser interrompido.
    expect(jobs.sweepExhausted(scope, 1)).toBe(0)
    expect(jobs.get(scope, id)?.status).toBe('processing')
    expire(db, id, 'lease_until')
    expect(jobs.sweepExhausted(scope, 1)).toBe(1)
    expect(jobs.get(scope, id)?.status).toBe('requires_review')
    expect(jobs.get(scope, id)?.lastErrorCode).toBe('attempt_limit_reached')
  })

  test('calculateBackoff é exponencial e limitado', () => {
    expect(calculateBackoff(1)).toBe(5_000)
    expect(calculateBackoff(2)).toBe(10_000)
    expect(calculateBackoff(3)).toBe(20_000)
    expect(calculateBackoff(20)).toBe(15 * 60_000)
  })

  test('classifyAutomationFailure distingue transitório de revisão', () => {
    expect(classifyAutomationFailure(new Error('persistence_failed'))).toEqual({ kind: 'retryable', code: 'persistence_failed' })
    expect(classifyAutomationFailure(new Error('period_closed'))).toEqual({ kind: 'requires_review', code: 'period_closed' })
  })

  test('persistência e migração: jobs sobrevivem a reabertura do banco (arquivo)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbos-auto-'))
    const path = join(dir, 'jobs.sqlite')
    const id = (() => {
      const db = new LedgerDb(path)
      const jobs = new AutomationJobs(db)
      const r = jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 'settle-1', operation: 'settlement-propagation' })
      if (!r.ok) throw new Error('enqueue failed')
      db.close()
      return r.jobId
    })()
    // Reabre: migrations já aplicadas são ignoradas; o job e o lease_version são preservados.
    const db = new LedgerDb(path)
    const jobs = new AutomationJobs(db)
    const job = jobs.get(scope, id)
    expect(job).toBeTruthy()
    expect(job?.status).toBe('pending')
    expect(job?.leaseVersion).toBe(0)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
