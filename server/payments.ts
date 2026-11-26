/**
 * Checkout comercial Circle Gateway — persistência compartilhada e segurança criptográfica
 * (FIN-04.1B.2.2B.1). O servidor é a fonte autoritativa para cobranças compartilháveis; o
 * cliente é uma projeção. Usa CSPRNG (`node:crypto`) e SHA-256 — nunca Math.random/FNV.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import type { LedgerDb } from './db'

export type GatewayEnvironment = 'mainnet' | 'testnet'

/** Gera referência pública opaca (32 bytes, base64url) e seu hash SHA-256. */
export function generateCheckoutToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashCheckoutToken(token) }
}

export function hashCheckoutToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function isCheckoutTokenValid(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}

export interface CreateGatewayChargeInput {
  accountId: string
  saleId?: string
  customerId?: string
  chainId: number
  tokenAddress: string
  gatewayWallet: string
  /** Conta institucional creditada; null = configuração pendente (nunca o GatewayWallet). */
  depositor: string | null
  currency: string
  amountMinor: string
  usdcMinor: string
  exchangeRate?: string
  idempotencyKey: string
  fingerprint: string
  expiresAt: string
  companyName: string
  publicDescription?: string
  publicReference?: string
}

export type CreateGatewayChargeResult =
  | { ok: true; intentId: string; checkoutToken: string; configurationPending: boolean }
  | { ok: false; reason: 'duplicate_conflict' | 'invalid_input' }

const ENVIRONMENTS = new Set(['mainnet', 'testnet'])

/**
 * Cria a cobrança Gateway em UMA transação SQLite: idempotência (org+env+chave), intenção,
 * reserva e token de checkout. Conflito de fingerprint → `duplicate_conflict`. Nunca duplica
 * a reserva ao reemitir o link para a MESMA intenção.
 */
export function createGatewayCharge(db: LedgerDb, orgId: string, environment: GatewayEnvironment, input: CreateGatewayChargeInput): CreateGatewayChargeResult {
  if (!ENVIRONMENTS.has(environment) || !input.idempotencyKey || !input.usdcMinor || !input.amountMinor || !input.accountId || !input.fingerprint) {
    return { ok: false, reason: 'invalid_input' }
  }
  const now = new Date().toISOString()
  const intentId = randomUUID()
  const { token, tokenHash } = generateCheckoutToken()

  const run = db.db.transaction((): CreateGatewayChargeResult => {
    const existing = db.db
      .query('SELECT intent_id, fingerprint FROM payment_intents WHERE organization_id = ? AND environment = ? AND idempotency_key = ?')
      .get(orgId, environment, input.idempotencyKey) as { intent_id: string; fingerprint: string } | undefined

    if (existing) {
      if (existing.fingerprint !== input.fingerprint) return { ok: false, reason: 'duplicate_conflict' }
      // Reemissão do link para a MESMA intenção: novo token, sem duplicar intenção/reserva.
      db.db.query('INSERT INTO checkout_tokens (token_hash, intent_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, existing.intent_id, now, input.expiresAt)
      return { ok: true, intentId: existing.intent_id, checkoutToken: token, configurationPending: !input.depositor }
    }

    db.db
      .query(
        `INSERT INTO payment_intents (intent_id, organization_id, environment, account_id, sale_id, customer_id, chain_id, token_address, gateway_wallet, depositor, currency, amount_minor, usdc_minor, exchange_rate, idempotency_key, fingerprint, state, company, description, reference, created_at, expires_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        intentId, orgId, environment, input.accountId, input.saleId ?? null, input.customerId ?? null, input.chainId, input.tokenAddress, input.gatewayWallet,
        input.depositor, input.currency, input.amountMinor, input.usdcMinor, input.exchangeRate ?? null, input.idempotencyKey, input.fingerprint,
        input.companyName, input.publicDescription ?? null, input.publicReference ?? null, now, input.expiresAt,
      )

    db.db
      .query('INSERT INTO payment_reservations (reservation_id, intent_id, organization_id, environment, account_id, currency, amount_minor, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), intentId, orgId, environment, input.accountId, input.currency, input.amountMinor, 'HELD', now)

    db.db.query('INSERT INTO checkout_tokens (token_hash, intent_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, intentId, now, input.expiresAt)

    return { ok: true, intentId, checkoutToken: token, configurationPending: !input.depositor }
  })

  return run()
}

export interface PublicCheckout {
  reference: string
  company: string
  description: string | null
  environment: GatewayEnvironment
  chainId: number
  token: string
  gatewayWallet: string
  usdcMinor: string
  expiresAt: string
  state: string
  paymentReady: boolean
}

interface CheckoutRow {
  reference: string | null
  company: string
  description: string | null
  environment: string
  chain_id: number
  token_address: string
  gateway_wallet: string
  depositor: string | null
  usdc_minor: string
  expires_at: string
  state: string
}

/** Consulta pública mínima do checkout por token opaco — nunca expõe dados privados da organização. */
export function getPublicCheckout(db: LedgerDb, token: string): PublicCheckout | null {
  if (!isCheckoutTokenValid(token)) return null
  const tokenHash = hashCheckoutToken(token)
  const row = db.db
    .query(
      `SELECT pi.reference, pi.company, pi.description, pi.environment, pi.chain_id, pi.token_address, pi.gateway_wallet, pi.depositor, pi.usdc_minor, pi.expires_at, pi.state
       FROM checkout_tokens ct JOIN payment_intents pi ON pi.intent_id = ct.intent_id
       WHERE ct.token_hash = ? AND ct.revoked_at IS NULL`,
    )
    .get(tokenHash) as CheckoutRow | undefined
  if (!row) return null
  const expired = Date.parse(row.expires_at) <= Date.now()
  const paymentReady = row.depositor != null && row.state === 'CREATED' && !expired
  return {
    reference: row.reference ?? '',
    company: row.company,
    description: row.description,
    environment: row.environment as GatewayEnvironment,
    chainId: row.chain_id,
    token: row.token_address,
    gatewayWallet: row.gateway_wallet,
    usdcMinor: row.usdc_minor,
    expiresAt: row.expires_at,
    state: row.state,
    paymentReady,
  }
}
