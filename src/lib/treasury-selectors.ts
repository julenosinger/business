/**
 * Seletores puros da Tesouraria (fase 3.2.1).
 *
 * Classificam operações/cobranças pelo AMBIENTE (Mainnet/Testnet) derivado da rede PERSISTIDA em cada
 * registro (`chain`/`destChain`/`chainKey`) — nunca do estado visual atual da interface. Assim, o histórico
 * permanece isolado mesmo após alternar a rede, e a reconciliação continua usando a rede original.
 *
 * Registros legados sem rede identificável → `unknown` (preservados, nunca atribuídos automaticamente).
 */
import { gatewayChainEnv, type NetworkId } from './network'
import type { Account, PaymentRequest, TreasuryOp } from './types'

export type OpEnv = 'live' | 'test' | 'unknown' | 'invalid_environment'

/**
 * Ambiente de uma operação de tesouraria, derivado da rede persistida.
 * - Origem/destino conhecidos e compatíveis → o ambiente.
 * - Origem e destino conhecidos mas de ambientes diferentes → `invalid_environment` (nunca escolher um deles).
 * - Sem rede identificável → `unknown`.
 */
export function treasuryOpEnv(op: Pick<TreasuryOp, 'chain' | 'destChain'>): OpEnv {
  const src = gatewayChainEnv(op.chain)
  const dst = op.destChain ? gatewayChainEnv(op.destChain) : undefined
  if (src && dst && src !== dst) return 'invalid_environment'
  return src ?? dst ?? 'unknown'
}

/** Operações da tesouraria filtradas pelo ambiente (Mainnet = 'live', Testnet = 'test'). */
export function treasuryOpsForNetwork(ops: TreasuryOp[], network: NetworkId): TreasuryOp[] {
  const wanted = network === 'mainnet' ? 'live' : 'test'
  return ops.filter((op) => treasuryOpEnv(op) === wanted)
}

/** Ambiente de uma cobrança (PaymentRequest), derivado da chainKey persistida. */
export function requestEnv(r: Pick<PaymentRequest, 'chainKey'>): OpEnv {
  return gatewayChainEnv(r.chainKey) ?? 'unknown'
}

export function requestsForNetwork(requests: PaymentRequest[], network: NetworkId): PaymentRequest[] {
  const wanted = network === 'mainnet' ? 'live' : 'test'
  return requests.filter((r) => requestEnv(r) === wanted)
}

/**
 * Ambiente da intenção de pagamento EM PROCESSAMENTO de uma obrigação (pendente/ambígua/revisão).
 * `null` quando não há intenção ativa (obrigação não preparada). Usado para impedir pagamento
 * concorrente da mesma obrigação em ambientes diferentes.
 */
export function inFlightIntentEnv(accountId: string, ops: TreasuryOp[]): OpEnv | null {
  const op = ops.find(
    (o) => o.accountId === accountId && o.kind === 'spend' && (o.status === 'pending' || o.status === 'ambiguous' || o.status === 'requires_review'),
  )
  return op ? treasuryOpEnv(op) : null
}

export type QueueState = 'prepared' | 'unprepared' | 'other_env'

/**
 * Estado de uma obrigação na fila de pagamentos em relação ao ambiente ativo.
 * - `prepared`: ambiente escolhido explicitamente === ambiente atual (executável).
 * - `unprepared`: sem ambiente escolhido (não executável; fica no ERP).
 * - `other_env`: preparada para o outro ambiente (oculta da fila atual).
 */
export function paymentQueueState(account: Pick<Account, 'paymentNetwork'>, network: NetworkId): QueueState {
  if (account.paymentNetwork === undefined) return 'unprepared'
  return account.paymentNetwork === network ? 'prepared' : 'other_env'
}

export type PayEligibility = { ok: true } | { ok: false; reason: 'canceled' | 'settled' | 'active_intent' }

/**
 * Elegibilidade centralizada para executar/preparar um pagamento (reutilizada por Preparar, Pagar,
 * checkbox, selecionar todas e lote). Considera obrigação aberta, não cancelada e sem intenção ativa
 * em QUALQUER ambiente.
 */
export function payEligibility(account: Account, ops: TreasuryOp[]): PayEligibility {
  if (account.canceledAt) return { ok: false, reason: 'canceled' }
  if (account.status !== 'open') return { ok: false, reason: 'settled' }
  if (inFlightIntentEnv(account.id, ops) !== null) return { ok: false, reason: 'active_intent' }
  return { ok: true }
}

export type CancelDecision = { ok: true } | { ok: false; reason: 'not_found' | 'not_manual' | 'settled' | 'active_intent' }

/** Validação de cancelamento lógico: só obrigação manual, sem liquidações e sem intenção ativa. */
export function canCancel(account: Account | undefined, ops: TreasuryOp[]): CancelDecision {
  if (!account) return { ok: false, reason: 'not_found' }
  if (account.source !== 'manual') return { ok: false, reason: 'not_manual' }
  if ((account.settlements?.length ?? 0) > 0 || account.status === 'paid') return { ok: false, reason: 'settled' }
  if (ops.some((o) => o.accountId === account.id && o.status !== 'failed')) return { ok: false, reason: 'active_intent' }
  return { ok: true }
}
