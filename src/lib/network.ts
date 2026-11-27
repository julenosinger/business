/**
 * Rede ativa do app — Arc Mainnet (exclusiva).
 *
 * O ERP opera exclusivamente em Mainnet. `NetworkId` mantém o valor `'testnet'` apenas para
 * CLASSIFICAÇÃO de dados históricos e testes de rejeição/migração — nunca como ambiente ativo.
 * A preferência persistida de Testnet é ignorada; o app inicia e permanece em Mainnet.
 */
import { useSyncExternalStore } from 'react'

export type NetworkId = 'mainnet' | 'testnet'

const listeners = new Set<() => void>()

/** Chain IDs vêm do registro `onchain-facts` (fonte autoritativa); aqui apenas como referência explícita. */
export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_TESTNET_CHAIN_ID = 5042002

export interface NetworkInfo {
  id: NetworkId
  chainId: number
  label: string
  /** Distinção visual/segurança: `live` = rede real, `test` = ambiente de teste (descontinuado). */
  env: 'live' | 'test'
  short: string
}

export const NETWORKS: Record<NetworkId, NetworkInfo> = {
  mainnet: { id: 'mainnet', chainId: ARC_MAINNET_CHAIN_ID, label: 'Arc Mainnet', env: 'live', short: 'Mainnet' },
  testnet: { id: 'testnet', chainId: ARC_TESTNET_CHAIN_ID, label: 'Arc Testnet', env: 'test', short: 'Testnet' },
}

export const isValidNetwork = (v: unknown): v is NetworkId => v === 'mainnet' || v === 'testnet'

// Mainnet-only: o app SEMPRE inicia em Arc Mainnet, ignorando qualquer preferência antiga de Testnet.
function read(): NetworkId {
  return 'mainnet'
}

let current: NetworkId = read()

export const getNetwork = (): NetworkId => current
export const networkInfo = (id: NetworkId = current): NetworkInfo => NETWORKS[id]
export const arcChainIdOf = (id: NetworkId = current): number => NETWORKS[id].chainId

/** Chave da rede Arc no Circle Gateway (`Arc` = Mainnet, `Arc_Testnet` = Testnet descontinuada). */
export const ARC_GATEWAY_KEYS: Record<NetworkId, 'Arc' | 'Arc_Testnet'> = { mainnet: 'Arc', testnet: 'Arc_Testnet' }
export const arcGatewayKeyOf = (id: NetworkId = current): 'Arc' | 'Arc_Testnet' => ARC_GATEWAY_KEYS[id]

/** Chain ID por chave de rede do Gateway (valores estáveis do registro on-chain). */
const GATEWAY_KEY_CHAIN_IDS: Record<string, number> = {
  Arc: 5042,
  Ethereum: 1,
  Base: 8453,
  Arbitrum: 42161,
  Optimism: 10,
  Avalanche: 43114,
  Polygon: 137,
  Arc_Testnet: 5042002,
  Base_Sepolia: 84532,
  Ethereum_Sepolia: 11155111,
  Arbitrum_Sepolia: 421614,
  Optimism_Sepolia: 11155420,
  Avalanche_Fuji: 43113,
  Polygon_Amoy_Testnet: 80002,
}

export const gatewayChainIdOf = (key: string): number | undefined => GATEWAY_KEY_CHAIN_IDS[key]

/** Ambiente de uma chave de rede do Gateway (persistida nas operações). `undefined` = legado/desconhecido. */
const GATEWAY_KEY_ENVS: Record<string, 'live' | 'test'> = {
  Arc: 'live',
  Ethereum: 'live',
  Base: 'live',
  Arbitrum: 'live',
  Optimism: 'live',
  Avalanche: 'live',
  Polygon: 'live',
  // Redes adicionais do enum oficial do SDK, reconhecidas para CLASSIFICAÇÃO de histórico
  // (não habilitam depósito/envio/mint automaticamente).
  Sei: 'live',
  Sonic: 'live',
  HyperEVM: 'live',
  Unichain: 'live',
  World_Chain: 'live',
  Arc_Testnet: 'test',
  Base_Sepolia: 'test',
  Ethereum_Sepolia: 'test',
  Arbitrum_Sepolia: 'test',
  Optimism_Sepolia: 'test',
  Avalanche_Fuji: 'test',
  Polygon_Amoy_Testnet: 'test',
  Sei_Testnet: 'test',
  Sonic_Testnet: 'test',
  HyperEVM_Testnet: 'test',
  Unichain_Sepolia: 'test',
  World_Chain_Sepolia: 'test',
}

export const gatewayChainEnv = (key: string): 'live' | 'test' | undefined => GATEWAY_KEY_ENVS[key]

/**
 * Mainnet-only: a rede ativa é IMUTÁVEL (Arc Mainnet). Nenhuma função, preferência persistida,
 * localStorage, cookie, parâmetro de URL, chamada à API, estado React ou conexão de carteira pode
 * alterar o ambiente operacional. `NetworkId` mantém `'testnet'` apenas como valor de CLASSIFICAÇÃO
 * de registros históricos (campo `environment`), nunca como ambiente ativo.
 */
export function setNetwork(_id: NetworkId): void {
  // Sem efeito: o ambiente operacional é exclusivamente Arc Mainnet.
}

export function useNetwork(): NetworkId {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
