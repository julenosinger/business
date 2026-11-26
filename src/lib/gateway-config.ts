/**
 * Configuração centralizada do Circle Gateway por ambiente (fase FIN-04.1B.2).
 *
 * Fonte única dos contratos e endpoints oficiais, resolvidos por AMBIENTE (mainnet/testnet) e Chain ID.
 * O `cctpDomain` 26 é COMPARTILHADO pelas duas redes Arc — portanto o domínio nunca é usado como
 * identificador de ambiente; toda resolução exige `NetworkId` + `chainId` explícitos.
 *
 * Os endereços vêm do registro on-chain (`onchain-facts`), gerado pelo Arc Studio — nada é inventado.
 */
import { encodeFunctionData, erc20Abi, isAddress, type Address } from 'viem'
import { getChain, getProtocolContractByName, getUsdc } from '@/onchain-facts'
import type { NetworkId } from './network'
import { parseMinorUnits } from './payment-intent'

const ZERO = '0x0000000000000000000000000000000000000000'

/** Endereço válido e não-zero. */
const isValidNonZeroAddress = (x: string | undefined): x is Address => !!x && isAddress(x) && x.toLowerCase() !== ZERO

export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_TESTNET_CHAIN_ID = 5042002

/** USDC ERC-20 na Arc (6 decimais) — distinto do USDC nativo usado para gas (18 decimais). */
export const ARC_USDC = '0x3600000000000000000000000000000000000000' as const

export interface GatewayConfig {
  network: NetworkId
  chainId: number
  /** Domínio CCTP/Gateway (26 em ambas as redes Arc). */
  cctpDomain: number
  gatewayWallet: Address
  gatewayMinter: Address
  usdcToken: Address
  apiBase: string
  explorerBase: string
}

/** Resolve a configuração oficial do Gateway para o ambiente indicado. Rejeita ambiente desconhecido (runtime). */
export function gatewayConfigFor(network: NetworkId): GatewayConfig {
  if (network !== 'mainnet' && network !== 'testnet') throw new Error(`Unknown environment: ${String(network)}`)
  const chainId = network === 'mainnet' ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID
  const chain = getChain(chainId)
  if (!chain) throw new Error(`Unknown Arc chain id ${chainId}`)
  const gatewayWallet = getProtocolContractByName('GatewayWallet', network === 'mainnet' ? 'mainnet' : 'testnet')?.address
  const gatewayMinter = getProtocolContractByName('GatewayMinter', network === 'mainnet' ? 'mainnet' : 'testnet')?.address
  if (!isValidNonZeroAddress(gatewayWallet)) throw new Error(`GatewayWallet not registered for ${network}`)
  if (!isValidNonZeroAddress(gatewayMinter)) throw new Error(`GatewayMinter not registered for ${network}`)
  const usdc = getUsdc(chainId)?.address ?? ARC_USDC
  if (!isValidNonZeroAddress(usdc)) throw new Error(`USDC token not registered for ${network}`)
  return {
    network,
    chainId,
    cctpDomain: chain.cctpDomain ?? 0,
    gatewayWallet: gatewayWallet,
    gatewayMinter: gatewayMinter,
    usdcToken: usdc,
    apiBase: network === 'mainnet' ? 'https://gateway-api.circle.com/v1/' : 'https://gateway-api-testnet.circle.com/v1/',
    explorerBase: chain.explorerBase,
  }
}

/**
 * Resolve o GatewayWallet SOMENTE quando o `chainId` corresponde ao ambiente esperado.
 * Retorna `null` para qualquer chainId de outro ambiente (isolamento estrito).
 */
export function gatewayWalletForChain(chainId: number, network: NetworkId): Address | null {
  const cfg = gatewayConfigFor(network)
  return chainId === cfg.chainId ? cfg.gatewayWallet : null
}

/**
 * Beneficiário institucional para o ambiente — resolução EXCLUSIVAMENTE por ambiente.
 * Sem configuração, retorna string vazia (não configurado). Nunca usa fallback legado, carteira
 * conectada ou outro ambiente.
 */
export function treasuryRecipientFor(
  settings: { treasuryRecipients?: Partial<Record<NetworkId, string>> },
  network: NetworkId,
): string {
  if (network !== 'mainnet' && network !== 'testnet') throw new Error(`Unknown environment: ${String(network)}`)
  return (settings.treasuryRecipients?.[network] ?? '').trim()
}

/**
 * Configuração efetiva de recebimento da Treasury para o fluxo comercial Circle Gateway.
 * Separa o contrato de infraestrutura (`gatewayWallet`, destino do depósito oficial) do
 * beneficiário institucional convencional (`beneficiary`, crédito contábil).
 */
export interface TreasuryReceivingConfig {
  environment: 'mainnet' | 'testnet'
  chainId: number
  gatewayWallet: string
  beneficiary: string | null
  token: string
}

/**
 * Valida se um endereço é o GatewayWallet oficial do ambiente (destino de depósito do Circle
 * Gateway). Diferente de `validateBeneficiary`, que rejeita contratos de infraestrutura.
 * Aplicável somente ao fluxo comercial Circle Gateway — nunca ao fluxo legado de transferência ERC20 direta.
 */
export function validateGatewayTreasury(recipient: string, environment: NetworkId, chainId: number): boolean {
  if (environment !== 'mainnet' && environment !== 'testnet') return false
  if (typeof recipient !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) return false
  const cfg = gatewayConfigFor(environment)
  return chainId === cfg.chainId && recipient.toLowerCase() === cfg.gatewayWallet.toLowerCase()
}

/**
 * Resolve a configuração de recebimento separando GatewayWallet (contrato) de beneficiário
 * (carteira convencional). Nunca usa o GatewayWallet como beneficiário; sem beneficiário
 * convencional válido, `beneficiary` é `null` (configuração pendente).
 */
export function resolveTreasuryReceivingConfig(
  settings: { treasuryRecipients?: Partial<Record<NetworkId, string>> },
  environment: NetworkId,
): TreasuryReceivingConfig {
  const cfg = gatewayConfigFor(environment)
  const candidate = treasuryRecipientFor(settings, environment)
  const validation = validateBeneficiary(candidate, environment)
  return {
    environment,
    chainId: cfg.chainId,
    gatewayWallet: cfg.gatewayWallet,
    beneficiary: validation.ok ? candidate : null,
    token: cfg.usdcToken,
  }
}

/**
 * Contexto de recebimento do Circle Gateway: separa o contrato de DESTINO do depósito
 * (`gatewayWallet`) da conta institucional CREDITADA pelo protocolo (`depositor`).
 * `depositor === null` significa configuração pendente (nunca o GatewayWallet nem a carteira do operador).
 */
export interface GatewayReceivingContext {
  environment: 'mainnet' | 'testnet'
  chainId: number
  gatewayWallet: Address
  token: Address
  depositor: Address | null
}

/**
 * Identidade institucional autorizada da Treasury: a conta efetivamente creditada pelo Gateway
 * (`depositor`), vinculada à organização e ao ambiente, com autorização comprovada.
 */
export interface TreasuryIdentity {
  organizationId: string
  environment: NetworkId
  depositor: Address
  authorizationId: string
  verified: boolean
}

/** Repositório de identidades Treasury autorizadas (adaptador da infraestrutura real). */
export interface TreasuryIdentityRepository {
  findAuthorized(organizationId: string, environment: NetworkId): TreasuryIdentity | null
}

/**
 * Resolve a identidade institucional autorizada e o contexto de recebimento. Nunca retorna o
 * GatewayWallet como depositor, endereço fictício, carteira do cliente ou do operador. Sem
 * identidade autorizada → `treasury_identity_unresolved` (a cobrança permanece pendente).
 */
export function resolveInstitutionalGatewayContext(
  organizationId: string,
  environment: NetworkId,
  identities: TreasuryIdentityRepository,
): { ok: true; context: GatewayReceivingContext & { organizationId: string; authorizationId: string } } | { ok: false; reason: 'treasury_identity_unresolved' | 'invalid_treasury_identity' } {
  const cfg = gatewayConfigFor(environment)
  const identity = identities.findAuthorized(organizationId, environment)
  if (!identity || !identity.verified || identity.organizationId !== organizationId || identity.environment !== environment) {
    return { ok: false, reason: 'treasury_identity_unresolved' }
  }
  const validation = validateBeneficiary(identity.depositor, environment)
  if (!validation.ok) return { ok: false, reason: 'invalid_treasury_identity' }
  return {
    ok: true,
    context: {
      organizationId,
      environment,
      chainId: cfg.chainId,
      gatewayWallet: cfg.gatewayWallet,
      token: cfg.usdcToken,
      depositor: identity.depositor,
      authorizationId: identity.authorizationId,
    },
  }
}

/**
 * Repositório de identidade baseado na configuração institucional local (`treasuryDepositors`),
 * com fallback para o beneficiário convencional (`treasuryRecipients`). A autorização é a própria
 * configuração explícita do dono — nunca o GatewayWallet nem a carteira conectada.
 */
export function settingsIdentityRepository(settings: {
  treasuryDepositors?: Partial<Record<NetworkId, string>>
  treasuryRecipients?: Partial<Record<NetworkId, string>>
}): TreasuryIdentityRepository {
  return {
    findAuthorized(organizationId, environment) {
      const candidate = (settings.treasuryDepositors?.[environment] ?? settings.treasuryRecipients?.[environment] ?? '').trim()
      const validation = validateBeneficiary(candidate, environment)
      if (!validation.ok) return null
      return { organizationId, environment, depositor: validation.value, authorizationId: `settings:${environment}`, verified: true }
    },
  }
}

/**
 * Resolve o contexto de recebimento reutilizando `resolveTreasuryReceivingConfig`.
 * O `depositor` é a conta institucional convencional configurada; quando a configuração contém
 * o GatewayWallet (ou nada), `depositor` é `null` (configuração pendente) — nunca o contrato.
 */
export function resolveGatewayReceivingContext(
  settings: { treasuryRecipients?: Partial<Record<NetworkId, string>> },
  environment: NetworkId,
): GatewayReceivingContext {
  const receiving = resolveTreasuryReceivingConfig(settings, environment)
  return {
    environment: receiving.environment,
    chainId: receiving.chainId,
    gatewayWallet: receiving.gatewayWallet as Address,
    token: receiving.token as Address,
    depositor: receiving.beneficiary ? (receiving.beneficiary as Address) : null,
  }
}

export type BeneficiaryReason = 'invalid_address' | 'gateway_contract' | 'unknown_environment'
export type BeneficiaryValidation = { ok: true; value: Address } | { ok: false; reason: BeneficiaryReason }

/**
 * Valida um endereço candidato a beneficiário institucional: deve ser válido, não-zero e NÃO ser
 * um contrato de infraestrutura do Gateway (GatewayWallet/GatewayMinter/USDC). Não comprova controle
 * institucional — apenas formato e compatibilidade funcional.
 */
export function validateBeneficiary(address: string, network: NetworkId): BeneficiaryValidation {
  if (network !== 'mainnet' && network !== 'testnet') return { ok: false, reason: 'unknown_environment' }
  if (!isValidNonZeroAddress(address)) return { ok: false, reason: 'invalid_address' }
  const cfg = gatewayConfigFor(network)
  const lower = address.toLowerCase()
  if (lower === cfg.gatewayWallet.toLowerCase() || lower === cfg.gatewayMinter.toLowerCase() || lower === cfg.usdcToken.toLowerCase()) {
    return { ok: false, reason: 'gateway_contract' }
  }
  return { ok: true, value: address }
}

/** Assinatura oficial de `depositFor(address token, address depositor, uint256 value)` no GatewayWallet. */
export const DEPOSIT_FOR_ABI = [
  {
    type: 'function',
    name: 'depositFor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

/** Codifica a chamada `depositFor(token, depositor, value)` para envio ao GatewayWallet. */
export function encodeDepositFor(token: Address, depositor: Address, value: bigint): `0x${string}` {
  if (!isValidNonZeroAddress(token)) throw new Error('depositFor: invalid token address')
  if (!isValidNonZeroAddress(depositor)) throw new Error('depositFor: invalid depositor address')
  if (typeof value !== 'bigint' || value <= 0n || value > (1n << 256n) - 1n) throw new Error('depositFor: invalid value')
  return encodeFunctionData({ abi: DEPOSIT_FOR_ABI, functionName: 'depositFor', args: [token, depositor, value] })
}

/** Transação preparada do depósito oficial Circle Gateway (destino sempre o GatewayWallet). */
export interface PreparedGatewayDeposit {
  chainId: number
  to: Address
  value: bigint
  data: `0x${string}`
}

/**
 * Prepara a transação `depositFor(token, depositor, value)` contra o GatewayWallet oficial,
 * reutilizando `encodeDepositFor` (ABI única, sem conflito). Exige depositor resolvido e configuração
 * compatível com o registro. Nunca usa transferência ERC20 simples para o GatewayWallet.
 */
export function prepareGatewayDeposit(context: GatewayReceivingContext, usdcMinor: string): PreparedGatewayDeposit {
  if (!context.depositor) throw new Error('depositor_unresolved')
  if (!validateBeneficiary(context.depositor, context.environment).ok) throw new Error('invalid_depositor')
  const cfg = gatewayConfigFor(context.environment)
  if (
    context.chainId !== cfg.chainId ||
    context.gatewayWallet.toLowerCase() !== cfg.gatewayWallet.toLowerCase() ||
    context.token.toLowerCase() !== cfg.usdcToken.toLowerCase()
  ) {
    throw new Error('gateway_config_mismatch')
  }
  const amount = parseMinorUnits(usdcMinor)
  const data = encodeDepositFor(context.token, context.depositor, amount)
  return { chainId: cfg.chainId, to: cfg.gatewayWallet, value: 0n, data }
}

/** Cliente mínimo de leitura on-chain (viem `PublicClient` é compatível). */
export interface GatewayReadClient {
  getChainId(): Promise<number>
  readContract(args: { address: Address; abi: unknown; functionName: string; args: readonly unknown[] }): Promise<unknown>
}

export interface PaymentRequirements {
  balance: bigint
  allowance: bigint
  sufficientBalance: boolean
  needsApproval: boolean
}

/**
 * Consulta saldo e allowance do pagador (leitura exclusiva). Spender é o GatewayWallet do ambiente.
 * Rejeita chainId divergente. Nunca emite transação nem fabrica aprovação.
 */
export async function readPaymentRequirements(
  client: GatewayReadClient,
  payer: Address,
  context: GatewayReceivingContext,
  amount: bigint,
): Promise<PaymentRequirements> {
  const chainId = await client.getChainId()
  if (chainId !== context.chainId) throw new Error('wrong_chain')
  const [balance, allowance] = await Promise.all([
    client.readContract({ address: context.token, abi: erc20Abi, functionName: 'balanceOf', args: [payer] }),
    client.readContract({ address: context.token, abi: erc20Abi, functionName: 'allowance', args: [payer, context.gatewayWallet] }),
  ])
  const b = balance as bigint
  const a = allowance as bigint
  return { balance: b, allowance: a, sufficientBalance: b >= amount, needsApproval: a < amount }
}
