import { AppKit } from '@circle-fin/app-kit'
import { useQuery } from '@tanstack/react-query'
import { isAddress, type Address } from 'viem'
import { Amount } from '@/onchain-money'
import { t } from './i18n'
import { USDC_DECIMALS } from '@/onchain-facts'
import {
  arc,
  arbitrum,
  avalanche,
  base,
  mainnet,
  optimism,
  polygon,
} from 'viem/chains'
import { useNetwork, type NetworkId } from './network'

export const appKit = new AppKit()

export type GatewayChainId =
  | typeof arc.id
  | typeof mainnet.id
  | typeof base.id
  | typeof arbitrum.id
  | typeof optimism.id
  | typeof avalanche.id
  | typeof polygon.id

export interface GatewayChain {
  /** Identificador usado pelo SDK da Circle. */
  key:
    | 'Arc'
    | 'Ethereum'
    | 'Base'
    | 'Arbitrum'
    | 'Optimism'
    | 'Avalanche'
    | 'Polygon'
  chainId: GatewayChainId
  label: string
  /** `live` = rede real (Mainnet). */
  env: 'live'
}

/**
 * Redes oficialmente suportadas pelo Circle Gateway (enum `UnifiedBalanceChain` do SDK instalado).
 * Exclusivamente Mainnet. Arc é a rede principal e aparece primeiro. Endereços/tokens vêm de
 * `onchain-facts`/viem — nada é inventado. Redes Testnet foram removidas da configuração operacional.
 */
export const GATEWAY_CHAINS: GatewayChain[] = [
  // Mainnet (env 'live')
  { key: 'Arc', chainId: arc.id, label: 'Arc Mainnet', env: 'live' },
  { key: 'Ethereum', chainId: mainnet.id, label: 'Ethereum', env: 'live' },
  { key: 'Base', chainId: base.id, label: 'Base', env: 'live' },
  { key: 'Arbitrum', chainId: arbitrum.id, label: 'Arbitrum One', env: 'live' },
  { key: 'Optimism', chainId: optimism.id, label: 'OP Mainnet', env: 'live' },
  { key: 'Avalanche', chainId: avalanche.id, label: 'Avalanche', env: 'live' },
  { key: 'Polygon', chainId: polygon.id, label: 'Polygon PoS', env: 'live' },
]

export const chainByKey = (key: string): GatewayChain | undefined => GATEWAY_CHAINS.find((c) => c.key === key)

/** Redes válidas para o ambiente ativo: Mainnet só 'live', Testnet só 'test' (isolamento estrito). */
export const gatewayChainsFor = (_network: NetworkId): GatewayChain[] => GATEWAY_CHAINS

export interface GatewayBalances {
  /** Saldo confirmado (disponível para novas operações). */
  total: number
  /** Depósitos ainda em confirmação. null quando a consulta de pendentes não está disponível. */
  pending: number | null
  byChain: { key: string; label: string; amount: number; exact: Amount }[]
}

function toAmount(value: string): Amount {
  try {
    return Amount.parse(value, USDC_DECIMALS)
  } catch {
    return Amount.zero(USDC_DECIMALS)
  }
}

export function useGatewayBalances(address: Address | undefined) {
  const network = useNetwork()
  const networkType = network === 'mainnet' ? 'mainnet' : 'testnet'
  return useQuery<GatewayBalances>({
    queryKey: ['gateway-balances', address, networkType],
    enabled: Boolean(address),
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!address) return { total: 0, pending: 0, byChain: [] }
      let pending: number | null = null
      let res: Awaited<ReturnType<typeof appKit.unifiedBalance.getBalances>>
      try {
        res = await appKit.unifiedBalance.getBalances({ sources: { address }, networkType, includePending: true })
        pending = Number(toAmount(String((res as { totalPendingBalance?: string }).totalPendingBalance ?? '0')).toString())
      } catch {
        // Se a consulta de pendentes falhar, mantém o saldo confirmado e marca pendentes como indisponível.
        res = await appKit.unifiedBalance.getBalances({ sources: { address }, networkType })
      }
      const map = new Map<string, Amount>()
      for (const account of res.breakdown) {
        for (const row of account.breakdown) {
          const key = String(row.chain)
          map.set(key, (map.get(key) ?? Amount.zero(USDC_DECIMALS)).add(toAmount(String(row.confirmedBalance))))
        }
      }
      const byChain = [...map.entries()]
        .map(([key, exact]) => ({ key, label: chainByKey(key)?.label ?? key.replace(/_/g, ' '), amount: Number(exact.toString()), exact }))
        .sort((a, b) => b.amount - a.amount)
      return { total: Number(toAmount(String(res.totalConfirmedBalance)).toString()), pending, byChain }
    },
  })
}

export function isValidAddress(value: string): value is Address {
  return isAddress(value)
}

export function explainError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const low = msg.toLowerCase()
  if (low.includes('user rejected') || low.includes('rejected the request') || low.includes('denied')) return t('Operação cancelada na carteira.', 'Operation cancelled in the wallet.')
  if (low.includes('insufficient')) return t('Saldo insuficiente para concluir a operação.', 'Insufficient balance to complete the operation.')
  if (low.includes('network') || low.includes('timeout') || low.includes('fetch')) return t('Falha de rede. Verifique a conexão e tente novamente.', 'Network error. Check your connection and try again.')
  return msg.length > 160 ? `${msg.slice(0, 160)}...` : msg
}
