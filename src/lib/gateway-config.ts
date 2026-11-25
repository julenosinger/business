/**
 * Configuração centralizada do Circle Gateway por ambiente (fase FIN-04.1B.2).
 *
 * Fonte única dos contratos e endpoints oficiais, resolvidos por AMBIENTE (mainnet/testnet) e Chain ID.
 * O `cctpDomain` 26 é COMPARTILHADO pelas duas redes Arc — portanto o domínio nunca é usado como
 * identificador de ambiente; toda resolução exige `NetworkId` + `chainId` explícitos.
 *
 * Os endereços vêm do registro on-chain (`onchain-facts`), gerado pelo Arc Studio — nada é inventado.
 */
import { encodeFunctionData, isAddress, type Address } from 'viem'
import { getChain, getProtocolContractByName, getUsdc } from '@/onchain-facts'
import type { NetworkId } from './network'

const ZERO = '0x0000000000000000000000000000000000000000'

/** Endereço válido e não-zero. */
const isValidNonZeroAddress = (x: string | undefined): x is Address => !!x && isAddress(x) && x.toLowerCase() !== ZERO

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

/** Resolve a configuração oficial do Gateway para o ambiente indicado. Rejeita ambiente desconhecido (runtime). */
export function gatewayConfigFor(network: NetworkId): GatewayConfig {
  if (network !== 'mainnet' && network !== 'testnet') throw new Error(`Unknown environment: ${String(network)}`)
  const chainId = network === 'mainnet' ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID
  const chain = getChain(chainId)
  if (!chain) throw new Error(`Unknown Arc chain id ${chainId}`)
  const gatewayWallet = getProtocolContractByName('GatewayWallet', network === 'mainnet' ? 'mainnet' : 'testnet')?.address
  const gatewayMinter = getProtocolContractByName('GatewayMinter', network === 'mainnet' ? 'mainnet' : 'testnet')?.address
  if (!isValidNonZeroAddress(gatewayWallet)) throw new Error(`GatewayWallet not registered for ${network}`)
  if (!isValidNonZeroAddress(gatewayMinter)) throw new Error(`GatewayMinter not registered for ${network}`)
  const usdc = getUsdc(chainId)?.address ?? ARC_USDC
  if (!isValidNonZeroAddress(usdc)) throw new Error(`USDC token not registered for ${network}`)
  return {
    network,
    chainId,
    cctpDomain: chain.cctpDomain ?? 0,
    gatewayWallet: gatewayWallet,
    gatewayMinter: gatewayMinter,
    usdcToken: usdc,
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

/**
 * Beneficiário institucional para o ambiente — resolução EXCLUSIVAMENTE por ambiente.
 * Sem configuração, retorna string vazia (não configurado). Nunca usa fallback legado, carteira
 * conectada ou outro ambiente.
 */
export function treasuryRecipientFor(
  settings: { treasuryRecipients?: Partial<Record<NetworkId, string>> },
  network: NetworkId,
): string {
  if (network !== 'mainnet' && network !== 'testnet') throw new Error(`Unknown environment: ${String(network)}`)
  return (settings.treasuryRecipients?.[network] ?? '').trim()
}

export type BeneficiaryReason = 'invalid_address' | 'gateway_contract' | 'unknown_environment'
export type BeneficiaryValidation = { ok: true; value: Address } | { ok: false; reason: BeneficiaryReason }

/**
 * Valida um endereço candidato a beneficiário institucional: deve ser válido, não-zero e NÃO ser
 * um contrato de infraestrutura do Gateway (GatewayWallet/GatewayMinter/USDC). Não comprova controle
 * institucional — apenas formato e compatibilidade funcional.
 */
export function validateBeneficiary(address: string, network: NetworkId): BeneficiaryValidation {
  if (network !== 'mainnet' && network !== 'testnet') return { ok: false, reason: 'unknown_environment' }
  if (!isValidNonZeroAddress(address)) return { ok: false, reason: 'invalid_address' }
  const cfg = gatewayConfigFor(network)
  const lower = address.toLowerCase()
  if (lower === cfg.gatewayWallet.toLowerCase() || lower === cfg.gatewayMinter.toLowerCase() || lower === cfg.usdcToken.toLowerCase()) {
    return { ok: false, reason: 'gateway_contract' }
  }
  return { ok: true, value: address }
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
  if (!isValidNonZeroAddress(token)) throw new Error('depositFor: invalid token address')
  if (!isValidNonZeroAddress(depositor)) throw new Error('depositFor: invalid depositor address')
  if (typeof value !== 'bigint' || value <= 0n || value > (1n << 256n) - 1n) throw new Error('depositFor: invalid value')
  return encodeFunctionData({ abi: DEPOSIT_FOR_ABI, functionName: 'depositFor', args: [token, depositor, value] })
}
