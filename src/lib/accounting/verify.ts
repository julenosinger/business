/**
 * Verificação de liquidação on-chain (fase 2.2).
 *
 * Um hash de transação ou uma nota humana NÃO são prova de liquidação. Este módulo fornece a verificação
 * real de um recibo na rede: valida o chain id e o hash, lê o recibo por infraestrutura confiável (RPC
 * registrada em `onchain-facts`), confirma o sucesso e decodifica as transferências de USDC (evento
 * `Transfer`) para conferir token, endereços e valor.
 *
 * Estados possíveis: `confirmed` (recibo com sucesso e, se solicitado, transferência correspondente),
 * `failed` (recibo revertido), `pending` (recibo ainda não encontrado ou sem transferência correspondente)
 * e `ambiguous` (erro de rede/entrada inválida — NUNCA tratado como confirmado).
 *
 * Uso: integrado à conciliação da tesouraria (flag `treasury`). Não importa a SDK da Circle nem o Gateway;
 * apenas viem + fatos on-chain registrados.
 */
import { createPublicClient, decodeEventLog, http, parseAbi, type Address, type Hex } from 'viem'
import { getChain, getUsdc } from '../../onchain-facts'

const TRANSFER_EVENT = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])

export type SettlementState = 'confirmed' | 'failed' | 'pending' | 'ambiguous'

export interface UsdcTransfer {
  from: string
  to: string
  amountMinor: bigint
}

export interface Verification {
  state: SettlementState
  chainId: number
  txHash: string
  blockNumber?: bigint
  transfers?: UsdcTransfer[]
  reason?: string
}

/** Hash de transação EVM (0x + 64 hex). */
export const isHexHash = (v: string): v is Hex => /^0x[0-9a-fA-F]{64}$/.test(v)

export const isKnownChain = (chainId: number): boolean => getChain(chainId) !== undefined

/** Decodifica as transferências de USDC de um recibo (puro: testável sem rede). */
export function decodeUsdcTransfers(logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[], usdcAddress: string): UsdcTransfer[] {
  const out: UsdcTransfer[] = []
  for (const log of logs) {
    if (log.address.toLowerCase() !== usdcAddress.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_EVENT, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] })
      if (decoded.eventName !== 'Transfer') continue
      const args = decoded.args as { from?: Address; to?: Address; value?: bigint }
      if (args.from && args.to && typeof args.value === 'bigint') out.push({ from: args.from, to: args.to, amountMinor: args.value })
    } catch {
      // log não relacionado a Transfer: ignora.
    }
  }
  return out
}

/** Alguma transferência bate com o destinatário/valor esperado? */
export function matchTransfer(transfers: readonly UsdcTransfer[], expectedTo?: string, expectedAmountMinor?: bigint): UsdcTransfer | undefined {
  return transfers.find(
    (t) => (!expectedTo || t.to.toLowerCase() === expectedTo.toLowerCase()) && (expectedAmountMinor === undefined || t.amountMinor === expectedAmountMinor),
  )
}

/**
 * Verifica um recibo de transação USDC na rede.
 *
 * - `expectedTo`/`expectedAmountMinor` são opcionais; quando informados, a verificação só retorna
 *   `confirmed` se encontrar uma transferência de USDC correspondente no recibo.
 * - `pending` significa "ainda não há prova": NUNCA classifique como liquidado.
 */
export async function verifyUsdcReceipt(input: { chainId: number; txHash: string; expectedTo?: string; expectedAmountMinor?: bigint }): Promise<Verification> {
  const { chainId, txHash } = input
  if (!isKnownChain(chainId)) return { state: 'ambiguous', chainId, txHash, reason: 'unknown_chain' }
  if (!isHexHash(txHash)) return { state: 'ambiguous', chainId, txHash, reason: 'invalid_hash' }
  const chain = getChain(chainId)!
  const usdc = getUsdc(chainId)
  try {
    const client = createPublicClient({ transport: http(chain.rpcUrls[0]) })
    const receipt = await client.getTransactionReceipt({ hash: txHash })
    if (receipt.status === 'reverted') return { state: 'failed', chainId, txHash, blockNumber: receipt.blockNumber }
    const transfers = usdc ? decodeUsdcTransfers(receipt.logs, usdc.address) : []
    if (input.expectedTo || input.expectedAmountMinor !== undefined) {
      const hit = matchTransfer(transfers, input.expectedTo, input.expectedAmountMinor)
      if (!hit) return { state: 'pending', chainId, txHash, blockNumber: receipt.blockNumber, transfers, reason: 'no_matching_transfer' }
    }
    return { state: 'confirmed', chainId, txHash, blockNumber: receipt.blockNumber, transfers }
  } catch {
    // Falha de rede/RPC: ambiguidade, nunca confirmação.
    return { state: 'ambiguous', chainId, txHash, reason: 'fetch_error' }
  }
}
