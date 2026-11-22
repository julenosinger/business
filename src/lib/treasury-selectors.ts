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

export type OpEnv = 'live' | 'test' | 'unknown'

/** Ambiente de uma operação de tesouraria, derivado da rede persistida (origem, depois destino). */
export function treasuryOpEnv(op: Pick<TreasuryOp, 'chain' | 'destChain'>): OpEnv {
  return gatewayChainEnv(op.chain) ?? (op.destChain ? gatewayChainEnv(op.destChain) : undefined) ?? 'unknown'
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
