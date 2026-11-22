/**
 * Reconciliação de liquidação (fase 2.5).
 *
 * Separa a SUBMISSÃO (resposta do SDK do Gateway) da LIQUIDAÇÃO (verificação independente on-chain).
 * Uma operação só vira `confirmed` depois que `verifyUsdcReceipt` confirma o recibo e a transferência
 * esperada (rede, token, destinatário e valor). Nunca retorna `confirmed` sem evidência.
 *
 * Não importa a SDK da Circle nem o Gateway (apenas viem + fatos on-chain + o módulo de verificação).
 */
import { parseMinor } from './accounting/money'
import { classifyVerification, type TreasuryOpStatus } from './accounting/settlement'
import { verifyUsdcReceipt, type Verification } from './accounting/verify'
import { gatewayChainIdOf } from './network'
import type { TreasuryOp } from './types'

export interface ReconcileOutcome {
  status: TreasuryOpStatus
  verification: Verification
}

function inconclusive(verification: Verification): ReconcileOutcome {
  return { status: 'requires_review', verification }
}

/** Verifica a liquidação de uma operação de tesouraria. Puro em relação ao estado; só faz a leitura on-chain. */
export async function reconcileTreasuryOp(op: TreasuryOp): Promise<ReconcileOutcome> {
  if (!op.txHash) {
    return inconclusive({ state: 'ambiguous', chainId: 0, txHash: '', reason: 'no_evidence' })
  }
  const chainId = gatewayChainIdOf(op.chain)
  if (chainId === undefined) {
    return inconclusive({ state: 'ambiguous', chainId: 0, txHash: op.txHash, reason: 'unknown_chain' })
  }
  const amountMinor = parseMinor(op.amount.trim(), 'USDC')
  if (amountMinor === null || amountMinor <= 0n) {
    return inconclusive({ state: 'ambiguous', chainId, txHash: op.txHash, reason: 'invalid_amount' })
  }
  const verification = await verifyUsdcReceipt({ chainId, txHash: op.txHash, expectedTo: op.recipient, expectedAmountMinor: amountMinor })
  return { status: classifyVerification(verification.state), verification }
}
