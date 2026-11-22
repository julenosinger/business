/**
 * Máquina de estados de pagamento/liquidação (fase 2.5).
 *
 * Ciclo correto de um pagamento USDC:
 *   created → awaiting_signature → submitted → pending → confirmed
 * com os desvios `failed`, `ambiguous` e `requires_review`.
 *
 * Regras de segurança:
 * - `pending`/`ambiguous` NUNCA viram `confirmed` sem verificação explícita.
 * - Um timeout/falha de rede NÃO vira `failed` sozinho (vira `ambiguous`/`requires_review`).
 * - `confirmed` e `failed` são terminais; um broadcast ambíguo NUNCA é reenviado automaticamente.
 */
import type { SettlementState } from './verify'

export type PaymentStatus = 'created' | 'awaiting_signature' | 'submitted' | 'pending' | 'confirmed' | 'failed' | 'ambiguous' | 'requires_review'

/** Status persistido em `TreasuryOp.status` (subconjunto dos estados relevantes pós-submissão). */
export type TreasuryOpStatus = 'pending' | 'confirmed' | 'failed' | 'ambiguous' | 'requires_review'

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  created: ['awaiting_signature'],
  awaiting_signature: ['submitted', 'failed'],
  submitted: ['pending', 'ambiguous', 'failed'],
  pending: ['confirmed', 'failed', 'ambiguous', 'requires_review'],
  ambiguous: ['requires_review', 'pending'],
  requires_review: ['confirmed', 'failed', 'ambiguous'],
  confirmed: [],
  failed: [],
}

export const PAYMENT_STATUSES = Object.keys(TRANSITIONS) as PaymentStatus[]

export const isTerminalStatus = (s: PaymentStatus): boolean => s === 'confirmed' || s === 'failed'

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** Classifica o resultado da verificação on-chain em um status persistível de liquidação. */
export function classifyVerification(state: SettlementState): TreasuryOpStatus {
  switch (state) {
    case 'confirmed':
      return 'confirmed'
    case 'failed':
      return 'failed'
    case 'ambiguous':
      return 'requires_review'
    case 'pending':
      return 'pending'
  }
}
