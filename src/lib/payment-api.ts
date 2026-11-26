/**
 * Transporte HTTP autoritativo para cobranças Gateway (FIN-04.1B.2.2B.3).
 * Usa a sessão comercial (cookie HttpOnly) do deploy — nunca Bearer administrativo no bundle.
 */
import type { NetworkId } from './network'

export interface CreateChargeRequest {
  environment: 'mainnet' | 'testnet'
  accountId?: string
  description?: string
  amountDecimal: string
  currency?: string
  idempotencyKey: string
}

export interface CreateChargeResponse {
  ok: true
  intentId: string
  checkoutToken: string
  configurationPending: boolean
  expiresAt: string
}

export interface TreasuryChargeRow {
  intentId: string
  environment: NetworkId
  accountId: string
  currency: string
  amountMinor: string
  usdcMinor: string
  state: string
  createdAt: string
  expiresAt: string
  transactionHash: string | null
}

export class PaymentApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code)
    this.name = 'PaymentApiError'
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    return {} as T
  }
}

export async function createChargeApi(input: CreateChargeRequest, signal?: AbortSignal): Promise<CreateChargeResponse> {
  const response = await fetch('/api/payment-intents', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
    cache: 'no-store',
  })
  const payload = await parseJson<CreateChargeResponse & { error?: string; reason?: string }>(response)
  if (!response.ok || !('ok' in payload) || !payload.ok) {
    throw new PaymentApiError((payload as { reason?: string }).reason ?? (payload as { error?: string }).error ?? 'charge_creation_failed', response.status)
  }
  return payload
}

export async function loadTreasuryChargesApi(environment: NetworkId, signal?: AbortSignal): Promise<TreasuryChargeRow[]> {
  const response = await fetch(`/api/payment-intents?environment=${environment}`, { credentials: 'same-origin', cache: 'no-store', signal })
  if (!response.ok) throw new PaymentApiError('charges_load_failed', response.status)
  return parseJson<TreasuryChargeRow[]>(response)
}

export interface PublicCheckout {
  reference: string
  company: string
  description: string | null
  environment: NetworkId
  chainId: number
  token: string
  gatewayWallet: string
  usdcMinor: string
  expiresAt: string
  state: string
  paymentReady: boolean
}

export async function getPublicCheckoutApi(token: string, signal?: AbortSignal): Promise<PublicCheckout> {
  const response = await fetch(`/api/checkout/${encodeURIComponent(token)}`, { cache: 'no-store', signal })
  if (!response.ok) throw new PaymentApiError('checkout_unavailable', response.status)
  return parseJson<PublicCheckout>(response)
}

/** Detecta o token de checkout pela URL: query `?checkout=` ou path `/checkout/:token`. */
export function readCheckoutFromLocation(loc?: { search?: string; pathname?: string }): string | null {
  try {
    const search = loc?.search ?? (typeof window !== 'undefined' ? window.location.search : '')
    const pathname = loc?.pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '')
    const query = new URLSearchParams(search).get('checkout')
    if (query && /^[A-Za-z0-9_-]{43}$/.test(query)) return query
    const m = pathname.match(/^\/checkout\/([A-Za-z0-9_-]+)$/)
    if (m) return m[1]
  } catch {
    // ignore
  }
  return null
}
