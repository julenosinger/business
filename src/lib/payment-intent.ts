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

// -----------------------------------------------------------------------------------------------------------
// Precisão monetária exata (BigInt, sem float)
// -----------------------------------------------------------------------------------------------------------

export const UINT256_MAX = (1n << 256n) - 1n

/** Converte um decimal textual de USDC (até 6 casas) em unidades mínimas. Nunca usa float. */
export function parseUsdcMinor(value: string): bigint {
  const normalized = value.trim()
  if (normalized.length > 85) throw new Error('amount_too_large')
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) throw new Error('invalid_usdc_precision')
  const [whole, fraction = ''] = normalized.split('.')
  const minor = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  if (minor <= 0n || minor > UINT256_MAX) throw new Error('invalid_usdc_amount')
  return minor
}

/** Converte uma string de unidades mínimas (inteiro positivo ≤ uint256) em BigInt. */
export function parseMinorUnits(value: string): bigint {
  if (value.length > 78 || !/^\d+$/.test(value)) throw new Error('invalid_minor_units')
  const amount = BigInt(value)
  if (amount <= 0n || amount > UINT256_MAX) throw new Error('invalid_minor_units')
  return amount
}

/** Verifica a correspondência exata entre o decimal USDC e as unidades mínimas. */
export function validateUsdcAmount(decimal: string, minor: string): boolean {
  try {
    return parseUsdcMinor(decimal) === parseMinorUnits(minor)
  } catch {
    return false
  }
}

// -----------------------------------------------------------------------------------------------------------
// Validação de hash de transação
// -----------------------------------------------------------------------------------------------------------

export function isValidTxHash(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/i.test(value)
}

export function normalizeTxHash(value: string): string {
  if (!isValidTxHash(value)) throw new Error('invalid_tx_hash')
  return value.toLowerCase()
}

// -----------------------------------------------------------------------------------------------------------
// Idempotência segregada por organização/ambiente
// -----------------------------------------------------------------------------------------------------------

export interface IntentScope {
  organizationId: string
  environment: 'mainnet' | 'testnet'
}

export function scopedIdempotencyKey(scope: IntentScope, key: string): string {
  const normalized = key.trim()
  if (normalized.length === 0 || normalized.length > 128) throw new Error('invalid_idempotency_key')
  return JSON.stringify([scope.organizationId, scope.environment, normalized])
}

/** Fingerprint canônico dos parâmetros financeiros imutáveis de uma intenção. */
export function intentFingerprint(input: {
  organizationId: string
  environment: string
  accountId: string
  saleId?: string
  customerId?: string
  currency: string
  amountMinor: string
  usdcMinor: string
  rate?: string
  beneficiary: string
  gatewayWallet: string
  token: string
  chainId: number
  expiresAt: string
}): string {
  return JSON.stringify([
    input.organizationId,
    input.environment,
    input.accountId,
    input.saleId ?? null,
    input.customerId ?? null,
    input.currency,
    input.amountMinor,
    input.usdcMinor,
    input.rate ?? null,
    input.beneficiary.toLowerCase(),
    input.gatewayWallet.toLowerCase(),
    input.token.toLowerCase(),
    input.chainId,
    input.expiresAt,
  ])
}

// -----------------------------------------------------------------------------------------------------------
// Isolamento operacional
// -----------------------------------------------------------------------------------------------------------

export function matchesIntentScope(
  intent: { organizationId: string; environment: string; chainId: number },
  scope: IntentScope,
): boolean {
  const expectedChain = scope.environment === 'mainnet' ? 5042 : 5042002
  return intent.organizationId === scope.organizationId && intent.environment === scope.environment && intent.chainId === expectedChain
}

// -----------------------------------------------------------------------------------------------------------
// Reservas financeiras
// -----------------------------------------------------------------------------------------------------------

export function availableForReservation(outstandingMinor: bigint, reservedMinor: bigint): bigint {
  if (outstandingMinor < 0n || reservedMinor < 0n) throw new Error('invalid_reservation')
  const available = outstandingMinor - reservedMinor
  return available > 0n ? available : 0n
}

// -----------------------------------------------------------------------------------------------------------
// Máquina de estados com autorização contextual (evidência)
// -----------------------------------------------------------------------------------------------------------

export type IntentCommandSource = 'user' | 'system' | 'verifier'

export interface IntentTransitionContext {
  source: IntentCommandSource
  sameOrganization: boolean
  sameEnvironment: boolean
  expired: boolean
  hasActiveAttempt: boolean
  hasDepositHash: boolean
  submissionUnresolved: boolean
  hasVerifiedReceipt: boolean
  hasVerifiedRevert: boolean
  safeCancellation: boolean
}

const PROTECTED_STATES = new Set<PaymentIntentState>(['SUBMITTED', 'ONCHAIN_CONFIRMED', 'AWAITING_GATEWAY_VERIFICATION'])
const RELEASE_STATES = new Set<PaymentIntentState>(['EXPIRED', 'CANCELED', 'FAILED'])

/**
 * Autoriza uma transição considerando o grafo E a evidência técnica derivada de registros
 * autoritativos (nunca recebida diretamente da interface).
 */
export function authorizeIntentTransition(from: PaymentIntentState, to: PaymentIntentState, ctx: IntentTransitionContext): boolean {
  if (!Object.prototype.hasOwnProperty.call(PAYMENT_INTENT_TRANSITIONS, from)) return false
  if (!Object.prototype.hasOwnProperty.call(PAYMENT_INTENT_TRANSITIONS, to)) return false
  if (!ctx.sameOrganization || !ctx.sameEnvironment) return false
  if (from === to) return true
  if (!canTransitionIntent(from, to)) return false
  if (ctx.expired && !ctx.submissionUnresolved && !ctx.hasDepositHash && !RELEASE_STATES.has(to) && to !== 'REQUIRES_REVIEW') return false
  if (PROTECTED_STATES.has(to) && ctx.source === 'user') return false
  if (to === 'SUBMITTED' && (!ctx.hasActiveAttempt || !ctx.hasDepositHash)) return false
  if (to === 'ONCHAIN_CONFIRMED' || to === 'AWAITING_GATEWAY_VERIFICATION') {
    if (ctx.source !== 'verifier' || !ctx.hasActiveAttempt || !ctx.hasDepositHash || !ctx.hasVerifiedReceipt) return false
  }
  if (RELEASE_STATES.has(to)) {
    if (ctx.submissionUnresolved) return false
    if (ctx.hasDepositHash) return to === 'FAILED' && ctx.source === 'verifier' && ctx.hasVerifiedRevert
    if (!ctx.safeCancellation) return false
  }
  return true
}
