import { describe, expect, test } from 'bun:test'
import { createRemoteBackend, resolveBackend } from '../src/lib/accounting/backend'
import type { EventDraft } from '../src/lib/accounting/types'

function draft(): EventDraft {
  return {
    orgId: 'org1',
    idempotencyKey: 'k1',
    type: 'cashbook.income',
    source: { module: 'cashbook', recordId: 'c1' },
    occurredAt: '2026-11-22T10:00:00.000Z',
    accountingDate: '2026-11-22',
    currency: 'BRL',
    amountMinor: '10050',
    payload: { category: 'Outras receitas', description: 'x', cashEntryId: 'c1' },
    confirmation: 'confirmed',
  }
}

describe('backend transacional (transporte real via fetch)', () => {
  test('resolveBackend sem credenciais: indisponível com motivo exato', () => {
    expect(resolveBackend()).toMatchObject({ kind: 'remote', available: false, reason: 'missing_url' })
    expect(resolveBackend({ url: 'https://api.test' })).toMatchObject({ available: false, reason: 'missing_token' })
    expect(resolveBackend({ url: 'https://api.test', token: 't' })).toMatchObject({ available: false, reason: 'missing_org_id' })
  })

  test('createRemoteBackend posta via fetch com auth, orgId e idempotência', async () => {
    const g = globalThis as unknown as { fetch: typeof fetch }
    const original = g.fetch
    const urls: string[] = []
    let init: RequestInit | undefined
    g.fetch = (async (url: string, i: RequestInit) => {
      urls.push(url)
      init = i
      return new Response(JSON.stringify({ ok: true, ledger: { orgId: 'org1', journal: [] }, eventId: 'EV-1', entryId: 'JE-1', status: 'posted', duplicate: false }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      const backend = createRemoteBackend({ url: 'https://api.test/', token: 'secret', orgId: 'org1' })
      expect(backend.available).toBe(true)
      const res = await backend.postEvent(draft(), { id: 'u1', kind: 'user' })
      expect(res).toMatchObject({ ok: true, eventId: 'EV-1', entryId: 'JE-1' })
      expect(urls[0]).toBe('https://api.test/api/ledger/events')
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer secret')
      const body = JSON.parse(String(init?.body)) as { orgId: string; draft: EventDraft }
      expect(body.orgId).toBe('org1')
      expect(body.draft.idempotencyKey).toBe('k1')
    } finally {
      g.fetch = original
    }
  })

  test('fetch consulta o razão com orgId isolado', async () => {
    const g = globalThis as unknown as { fetch: typeof fetch }
    const original = g.fetch
    const urls: string[] = []
    g.fetch = (async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ orgId: 'org1', journal: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      const backend = createRemoteBackend({ url: 'https://api.test', token: 't', orgId: 'org with space' })
      await backend.fetch()
      expect(urls[0]).toBe('https://api.test/api/ledger?orgId=org%20with%20space')
    } finally {
      g.fetch = original
    }
  })

  test('erro HTTP vira rejeição, nunca sucesso falso', async () => {
    const g = globalThis as unknown as { fetch: typeof fetch }
    const original = g.fetch
    g.fetch = (async () => new Response(JSON.stringify({ error: 'idempotency conflict' }), { status: 409 })) as typeof fetch
    try {
      const backend = createRemoteBackend({ url: 'https://api.test', token: 't', orgId: 'o' })
      await expect(backend.postEvent(draft(), { id: 'u', kind: 'user' })).rejects.toThrow('idempotency conflict')
    } finally {
      g.fetch = original
    }
  })
})
