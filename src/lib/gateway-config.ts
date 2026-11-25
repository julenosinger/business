/**
 * Configuração centralizada do Circle Gateway por ambiente (fase FIN-04.1B.2).
 *
 * Fonte única dos contratos e endpoints oficiais, resolvidos por AMBIENTE (mainnet/testnet) e Chain ID.
 * O `cctpDomain` 26 é COMPARTILHADO pelas duas redes Arc — portanto o domínio nunca é usado como
 * identificador de ambiente; toda resolução exige `NetworkId` + `chainId` explícitos.
 *
 * Os endereços vêm do registro on-chain (`onchain-facts`), gerado pelo Arc Studio — nada é inventado.
 */
import { encodeFunctionData, type Address } from 'viem'
import { getChain, getProtocolContractByName, getUsdc } from '@/onchain-facts'
import type { NetworkId } from './network'

export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_TESTNET_CHAIN_ID = 5042002

/** USDC ERC-20 na Arc (6 decimais) — distinto do USDC nativo usado para gas (18 decimais). */
export const ARC_USDC = '0x3600000000000000000000000000000000000000' as const

export interface GatewayConfig {
  network: NetworkId
  chainId: number
  /** Domínio CCTP/Gateway (26 em ambas as redes Arc). */
  cctpDomain: number
  gatewayWallet: Address
  gatewayMinter: Address
  usdcToken: Address
  apiBase: string
  explorerBase: string
}

/** Resolve a configuração oficial do Gateway para o ambiente indicado (rejeita rede desconhecida). */
export function gatewayConfigFor(network: NetworkId): GatewayConfig {
  const chainId = network === 'mainnet' ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID
  const chain = getChain(chainId)
  if (!chain) throw new Error(`Unknown Arc chain id ${chainId}`)
  const gatewayWallet = getProtocolContractByName('GatewayWallet', network === 'mainnet' ? 'mainnet' : 'testnet')?.address
  const gatewayMinter = getProtocolContractByName('GatewayMinter', network === 'mainnet' ? 'mainnet' : 'testnet')?.address
  if (!gatewayWallet || !gatewayMinter) throw new Error(`Gateway contracts not registered for ${network}`)
  return {
    network,
    chainId,
    cctpDomain: chain.cctpDomain ?? 0,
    gatewayWallet: gatewayWallet as Address,
    gatewayMinter: gatewayMinter as Address,
    usdcToken: (getUsdc(chainId)?.address ?? ARC_USDC) as Address,
    apiBase: network === 'mainnet' ? 'https://gateway-api.circle.com/v1/' : 'https://gateway-api-testnet.circle.com/v1/',
    explorerBase: chain.explorerBase,
  }
}

/**
 * Resolve o GatewayWallet SOMENTE quando o `chainId` corresponde ao ambiente esperado.
 * Retorna `null` para qualquer chainId de outro ambiente (isolamento estrito).
 */
export function gatewayWalletForChain(chainId: number, network: NetworkId): Address | null {
  const cfg = gatewayConfigFor(network)
  return chainId === cfg.chainId ? cfg.gatewayWallet : null
}

/** Assinatura oficial de `depositFor(address token, address depositor, uint256 value)` no GatewayWallet. */
export const DEPOSIT_FOR_ABI = [
  {
    type: 'function',
    name: 'depositFor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

/** Codifica a chamada `depositFor(token, depositor, value)` para envio ao GatewayWallet. */
export function encodeDepositFor(token: Address, depositor: Address, value: bigint): `0x${string}` {
  return encodeFunctionData({ abi: DEPOSIT_FOR_ABI, functionName: 'depositFor', args: [token, depositor, value] })
}
