import { describe, expect, test } from 'bun:test'

// Mocks de ambiente (localStorage + document) ANTES de importar os módulos singleton.
const g = globalThis as unknown as Record<string, unknown>
const store = new Map<string, string>()
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
const dataset: Record<string, string> = {}
g.document = { documentElement: { dataset } }

const { getNetwork, setNetwork, NETWORKS, arcChainIdOf, arcGatewayKeyOf, isValidNetwork, ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } = await import('../src/lib/network')
const { setTheme } = await import('../src/lib/theme')

describe('rede ativa (Mainnet default, seleção explícita e persistência)', () => {
  test('Mainnet é o padrão para novos usuários (chain 5042)', () => {
    expect(getNetwork()).toBe('mainnet')
    expect(ARC_MAINNET_CHAIN_ID).toBe(5042)
    expect(ARC_TESTNET_CHAIN_ID).toBe(5042002)
    expect(NETWORKS.mainnet.env).toBe('live')
    expect(NETWORKS.testnet.env).toBe('test')
    expect(arcChainIdOf('mainnet')).toBe(5042)
    expect(arcChainIdOf('testnet')).toBe(5042002)
  })

  test('setNetwork é inoperante: a rede ativa é imutável (Mainnet)', () => {
    setNetwork('testnet')
    expect(getNetwork()).toBe('mainnet') // Testnet não pode mais ser ativada
    expect(store.get('gbos:network')).toBeUndefined() // nada é persistido
    setNetwork('mainnet')
    expect(getNetwork()).toBe('mainnet')
  })

  test('valor inválido é recusado (validação) e não altera a rede', () => {
    setNetwork('mainnet')
    setNetwork('bogus' as never)
    expect(getNetwork()).toBe('mainnet')
  })

  test('Mainnet é operacional: mapeia para a chain Arc correta, sem gate artificial', () => {
    // Não existe mais MAINNET_READY/isMainnetBlocked: Mainnet deve ser executável.
    expect(arcGatewayKeyOf('mainnet')).toBe('Arc')
    expect(arcGatewayKeyOf('testnet')).toBe('Arc_Testnet')
    expect(isValidNetwork('mainnet')).toBe(true)
    expect(isValidNetwork('testnet')).toBe(true)
    expect(isValidNetwork('foo')).toBe(false)
  })
})

describe('tema (Light default, Dark persistido)', () => {
  test('novo usuário começa no tema claro', () => {
    // Nenhum valor salvo: o tema padrão é claro.
    expect(dataset.theme).toBe('light')
  })

  test('seleção de Dark é persistida e respeitada', () => {
    setTheme('dark')
    expect(dataset.theme).toBe('dark')
    expect(store.get('gbos:theme')).toBe('dark')
    setTheme('light')
    expect(dataset.theme).toBe('light')
    expect(store.get('gbos:theme')).toBe('light')
  })
})
