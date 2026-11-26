import { describe, expect, test } from 'bun:test'
import { LedgerDb } from '../server/db'
import { AutomationJobs, automationKey } from '../server/automation'

const scope = { organizationId: 'org-1', environment: 'testnet' as const }

function makeJobs(): AutomationJobs {
  return new AutomationJobs(new LedgerDb(':memory:'))
}

describe('FIN-04.1B.2.2B.3.2A — núcleo de automação financeira', () => {
  test('automationKey é estável e isolada por organização/ambiente', () => {
    const a = automationKey(scope, 'payment', 'settle-1', 'settlement-propagation')
    const b = automationKey(scope, 'payment', 'settle-1', 'settlement-propagation')
    expect(a).toBe(b)
    // organização diferente → chave diferente
    expect(automationKey({ organizationId: 'org-2', environment: 'testnet' }, 'payment', 'settle-1', 'settlement-propagation')).not.toBe(a)
    // ambiente diferente → chave diferente
    expect(automationKey({ organizationId: 'org-1', environment: 'mainnet' }, 'payment', 'settle-1', 'settlement-propagation')).not.toBe(a)
  })

  test('enqueue é idempotente (mesma operação não duplica job)', () => {
    const jobs = makeJobs()
    const first = jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 'settle-1', operation: 'settlement-propagation' })
    expect(first).toEqual({ ok: true, jobId: first.ok ? first.jobId : '', duplicate: false })
    const again = jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 'settle-1', operation: 'settlement-propagation' })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.duplicate).toBe(true)
    expect(again.jobId).toBe((first as { jobId: string }).jobId)
  })

  test('claim é atômico — dois claims do mesmo job não obtêm o lease', () => {
    const jobs = makeJobs()
    const r = jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 's1', operation: 'op' })
    if (!r.ok) throw new Error('enqueue failed')
    const claimed = jobs.claim(r.jobId)
    expect(claimed?.status).toBe('processing')
    expect(claimed?.attempts).toBe(1)
    // segundo claim enquanto o lease está ativo → null
    expect(jobs.claim(r.jobId)).toBeNull()
  })

  test('complete e fail (retryable/requires_review) atualizam o estado', () => {
    const jobs = makeJobs()
    const r = jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 's1', operation: 'op' })
    if (!r.ok) throw new Error('enqueue failed')
    jobs.claim(r.jobId)
    jobs.complete(r.jobId)
    expect(jobs.get(r.jobId)?.status).toBe('completed')

    const r2 = jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 's2', operation: 'op' })
    if (!r2.ok) throw new Error('enqueue failed')
    jobs.claim(r2.jobId)
    jobs.fail(r2.jobId, 'persistence_failed', true)
    expect(jobs.get(r2.jobId)?.status).toBe('retryable')
    expect(jobs.get(r2.jobId)?.lastErrorCode).toBe('persistence_failed')

    const r3 = jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 's3', operation: 'op' })
    if (!r3.ok) throw new Error('enqueue failed')
    jobs.claim(r3.jobId)
    jobs.fail(r3.jobId, 'unrecoverable', false)
    expect(jobs.get(r3.jobId)?.status).toBe('requires_review')
  })

  test('listPending retorna jobs pendentes/retryable do escopo', () => {
    const jobs = makeJobs()
    jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 's1', operation: 'op' })
    jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 's2', operation: 'op' })
    jobs.enqueue({ scope: { organizationId: 'org-2', environment: 'testnet' }, sourceKind: 'payment', sourceId: 's1', operation: 'op' })
    expect(jobs.listPending(scope)).toHaveLength(2)
  })

  test('lease expirado permite re-claim (recuperação)', () => {
    const jobs = makeJobs()
    const r = jobs.enqueue({ scope, sourceKind: 'payment', sourceId: 's1', operation: 'op' })
    if (!r.ok) throw new Error('enqueue failed')
    // lease de 0ms → expira imediatamente
    jobs.claim(r.jobId, 0)
    const again = jobs.claim(r.jobId, 0)
    expect(again?.status).toBe('processing')
    expect(again?.attempts).toBe(2)
  })
})
