import { describe, expect, test } from 'bun:test'
import { canCancel, canClassifyEnvironment, inFlightIntentEnv, payEligibility, paymentQueueState, requestEnv, requestsForNetwork, treasuryOpEnv, treasuryOpsForNetwork } from '../src/lib/treasury-selectors'
import type { Account, PaymentRequest, TreasuryOp } from '../src/lib/types'

const op = (chain: string, over: Partial<TreasuryOp> = {}): TreasuryOp => ({ id: 'op', date: '2026-11-22', kind: 'spend', chain, amount: '1', note: '', ...over })

const req = (chainKey: string): PaymentRequest => ({
  id: 'r',
  accountId: 'a',
  description: 'd',
  fiatAmount: 1,
  amount: '1',
  chainKey,
  chainId: 1,
  recipient: `0x${'a'.repeat(40)}`,
  createdAt: '2026-11-22',
  fromBlock: '0',
  status: 'open',
})

describe('isolamento de histórico da tesouraria', () => {
  test('treasuryOpEnv classifica pela rede persistida (origem, depois destino)', () => {
    expect(treasuryOpEnv(op('Arc'))).toBe('live')
    expect(treasuryOpEnv(op('Arc_Testnet'))).toBe('test')
    expect(treasuryOpEnv(op('Base'))).toBe('live')
    expect(treasuryOpEnv(op('Base_Sepolia'))).toBe('test')
    expect(treasuryOpEnv(op('Unknown'))).toBe('unknown')
    expect(treasuryOpEnv({ chain: '', destChain: 'Arc_Testnet' })).toBe('test')
  })

  test('Mainnet mostra só operações live; Testnet só operações test', () => {
    const ops = [op('Arc'), op('Arc_Testnet'), op('Base'), op('Base_Sepolia'), op('Unknown')]
    expect(treasuryOpsForNetwork(ops, 'mainnet').map((o) => o.chain)).toEqual(['Arc', 'Base'])
    expect(treasuryOpsForNetwork(ops, 'testnet').map((o) => o.chain)).toEqual(['Arc_Testnet', 'Base_Sepolia'])
  })

  test('registro legado (rede desconhecida) não vaza para nenhum ambiente', () => {
    const ops = [op('Unknown')]
    expect(treasuryOpsForNetwork(ops, 'mainnet')).toHaveLength(0)
    expect(treasuryOpsForNetwork(ops, 'testnet')).toHaveLength(0)
  })

  test('origem e destino de ambientes diferentes → invalid_environment', () => {
    expect(treasuryOpEnv({ chain: 'Arc', destChain: 'Arc_Testnet' })).toBe('invalid_environment')
    expect(treasuryOpEnv({ chain: 'Arc_Testnet', destChain: 'Base' })).toBe('invalid_environment')
    // Não vaza para nenhum ambiente.
    expect(treasuryOpsForNetwork([{ ...op('Arc'), destChain: 'Arc_Testnet' }], 'mainnet')).toHaveLength(0)
    expect(treasuryOpsForNetwork([{ ...op('Arc'), destChain: 'Arc_Testnet' }], 'testnet')).toHaveLength(0)
  })

  test('redes adicionais são reconhecidas para classificação (sem habilitar execução)', () => {
    expect(treasuryOpEnv(op('Sei'))).toBe('live')
    expect(treasuryOpEnv(op('Sonic'))).toBe('live')
    expect(treasuryOpEnv(op('HyperEVM'))).toBe('live')
    expect(treasuryOpEnv(op('Unichain'))).toBe('live')
    expect(treasuryOpEnv(op('World_Chain'))).toBe('live')
    expect(treasuryOpEnv(op('Sei_Testnet'))).toBe('test')
    expect(treasuryOpEnv(op('Unichain_Sepolia'))).toBe('test')
    expect(treasuryOpEnv(op('World_Chain_Sepolia'))).toBe('test')
  })

  test('requestsForNetwork filtra cobranças por chainKey persistida', () => {
    const rs = [req('Arc'), req('Arc_Testnet'), req('Base')]
    expect(requestsForNetwork(rs, 'mainnet').map((r) => r.chainKey)).toEqual(['Arc', 'Base'])
    expect(requestsForNetwork(rs, 'testnet').map((r) => r.chainKey)).toEqual(['Arc_Testnet'])
    expect(requestEnv(req('Arc'))).toBe('live')
    expect(requestEnv(req('Unknown'))).toBe('unknown')
  })
})

describe('intenção de pagamento em processamento', () => {
  const spendOp = (accountId: string, chain: string, status: TreasuryOp['status']): TreasuryOp => ({
    id: 'op',
    date: '2026-11-22',
    kind: 'spend',
    chain,
    amount: '1',
    note: '',
    accountId,
    status,
  })

  test('intenção pendente na Mainnet/Testnet → in-flight live/test', () => {
    expect(inFlightIntentEnv('a1', [spendOp('a1', 'Arc', 'pending')])).toBe('live')
    expect(inFlightIntentEnv('a1', [spendOp('a1', 'Arc_Testnet', 'pending')])).toBe('test')
    expect(inFlightIntentEnv('a1', [spendOp('a1', 'Arc', 'requires_review')])).toBe('live')
  })

  test('sem intenção, falha ou confirmada → null (não preparada/liberada)', () => {
    expect(inFlightIntentEnv('a1', [])).toBeNull()
    expect(inFlightIntentEnv('a1', [spendOp('a1', 'Arc', 'failed')])).toBeNull()
    expect(inFlightIntentEnv('a1', [spendOp('a1', 'Arc', 'confirmed')])).toBeNull()
  })
})

describe('estado da obrigação na fila (preparação explícita)', () => {
  test('preparada para o ambiente atual → prepared; outro ambiente → other_env; sem rede → unprepared', () => {
    expect(paymentQueueState({ paymentNetwork: 'mainnet' }, 'mainnet')).toBe('prepared')
    expect(paymentQueueState({ paymentNetwork: 'testnet' }, 'mainnet')).toBe('other_env')
    expect(paymentQueueState({ paymentNetwork: 'testnet' }, 'testnet')).toBe('prepared')
    expect(paymentQueueState({ paymentNetwork: undefined }, 'mainnet')).toBe('unprepared')
  })
})

describe('elegibilidade e cancelamento (puros)', () => {
  const acc = (over: Partial<Account> = {}): Account => ({
    id: 'a1',
    kind: 'payable',
    description: 'd',
    contactName: 'c',
    amount: 100,
    dueDate: '2026-12-01',
    category: 'Aluguel',
    status: 'open',
    source: 'manual',
    ...over,
  })
  const pendingOp: TreasuryOp = { id: 'op', date: '2026-11-22', kind: 'spend', chain: 'Arc', amount: '1', note: '', accountId: 'a1', status: 'pending' }

  test('payEligibility: cancelada/liquidada/intenção ativa/ok', () => {
    expect(payEligibility(acc(), [])).toEqual({ ok: true })
    expect(payEligibility(acc({ canceledAt: '2026-11-22' }), [])).toEqual({ ok: false, reason: 'canceled' })
    expect(payEligibility(acc({ status: 'paid' }), [])).toEqual({ ok: false, reason: 'settled' })
    expect(payEligibility(acc(), [pendingOp])).toEqual({ ok: false, reason: 'active_intent' })
  })

  test('canCancel: só manual, sem liquidações e sem intenção ativa', () => {
    expect(canCancel(acc(), [])).toEqual({ ok: true })
    expect(canCancel(acc({ source: 'purchase' }), [])).toEqual({ ok: false, reason: 'not_manual' })
    expect(canCancel(acc({ settlements: [{ id: 's', sequence: 1, amount: 10, date: '2026-11-22' }] }), [])).toEqual({ ok: false, reason: 'settled' })
    expect(canCancel(acc(), [pendingOp])).toEqual({ ok: false, reason: 'active_intent' })
    expect(canCancel(undefined, [])).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('reclassificação manual do ambiente (legado unassigned)', () => {
  const acc = (over: Partial<Account> = {}): Account => ({
    id: 'a1',
    kind: 'payable',
    description: 'd',
    contactName: 'c',
    amount: 100,
    dueDate: '2026-12-01',
    category: 'Aluguel',
    status: 'open',
    source: 'manual',
    ...over,
  })
  const op = (accountId: string, chain: string, status: TreasuryOp['status']): TreasuryOp => ({ id: 'op', date: '2026-11-22', kind: 'spend', chain, amount: '1', note: '', accountId, status })

  test('obrigação unassigned pode ser classificada em Mainnet ou Testnet', () => {
    expect(canClassifyEnvironment(acc({ environment: 'unassigned' }), [], 'mainnet')).toEqual({ ok: true })
    expect(canClassifyEnvironment(acc({ environment: undefined }), [], 'testnet')).toEqual({ ok: true })
  })

  test('obrigação já classificada não é reclassificável', () => {
    expect(canClassifyEnvironment(acc({ environment: 'mainnet' }), [], 'testnet')).toEqual({ ok: false, reason: 'already_classified' })
    expect(canClassifyEnvironment(acc({ environment: 'testnet' }), [], 'mainnet')).toEqual({ ok: false, reason: 'already_classified' })
  })

  test('obrigação liquidada (paga ou parcial) não é reclassificável', () => {
    expect(canClassifyEnvironment(acc({ environment: 'unassigned', status: 'paid' }), [], 'mainnet')).toEqual({ ok: false, reason: 'settled' })
    expect(canClassifyEnvironment(acc({ environment: 'unassigned', settlements: [{ id: 's', sequence: 1, amount: 10, date: '2026-11-22' }] }), [], 'mainnet')).toEqual({ ok: false, reason: 'settled' })
  })

  test('obrigação com intenção ativa não é reclassificável', () => {
    expect(canClassifyEnvironment(acc({ environment: 'unassigned' }), [op('a1', 'Arc', 'pending')], 'mainnet')).toEqual({ ok: false, reason: 'active_intent' })
    expect(canClassifyEnvironment(acc({ environment: 'unassigned' }), [op('a1', 'Arc_Testnet', 'requires_review')], 'testnet')).toEqual({ ok: false, reason: 'active_intent' })
  })

  test('evidência on-chain de outro ambiente bloqueia a reclassificação', () => {
    // Operação em rede testnet impede classificar como mainnet.
    expect(canClassifyEnvironment(acc({ environment: 'unassigned' }), [op('a1', 'Arc_Testnet', 'failed')], 'mainnet')).toEqual({ ok: false, reason: 'conflicting_evidence' })
    // Operação em rede mainnet permite classificar como mainnet (evidência compatível), mas não como testnet.
    expect(canClassifyEnvironment(acc({ environment: 'unassigned' }), [op('a1', 'Arc', 'failed')], 'mainnet')).toEqual({ ok: true })
    expect(canClassifyEnvironment(acc({ environment: 'unassigned' }), [op('a1', 'Arc', 'failed')], 'testnet')).toEqual({ ok: false, reason: 'conflicting_evidence' })
    // Origem/destino de ambientes diferentes → conflito.
    expect(canClassifyEnvironment(acc({ environment: 'unassigned' }), [{ ...op('a1', 'Arc', 'failed'), destChain: 'Arc_Testnet' }], 'mainnet')).toEqual({ ok: false, reason: 'conflicting_evidence' })
  })

  test('obrigação inexistente não é classificável', () => {
    expect(canClassifyEnvironment(undefined, [], 'mainnet')).toEqual({ ok: false, reason: 'not_found' })
  })
})
