import { AppKit } from '@circle-fin/app-kit'
import { useQuery } from '@tanstack/react-query'
import { isAddress, type Address } from 'viem'
import { Amount } from '@/onchain-money'
import { t } from './i18n'
import { USDC_DECIMALS } from '@/onchain-facts'
import { arcTestnet, arbitrumSepolia, avalancheFuji, baseSepolia, optimismSepolia, polygonAmoy, sepolia } from 'viem/chains'

export const appKit = new AppKit()

export type GatewayChainId =
  | typeof arcTestnet.id
  | typeof baseSepolia.id
  | typeof sepolia.id
  | typeof arbitrumSepolia.id
  | typeof optimismSepolia.id
  | typeof avalancheFuji.id
  | typeof polygonAmoy.id

export interface GatewayChain {
  /** Identificador usado pelo SDK da Circle. */
  key: 'Arc_Testnet' | 'Base_Sepolia' | 'Ethereum_Sepolia' | 'Arbitrum_Sepolia' | 'Optimism_Sepolia' | 'Avalanche_Fuji' | 'Polygon_Amoy_Testnet'
  chainId: GatewayChainId
  label: string
}

export const GATEWAY_CHAINS: GatewayChain[] = [
  { key: 'Arc_Testnet', chainId: arcTestnet.id, label: 'Arc Testnet' },
  { key: 'Base_Sepolia', chainId: baseSepolia.id, label: 'Base Sepolia' },
  { key: 'Ethereum_Sepolia', chainId: sepolia.id, label: 'Ethereum Sepolia' },
  { key: 'Arbitrum_Sepolia', chainId: arbitrumSepolia.id, label: 'Arbitrum Sepolia' },
  { key: 'Optimism_Sepolia', chainId: optimismSepolia.id, label: 'OP Sepolia' },
  { key: 'Avalanche_Fuji', chainId: avalancheFuji.id, label: 'Avalanche Fuji' },
  { key: 'Polygon_Amoy_Testnet', chainId: polygonAmoy.id, label: 'Polygon Amoy' },
]

export const chainByKey = (key: string): GatewayChain | undefined => GATEWAY_CHAINS.find((c) => c.key === key)

export interface GatewayBalances {
  total: number
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
  return useQuery<GatewayBalances>({
    queryKey: ['gateway-balances', address],
    enabled: Boolean(address),
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!address) return { total: 0, byChain: [] }
      const res = await appKit.unifiedBalance.getBalances({ sources: { address }, networkType: 'testnet' })
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
      return { total: Number(toAmount(String(res.totalConfirmedBalance)).toString()), byChain }
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
