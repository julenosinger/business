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

/**
 * Gate de prontidão de Mainnet (Seção 6/7 da fase 2.3).
 *
 * Enquanto `MAINNET_READY` for `false`, a execução financeira em Mainnet fica BLOQUEADA:
 * nenhum depósito/pagamento real é iniciado e nenhum saldo real é consultado. Isso é uma
 * decisão de segurança, não uma configuração do usuário: só pode ser liberada após validar
 * contratos oficiais, credenciais, backend e verificação. Testnet permanece inalterado.
 */
export const MAINNET_READY = false

export const isMainnetBlocked = (network: NetworkId = current): boolean => network === 'mainnet' && !MAINNET_READY

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
