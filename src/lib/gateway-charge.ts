/**
 * Serviço central de cobrança Gateway (FIN-04.1B.2.2B).
 *
 * Compõe a criação autoritativa de cobrança comercial: validação de saldo disponível,
 * referência pública opaca de checkout e conversão monetária exata — sem criar estados
 * financeiros (a intenção/reserva são persistidas pelo Store).
 */
import { fromNumber } from './accounting/money'
import type { NetworkId } from './network'
import type { Account, PaymentReservation } from './types'

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
  const currency = account.currency
  if (!currency) return 0n
  const amountMinor = fromNumber(account.amount, currency)
  if (amountMinor === null) return 0n
  let paidMinor = 0n
  for (const s of account.settlements ?? []) {
    const m = fromNumber(s.amount, currency)
    if (m !== null) paidMinor += m
  }
  const outstanding = amountMinor - paidMinor
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

/** Hash FNV-1a (determinístico, para opacidade local; o backend usará sha256). */
function hashToken(token: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function randomSegment(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID().replace(/-/g, '')
  } catch {
    // fallback abaixo
  }
  let s = ''
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

/** Gera referência pública opaca do checkout e seu hash. */
export function createCheckoutToken(): { token: string; tokenHash: string } {
  const token = randomSegment() + randomSegment()
  return { token, tokenHash: hashToken(token) }
}

/** Monta o link de checkout a partir de uma base e do token opaco (nunca valores financeiros na URL). */
export function checkoutUrlFor(base: string, token: string): string {
  const b = base.replace(/\/+$/, '')
  return `${b}/checkout/${token}`
}
