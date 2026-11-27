/**
 * Recebimento "Gateway Direto" (sem backend) — FIN integração Circle Gateway.
 *
 * Fluxo isolado do fluxo comercial (que usa `/api/payment-intents`): permite que o comerciante
 * gere uma cobrança USDC e receba o pagamento usando APENAS os contratos + API oficiais do
 * Circle Gateway (via `appKit.unifiedBalance.depositFor` no lado do pagador), sem depender do
 * servidor Bun. A detecção é on-chain (evento `Transfer` para o GatewayWallet com marca única),
 * reutilizando o mecanismo de conciliação do fluxo legado.
 *
 * Nada aqui depende do backend; nenhum segredo vai para o frontend.
 */
import type { Address } from 'viem'
import { gatewayConfigFor, validateBeneficiary } from './gateway-config'
import type { NetworkId } from './network'
import type { GatewayChainId } from './gateway'

/** Contexto de recebimento direto: contrato GatewayWallet + conta institucional creditada. */
export interface GatewayDirectReceiving {
  environment: NetworkId
  chainId: GatewayChainId
  gatewayWallet: Address
  token: Address
  depositor: Address
}

/**
 * Resolve a conta institucional (depositor) creditada pelo depósito direto Circle Gateway.
 * Usa `treasuryDepositors` com fallback para `treasuryRecipients` — nunca o GatewayWallet nem
 * a carteira conectada. Sem configuração válida, retorna `null` (configuração pendente).
 */
export function gatewayDirectDepositor(
  settings: { treasuryDepositors?: Partial<Record<NetworkId, string>>; treasuryRecipients?: Partial<Record<NetworkId, string>> },
  environment: NetworkId,
): Address | null {
  const candidate = (settings.treasuryDepositors?.[environment] ?? settings.treasuryRecipients?.[environment] ?? '').trim()
  const validation = validateBeneficiary(candidate, environment)
  return validation.ok ? validation.value : null
}

/**
 * Contexto de recebimento direto (destino do depósito = GatewayWallet oficial; conta creditada
 * = depositor institucional). `null` quando o depositor não está configurado.
 */
export function gatewayDirectReceiving(
  settings: { treasuryDepositors?: Partial<Record<NetworkId, string>>; treasuryRecipients?: Partial<Record<NetworkId, string>> },
  environment: NetworkId,
): GatewayDirectReceiving | null {
  const depositor = gatewayDirectDepositor(settings, environment)
  if (!depositor) return null
  const cfg = gatewayConfigFor(environment)
  return {
    environment,
    chainId: cfg.chainId as GatewayChainId,
    gatewayWallet: cfg.gatewayWallet,
    token: cfg.usdcToken,
    depositor,
  }
}
