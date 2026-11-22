import { describe, expect, test } from 'bun:test'
import { requestEnv, requestsForNetwork, treasuryOpEnv, treasuryOpsForNetwork } from '../src/lib/treasury-selectors'
import type { PaymentRequest, TreasuryOp } from '../src/lib/types'

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
