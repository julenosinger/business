import { describe, expect, test } from 'bun:test'

// Stubs leves (o store importa módulos que tocam DOM/localStorage no carregamento).
const g = globalThis as unknown as Record<string, unknown>
const storage: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => void (storage[k] = v), removeItem: (k: string) => void delete storage[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { emptyLedger, postEvent } = await import('../src/lib/accounting/engine')
const { glRows } = await import('../src/lib/accounting/gl')
const { ledgerForEnvironment } = await import('../src/lib/environment-scope')
import type { Environment } from '../src/lib/types'

const NOW = '2026-11-22T10:00:00.000Z'
const ctx = { now: NOW, actor: { id: 'Dono', kind: 'user' as const } }
const draft = (env: Environment, key: string) => ({
  orgId: 'local',
  idempotencyKey: key,
  type: 'cashbook.income' as const,
  source: { module: 'cashbook' as const, recordId: key },
  occurredAt: NOW,
  accountingDate: '2026-11-22',
  currency: 'USDC' as const,
  amountMinor: '100000000',
  payload: { category: 'Outras receitas', description: key },
  confirmation: 'confirmed' as const,
  environment: env,
})

describe('idempotência por ambiente (FIN-03.2.1)', () => {
  test('mesma chave em ambientes diferentes não colide; repetição no mesmo ambiente é duplicata', () => {
    let l = emptyLedger()
    const r1 = postEvent(l, draft('mainnet', 'k1'), ctx)
    l = r1.ledger
    expect(r1.ok).toBe(true)
    expect(l.journal).toHaveLength(1)

    // Mesma chave em OUTRO ambiente: operação distinta, deve postar (sem colisão indevida).
    const r2 = postEvent(l, draft('testnet', 'k1'), ctx)
    expect(r2.ok).toBe(true)
    expect(r2.duplicate).toBe(false)
    l = r2.ledger
    expect(l.journal).toHaveLength(2)

    // Repetição no MESMO ambiente: duplicata (não gera novo lançamento).
    const r3 = postEvent(l, draft('mainnet', 'k1'), ctx)
    expect(r3.duplicate).toBe(true)
    expect(r3.ledger.journal).toHaveLength(2)
  })

  test('evento rejeitado não altera o ambiente de um evento existente', () => {
    let l = emptyLedger()
    l = postEvent(l, draft('mainnet', 'k2'), ctx).ledger
    const ev = l.events[0]!
    expect(ev.environment).toBe('mainnet')
    // Tentar reprocessar a mesma chave com outro ambiente: não há colisão e o ambiente original permanece.
    l = postEvent(l, draft('testnet', 'k2'), ctx).ledger
    expect(l.events.find((e) => e.id === ev.id)!.environment).toBe('mainnet')
  })
})

describe('Razão Geral isolado por ambiente (FIN-03.2.1)', () => {
  test('glRows com environment só retorna partidas do ambiente', () => {
    let l = emptyLedger()
    l = postEvent(l, draft('mainnet', 'm1'), ctx).ledger
    l = postEvent(l, draft('testnet', 't1'), ctx).ledger
    // 1 lançamento por ambiente, 2 linhas cada (débito caixa + crédito receita).
    expect(glRows(l).length).toBe(4)
    expect(glRows(l, { environment: 'mainnet' }).length).toBe(2)
    expect(glRows(l, { environment: 'testnet' }).length).toBe(2)
    expect(glRows(l, { environment: 'mainnet' }).every((r) => r.entryId === l.journal.find((j) => j.environment === 'mainnet')!.id)).toBe(true)
  })

  test('ledgerForEnvironment particiona eventos, partidas e períodos (mantém configuração)', () => {
    let l = emptyLedger()
    l = postEvent(l, draft('mainnet', 'm1'), ctx).ledger
    l = postEvent(l, draft('testnet', 't1'), ctx).ledger
    const scoped = ledgerForEnvironment(l, 'mainnet')
    expect(scoped.events).toHaveLength(1)
    expect(scoped.events[0]!.environment).toBe('mainnet')
    expect(scoped.journal).toHaveLength(1)
    expect(scoped.chart).toEqual(l.chart) // configuração compartilhada preservada
    expect(scoped.categoryMap).toEqual(l.categoryMap)
    expect(scoped.flags).toEqual(l.flags)
  })
})
