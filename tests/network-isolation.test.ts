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

describe('isolamento de ambientes (Circle Gateway)', () => {
  test('Mainnet mostra apenas redes live; Testnet apenas redes test', () => {
    const mainnet = gatewayChainsFor('mainnet')
    const testnet = gatewayChainsFor('testnet')
    expect(mainnet.length).toBeGreaterThan(0)
    expect(testnet.length).toBeGreaterThan(0)
    expect(mainnet.every((c) => c.env === 'live')).toBe(true)
    expect(testnet.every((c) => c.env === 'test')).toBe(true)
  })

  test('nenhuma rede testnet no Mainnet e nenhuma mainnet no Testnet', () => {
    const mainnetKeys = new Set(gatewayChainsFor('mainnet').map((c) => c.key))
    const testnetKeys = new Set(gatewayChainsFor('testnet').map((c) => c.key))
    expect([...mainnetKeys].some((k) => testnetKeys.has(k))).toBe(false)
    expect(mainnetKeys.has('Arc')).toBe(true)
    expect(mainnetKeys.has('Ethereum')).toBe(true)
    expect(testnetKeys.has('Arc_Testnet')).toBe(true)
    expect(testnetKeys.has('Ethereum_Sepolia')).toBe(true)
  })

  test('Arc é a rede principal (primeira) em ambos os ambientes', () => {
    expect(gatewayChainsFor('mainnet')[0].key).toBe('Arc')
    expect(gatewayChainsFor('testnet')[0].key).toBe('Arc_Testnet')
  })

  test('todas as redes têm chainId e rótulo válidos', () => {
    for (const c of GATEWAY_CHAINS) {
      expect(c.chainId).toBeGreaterThan(0)
      expect(c.label.length).toBeGreaterThan(0)
    }
  })
})
