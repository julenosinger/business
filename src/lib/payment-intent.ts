/**
 * Máquina de estados protegida das intenções de pagamento (FIN-04.1B.2.2A).
 *
 * Transições explícitas e auditáveis. Estados terminais não são revertidos arbitrariamente;
 * a repetição do mesmo estado é idempotente. A confirmação on-chain NUNCA é alcançada por
 * transição direta a partir de CREATED — exige o caminho completo (aprovado → assinado → submetido).
 */
import type { PaymentIntentState } from './types'

export const PAYMENT_INTENT_TRANSITIONS: Record<PaymentIntentState, PaymentIntentState[]> = {
  CREATED: ['AWAITING_WALLET', 'EXPIRED', 'CANCELED', 'REQUIRES_REVIEW'],
  AWAITING_WALLET: ['AWAITING_APPROVAL', 'EXPIRED', 'CANCELED', 'REQUIRES_REVIEW'],
  AWAITING_APPROVAL: ['APPROVAL_PENDING', 'READY_TO_DEPOSIT', 'EXPIRED', 'CANCELED', 'REQUIRES_REVIEW'],
  APPROVAL_PENDING: ['READY_TO_DEPOSIT', 'EXPIRED', 'FAILED', 'CANCELED', 'REQUIRES_REVIEW'],
  READY_TO_DEPOSIT: ['AWAITING_SIGNATURE', 'EXPIRED', 'CANCELED', 'REQUIRES_REVIEW'],
  AWAITING_SIGNATURE: ['SUBMITTED', 'EXPIRED', 'FAILED', 'CANCELED', 'REQUIRES_REVIEW'],
  SUBMITTED: ['ONCHAIN_CONFIRMED', 'FAILED', 'REQUIRES_REVIEW'],
  ONCHAIN_CONFIRMED: ['AWAITING_GATEWAY_VERIFICATION', 'REQUIRES_REVIEW'],
  AWAITING_GATEWAY_VERIFICATION: ['REQUIRES_REVIEW'],
  // Estados terminais: só permitem repetição idempotente (from === to).
  EXPIRED: [],
  FAILED: [],
  CANCELED: [],
  // Revisão pode ser resolvida para falha/cancelamento ou permanecer em revisão.
  REQUIRES_REVIEW: ['FAILED', 'CANCELED'],
}

export const TERMINAL_INTENT_STATES: PaymentIntentState[] = ['EXPIRED', 'FAILED', 'CANCELED']

/** `from === to` é idempotente; demais transições seguem o grafo explícito. */
export function canTransitionIntent(from: PaymentIntentState, to: PaymentIntentState): boolean {
  if (from === to) return true
  return (PAYMENT_INTENT_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Estados que exigem evidência técnica autorizada (hash) para serem alcançados.
 * A interface não pode simplesmente marcar estes estados sem o caminho do verificador.
 */
export const INTENT_STATES_REQUIRING_TX = new Set<PaymentIntentState>(['SUBMITTED', 'ONCHAIN_CONFIRMED'])
