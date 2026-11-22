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
import type { PaymentRequest, TreasuryOp } from './types'

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
