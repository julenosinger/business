/**
 * Checkout comercial Circle Gateway — persistência compartilhada e segurança criptográfica
 * (FIN-04.1B.2.2B.2). O servidor é a fonte AUTORITATIVA: resolve configuração blockchain,
 * valores monetários, fingerprint e vencimento — nunca confia nesses campos vindos do navegador.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import type { LedgerDb } from './db'
import { gatewayConfigFor, validateBeneficiary } from '../src/lib/gateway-config'
import { parseMinorUnits, parseExactDecimal } from '../src/lib/payment-intent'
import { EXPONENT } from '../src/lib/accounting/money'
import { emptyLedger, postEvent } from '../src/lib/accounting/engine'
import { obligationOutstandingMinor, obligationCurrency } from './settle'
import type { CurrencyCode } from '../src/lib/types'

export type GatewayEnvironment = 'mainnet' | 'testnet'

const ENVIRONMENTS = new Set(['mainnet', 'testnet'])
const CHARGE_TTL_MS = 24 * 60 * 60 * 1000
const OWNER_ACTOR = { id: 'owner', kind: 'user' as const, role: 'owner' as const }

// -----------------------------------------------------------------------------------------------------------
// Tokens de checkout (CSPRNG + SHA-256)
// -----------------------------------------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------------------------------------
// Criação autoritativa da cobrança
// -----------------------------------------------------------------------------------------------------------

/** DTO comercial mínimo: apenas o essencial do negócio — nada de configuração blockchain. */
export interface CreateCommercialChargeInput {
  environment: GatewayEnvironment
  accountId?: string
  description?: string
  amountDecimal: string
  /** Moeda contábil da cobrança avulsa (validada). Para obrigação existente, a moeda vem do razão. */
  currency?: string
  idempotencyKey: string
  companyName: string
  publicDescription?: string
  publicReference?: string
}

export type CreateGatewayChargeResult =
  | { ok: true; intentId: string; checkoutToken: string; configurationPending: boolean }
  | { ok: false; reason: 'duplicate_conflict' | 'invalid_input' | 'invalid_amount' | 'invalid_currency' | 'obligation_not_found' | 'insufficient_balance' | 'unresolved_depositor' }

interface ChargeFingerprintInput {
  organizationId: string
  environment: string
  accountId: string
  currency: string
  amountMinor: string
  usdcMinor: string
  chainId: number
  gatewayWallet: string
  tokenAddress: string
  depositor: string | null
}

/** Fingerprint canônico (SHA-256) calculado EXCLUSIVAMENTE pelo servidor. */
export function computeChargeFingerprint(input: ChargeFingerprintInput): string {
  const canonical = JSON.stringify([
    'gateway-charge-v1',
    input.organizationId,
    input.environment,
    input.accountId,
    input.currency,
    input.amountMinor,
    input.usdcMinor,
    input.chainId,
    input.gatewayWallet.toLowerCase(),
    input.tokenAddress.toLowerCase(),
    input.depositor?.toLowerCase() ?? null,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Cria a cobrança Gateway em UMA transação SQLite, com autoridade total do servidor:
 * resolve configuração (gatewayConfigFor), valores (parseExactDecimal), obrigação (razão),
 * fingerprint (SHA-256) e vencimento. Valida o saldo disponível dentro da transação.
 */
export function createGatewayCharge(db: LedgerDb, orgId: string, environment: GatewayEnvironment, input: CreateCommercialChargeInput, depositor: string | null): CreateGatewayChargeResult {
  if (!ENVIRONMENTS.has(environment) || !input.idempotencyKey || !input.amountDecimal) return { ok: false, reason: 'invalid_input' }

  let cfg
  try {
    cfg = gatewayConfigFor(environment)
  } catch {
    return { ok: false, reason: 'invalid_input' }
  }

  // Depositor autoritativo: nunca o GatewayWallet, nunca vindo do cliente.
  const resolvedDepositor = depositor && validateBeneficiary(depositor, environment).ok ? depositor : null
  if (depositor && !resolvedDepositor) return { ok: false, reason: 'unresolved_depositor' }

  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + CHARGE_TTL_MS).toISOString()
  const intentId = randomUUID()
  const { token, tokenHash } = generateCheckoutToken()

  const run = db.db.transaction((): CreateGatewayChargeResult => {
    const ledger = db.loadLedger(orgId) ?? emptyLedger(orgId)

    // 1. Resolver obrigação (moeda e conta) — do RAZÃO, nunca do cliente.
    let accountId = input.accountId
    let currency: string
    if (accountId) {
      const c = obligationCurrency(ledger, accountId)
      if (!c) return { ok: false, reason: 'obligation_not_found' }
      currency = c
    } else {
      if (!input.description || !input.currency || !(input.currency in EXPONENT)) return { ok: false, reason: 'invalid_currency' }
      currency = input.currency
      accountId = randomUUID()
      const created = postEvent(
        ledger,
        {
          orgId,
          idempotencyKey: `receivable:${accountId}`,
          type: 'receivable.created',
          source: { module: 'receivables', recordId: accountId },
          occurredAt: now,
          accountingDate: now.slice(0, 10),
          currency: currency as CurrencyCode,
          amountMinor: parseExactDecimal(input.amountDecimal, EXPONENT[currency as keyof typeof EXPONENT]).toString(),
          payload: { accountId, category: 'Serviços prestados' },
          confirmation: 'confirmed',
        },
        { now, actor: OWNER_ACTOR },
      )
      if (!created.ok) return { ok: false, reason: 'invalid_input' }
      db.saveLedger(orgId, created.ledger, now)
    }

    // 2. Resolver valores exatos (moeda contábil → USDC). Sem float.
    let amountMinor: bigint
    let usdcMinor: bigint
    try {
      const exp = EXPONENT[currency as keyof typeof EXPONENT]
      if (currency === 'USDC') {
        usdcMinor = parseExactDecimal(input.amountDecimal, 6)
        amountMinor = usdcMinor
      } else {
        // Moeda não-USDC exige cotação autoritativa (razão) — pendente nesta fase.
        amountMinor = parseExactDecimal(input.amountDecimal, exp)
        return { ok: false, reason: 'invalid_currency' }
      }
    } catch {
      return { ok: false, reason: 'invalid_amount' }
    }

    // 3. Validação de saldo disponível (obrigação − reservas ativas) dentro da transação.
    const outstanding = obligationOutstandingMinor(ledger, accountId)
    const reservations = db.db
      .query('SELECT amount_minor, state FROM payment_reservations WHERE organization_id = ? AND environment = ? AND account_id = ?')
      .all(orgId, environment, accountId) as { amount_minor: string; state: string }[]
    const reservedMinor = reservations
      .filter((r) => r.state === 'HELD' || r.state === 'REQUIRES_REVIEW')
      .reduce((sum, r) => sum + parseMinorUnits(r.amount_minor), 0n)
    if (amountMinor <= 0n || amountMinor > outstanding - reservedMinor) return { ok: false, reason: 'insufficient_balance' }

    // 4. Fingerprint autoritativo.
    const fingerprint = computeChargeFingerprint({ organizationId: orgId, environment, accountId, currency, amountMinor: String(amountMinor), usdcMinor: String(usdcMinor), chainId: cfg.chainId, gatewayWallet: cfg.gatewayWallet, tokenAddress: cfg.usdcToken, depositor: resolvedDepositor })

    // 5. Idempotência (org+env+chave).
    const existing = db.db
      .query('SELECT intent_id, fingerprint FROM payment_intents WHERE organization_id = ? AND environment = ? AND idempotency_key = ?')
      .get(orgId, environment, input.idempotencyKey) as { intent_id: string; fingerprint: string } | undefined
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { ok: false, reason: 'duplicate_conflict' }
      db.db.query('INSERT INTO checkout_tokens (token_hash, intent_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, existing.intent_id, now, expiresAt)
      return { ok: true, intentId: existing.intent_id, checkoutToken: token, configurationPending: !resolvedDepositor }
    }

    // 6. Persistir intenção + reserva + token (atomicamente).
    db.db
      .query(
        `INSERT INTO payment_intents (intent_id, organization_id, environment, account_id, chain_id, token_address, gateway_wallet, depositor, currency, amount_minor, usdc_minor, idempotency_key, fingerprint, state, company, description, reference, created_at, expires_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, ?, ?, 0)`,
      )
      .run(intentId, orgId, environment, accountId, cfg.chainId, cfg.usdcToken, cfg.gatewayWallet, resolvedDepositor, currency, String(amountMinor), String(usdcMinor), input.idempotencyKey, fingerprint, input.companyName, input.publicDescription ?? null, input.publicReference ?? null, now, expiresAt)

    db.db
      .query('INSERT INTO payment_reservations (reservation_id, intent_id, organization_id, environment, account_id, currency, amount_minor, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), intentId, orgId, environment, accountId, currency, String(amountMinor), 'HELD', now)

    db.db.query('INSERT INTO checkout_tokens (token_hash, intent_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, intentId, now, expiresAt)

    return { ok: true, intentId, checkoutToken: token, configurationPending: !resolvedDepositor }
  })

  return run()
}

// -----------------------------------------------------------------------------------------------------------
// Consulta pública
// -----------------------------------------------------------------------------------------------------------

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

function isActiveCheckoutToken(tokenExpiresAt: string, intentExpiresAt: string, now: number): boolean {
  const tokenExpiry = Date.parse(tokenExpiresAt)
  const intentExpiry = Date.parse(intentExpiresAt)
  return Number.isFinite(tokenExpiry) && Number.isFinite(intentExpiry) && tokenExpiry > now && intentExpiry > now
}

/** Consulta pública mínima do checkout por token opaco — nunca expõe dados privados da organização. */
export function getPublicCheckout(db: LedgerDb, token: string): PublicCheckout | null {
  if (!isCheckoutTokenValid(token)) return null
  const tokenHash = hashCheckoutToken(token)
  const row = db.db
    .query(
      `SELECT pi.reference, pi.company, pi.description, pi.environment, pi.chain_id, pi.token_address, pi.gateway_wallet, pi.depositor, pi.usdc_minor, pi.expires_at, pi.state, ct.expires_at AS token_expires_at
       FROM checkout_tokens ct JOIN payment_intents pi ON pi.intent_id = ct.intent_id
       WHERE ct.token_hash = ? AND ct.revoked_at IS NULL`,
    )
    .get(tokenHash) as (CheckoutRow & { token_expires_at: string }) | undefined
  if (!row) return null
  const paymentReady = row.depositor != null && row.state === 'CREATED' && isActiveCheckoutToken(row.token_expires_at, row.expires_at, Date.now())
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
