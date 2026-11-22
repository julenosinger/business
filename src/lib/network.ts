/**
 * Rede ativa do app (Arc Mainnet / Arc Testnet).
 *
 * - Default: **Mainnet** (chain id 5042) para novos usuários.
 * - A preferência é persistida (`gbos:network`) e validada na leitura: qualquer valor desconhecido
 *   volta para Mainnet (nunca confia em valor corrompido).
 * - A troca é sempre uma ação explícita do usuário; o app NUNCA troca de rede silenciosamente.
 * - Mainnet e Testnet são ambientes distintos: saldos e transações nunca se misturam.
 */
import { useSyncExternalStore } from 'react'

export type NetworkId = 'mainnet' | 'testnet'

const KEY = 'gbos:network'
const listeners = new Set<() => void>()

/** Chain IDs vêm do registro `onchain-facts` (fonte autoritativa); aqui apenas como referência explícita. */
export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_TESTNET_CHAIN_ID = 5042002

export interface NetworkInfo {
  id: NetworkId
  chainId: number
  label: string
  /** Distinção visual/segurança: `live` = rede real, `test` = ambiente de teste. */
  env: 'live' | 'test'
  short: string
}

export const NETWORKS: Record<NetworkId, NetworkInfo> = {
  mainnet: { id: 'mainnet', chainId: ARC_MAINNET_CHAIN_ID, label: 'Arc Mainnet', env: 'live', short: 'Mainnet' },
  testnet: { id: 'testnet', chainId: ARC_TESTNET_CHAIN_ID, label: 'Arc Testnet', env: 'test', short: 'Testnet' },
}

export const isValidNetwork = (v: unknown): v is NetworkId => v === 'mainnet' || v === 'testnet'

function read(): NetworkId {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'testnet' ? 'testnet' : 'mainnet'
  } catch {
    return 'mainnet'
  }
}

let current: NetworkId = read()

export const getNetwork = (): NetworkId => current
export const networkInfo = (id: NetworkId = current): NetworkInfo => NETWORKS[id]
export const arcChainIdOf = (id: NetworkId = current): number => NETWORKS[id].chainId

/** Chave da rede Arc no Circle Gateway (`Arc` = Mainnet, `Arc_Testnet` = Testnet). */
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

/** Troca a rede (ação explícita). Persiste e notifica assinantes. */
export function setNetwork(id: NetworkId): void {
  if (!isValidNetwork(id) || id === current) return
  current = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
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
