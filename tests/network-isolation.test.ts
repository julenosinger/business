import { describe, expect, test } from 'bun:test'

// Mocks de ambiente (localStorage + navigator + document) antes de importar gateway.
const g = globalThis as unknown as Record<string, unknown>
const store = new Map<string, string>()
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
g.navigator = { language: 'en-US' }
g.document = { documentElement: { lang: '' } }

const { gatewayChainsFor, GATEWAY_CHAINS } = await import('../src/lib/gateway')

describe('Circle Gateway — exclusivamente Mainnet', () => {
  test('GATEWAY_CHAINS contém apenas redes Mainnet (live)', () => {
    expect(GATEWAY_CHAINS.length).toBeGreaterThan(0)
    expect(GATEWAY_CHAINS.every((c) => c.env === 'live')).toBe(true)
  })

  test('Arc é a rede principal (primeira)', () => {
    expect(gatewayChainsFor('mainnet')[0].key).toBe('Arc')
    expect(gatewayChainsFor('mainnet').map((c) => c.key)).toContain('Ethereum')
  })

  test('não há redes Testnet na configuração operacional', () => {
    expect(GATEWAY_CHAINS.some((c) => /Testnet|Sepolia|Amoy|Fuji/.test(c.key))).toBe(false)
  })

  test('todas as redes têm chainId e rótulo válidos', () => {
    for (const c of GATEWAY_CHAINS) {
      expect(c.chainId).toBeGreaterThan(0)
      expect(c.label.length).toBeGreaterThan(0)
    }
  })
})
