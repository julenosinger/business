/**
 * Reconciliação de liquidação (fases 2.5 → 2.6).
 *
 * Separa a SUBMISSÃO (resposta do SDK do Gateway) da LIQUIDAÇÃO (verificação independente on-chain),
 * e distingue a verificação por tipo de operação:
 *
 * - `spend` (pagamento): o `txHash` do SDK é a transação de MINT na cadeia de DESTINO (a entrega
 *   final). Verificamos o recibo na cadeia de destino, esperando o destinatário e o valor exatos.
 *   Um Transfer na cadeia de origem NUNCA prova a entrega no destino.
 * - `deposit`: o `txHash` é o depósito na cadeia de ORIGEM. Verificamos o recibo na origem, esperando
 *   o remetente (carteira) e o valor exatos.
 *
 * Nunca retorna `confirmed` sem evidência. Não importa a SDK da Circle (apenas viem + fatos on-chain).
 */
import { formatDecimal, parseMinor } from './accounting/money'
import { convertForReporting } from './accounting/reviews'
import { classifyVerification, type TreasuryOpStatus } from './accounting/settlement'
import { verifyUsdcReceipt, type Verification } from './accounting/verify'
import { gatewayChainIdOf } from './network'
import { getChain, getProtocolContractByName } from '../onchain-facts'
import type { LedgerState } from './accounting/types'
import type { CurrencyCode, TreasuryOp } from './types'

export interface ReconcileOutcome {
  status: TreasuryOpStatus
  verification: Verification
}

/** Endereço do contrato GatewayWallet (destino do depósito) para uma chain, pela rede (testnet/mainnet). */
export function gatewayWalletForChain(chainId: number): string | undefined {
  const chain = getChain(chainId)
  if (!chain) return undefined
  try {
    return getProtocolContractByName('GatewayWallet', chain.isTestnet ? 'testnet' : 'mainnet')?.address
  } catch {
    return undefined
  }
}

function inconclusive(verification: Verification): ReconcileOutcome {
  return { status: 'requires_review', verification }
}

/** Verifica a liquidação de uma operação de tesouraria (prova na cadeia correta por tipo de operação). */
export async function reconcileTreasuryOp(op: TreasuryOp): Promise<ReconcileOutcome> {
  if (!op.txHash) {
    return inconclusive({ state: 'ambiguous', chainId: 0, txHash: '', reason: 'no_evidence' })
  }
  const amountMinor = parseMinor(op.amount.trim(), 'USDC')
  if (amountMinor === null || amountMinor <= 0n) {
    return inconclusive({ state: 'ambiguous', chainId: 0, txHash: op.txHash, reason: 'invalid_amount' })
  }
  // spend: o hash é o mint no DESTINO; deposit: o hash é o depósito na ORIGEM.
  const verifyChainKey = op.kind === 'spend' ? (op.destChain ?? op.chain) : op.chain
  const chainId = gatewayChainIdOf(verifyChainKey)
  if (chainId === undefined) {
    return inconclusive({ state: 'ambiguous', chainId: 0, txHash: op.txHash, reason: 'unknown_chain' })
  }
  if (op.kind === 'spend') {
    const verification = await verifyUsdcReceipt({ chainId, txHash: op.txHash, expectedTo: op.recipient, expectedAmountMinor: amountMinor })
    return { status: classifyVerification(verification.state), verification }
  }
  // Depósito: prova que USDC saiu da carteira E foi para o contrato GatewayWallet (crédito no saldo unificado).
  const gatewayWallet = gatewayWalletForChain(chainId)
  if (!gatewayWallet) {
    return inconclusive({ state: 'ambiguous', chainId, txHash: op.txHash, reason: 'gateway_wallet_unknown' })
  }
  const verification = await verifyUsdcReceipt({ chainId, txHash: op.txHash, expectedFrom: op.wallet, expectedTo: gatewayWallet, expectedAmountMinor: amountMinor })
  return { status: classifyVerification(verification.state), verification }
}

export type AllocationResult = { ok: true; amount: number } | { ok: false; reason: 'fx_required' | 'invalid_amount' | 'unknown_currency' }

/**
 * Converte o valor USDC verificado em unidades menores para a moeda da conta.
 * - Moeda USDC: 1:1 (exato).
 * - Moeda BRL/USD/EUR: exige taxa de câmbio REGISTRADA (fonte + data) no razão. Sem ela → `fx_required`.
 * - Moeda desconhecida (registro legado) → `unknown_currency` (nunca adivinhar; exige resolução do dono).
 */
export function allocationAmount(ledger: LedgerState, currency: CurrencyCode | undefined, usdcAmount: string, date: string): AllocationResult {
  const minor = parseMinor(usdcAmount.trim(), 'USDC')
  if (minor === null || minor <= 0n) return { ok: false, reason: 'invalid_amount' }
  if (!currency) return { ok: false, reason: 'unknown_currency' }
  if (currency === 'USDC') return { ok: true, amount: Number(formatDecimal(minor, 'USDC')) }
  const conv = convertForReporting(ledger, minor, 'USDC', currency, date)
  if (!conv) return { ok: false, reason: 'fx_required' }
  return { ok: true, amount: Number(formatDecimal(conv.amountMinor, currency)) }
}
