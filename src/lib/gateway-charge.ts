/**
 * Serviço central de cobrança Gateway (FIN-04.1B.2.2B).
 *
 * Compõe a criação autoritativa de cobrança comercial: validação de saldo disponível,
 * referência pública opaca de checkout e conversão monetária exata — sem criar estados
 * financeiros (a intenção/reserva são persistidas pelo Store).
 */
import { sha256 } from 'viem/utils'
import { fromNumber } from './accounting/money'
import { gatewayConfigFor } from './gateway-config'
import type { NetworkId } from './network'
import type { Account, PaymentRequest, PaymentReservation } from './types'

/** Saldo em aberto (unidades menores da moeda original) de uma obrigação, derivado de liquidações persistidas. */
export function obligationOutstandingMinor(account: Account): bigint | null {
  const currency = account.currency
  if (!currency) return null
  const amountMinor = fromNumber(account.amount, currency)
  if (amountMinor === null) return null
  let paidMinor = 0n
  for (const s of account.settlements ?? []) {
    const m = fromNumber(s.amount, currency)
    if (m !== null) paidMinor += m
  }
  return amountMinor - paidMinor
}

/**
 * Saldo disponível para nova cobrança de uma obrigação, em unidades menores da moeda original
 * (saldo em aberto − reservado). Nunca mistura moedas; reservas HELD/REQUIRES_REVIEW bloqueiam saldo.
 */
export function getChargeAvailability(
  account: Account,
  reservations: PaymentReservation[],
  scope: { organizationId: string; environment: NetworkId },
): bigint {
  if (account.kind !== 'receivable' || account.status !== 'open' || account.canceledAt || account.environment !== scope.environment) return 0n
  const outstanding = obligationOutstandingMinor(account)
  if (outstanding === null) return 0n
  const currency = account.currency!
  const reserved = reservations
    .filter(
      (r) =>
        r.accountId === account.id &&
        r.organizationId === scope.organizationId &&
        r.environment === scope.environment &&
        r.currency === currency &&
        (r.state === 'HELD' || r.state === 'REQUIRES_REVIEW'),
    )
    .reduce((sum, r) => sum + BigInt(r.amountMinor), 0n)
  const available = outstanding - reserved
  return available > 0n ? available : 0n
}

/** SHA-256 em hex (sem prefixo `0x`), via viem/@noble — determinístico e criptográfico. */
export function hashCheckoutToken(token: string): string {
  const digest = sha256(new TextEncoder().encode(token), 'hex')
  return digest.startsWith('0x') ? digest.slice(2) : digest
}

/** Valida o formato de um token de checkout opaco (base64url, 32 bytes = 43 caracteres). */
export function isCheckoutTokenValid(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63]
  }
  const rem = bytes.length - i
  if (rem === 1) {
    const n = bytes[i] << 16
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63]
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63]
  }
  return out
}

function randomToken(): string {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('crypto_unavailable')
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

/** Gera referência pública opaca do checkout (CSPRNG, 32 bytes) e seu hash SHA-256. */
export function createCheckoutToken(): { token: string; tokenHash: string } {
  const token = randomToken()
  return { token, tokenHash: hashCheckoutToken(token) }
}

/** Monta o link de checkout a partir de uma base e do token opaco (nunca valores financeiros na URL). */
export function checkoutUrlFor(base: string, token: string): string {
  const b = base.replace(/\/+$/, '')
  return `${b}/checkout/${token}`
}

/**
 * Uma cobrança exige verificação independente do Circle Gateway (nunca liquidação por `Transfer`)
 * quando é explicitamente `circle_gateway` OU quando aponta para o GatewayWallet (cobranças antigas
 * sem `paymentRail`). Não afeta cobranças legadas para carteiras convencionais.
 */
export function requiresGatewayVerification(request: PaymentRequest): boolean {
  if (request.paymentRail === 'circle_gateway') return true
  const recipient = request.recipient.toLowerCase()
  return [gatewayConfigFor('mainnet').gatewayWallet, gatewayConfigFor('testnet').gatewayWallet].some((a) => a.toLowerCase() === recipient)
}
