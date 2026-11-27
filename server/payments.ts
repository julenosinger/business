/**
 * Checkout comercial Circle Gateway — persistência compartilhada e segurança criptográfica
 * (FIN-04.1B.2.2B.2). O servidor é a fonte AUTORITATIVA: resolve configuração blockchain,
 * valores monetários, fingerprint e vencimento — nunca confia nesses campos vindos do navegador.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import type { LedgerDb } from './db'
import { gatewayConfigFor, validateBeneficiary } from '../src/lib/gateway-config'
import { parseMinorUnits, parseExactDecimal, convertToUsdcMinor } from '../src/lib/payment-intent'
import { EXPONENT, parseRate } from '../src/lib/accounting/money'
import { emptyLedger, postEvent } from '../src/lib/accounting/engine'
import { obligationOutstandingMinor, obligationCurrency } from './settle'
import { getObligation } from './obligations'
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

    // 1. Resolver obrigação (moeda e conta) — da projeção autoritativa sincronizada, com fallback para o razão.
    let accountId = input.accountId
    let currency: string
    let syncedOutstanding: bigint | null = null
    if (accountId) {
      const synced = getObligation(db, orgId, environment, accountId)
      if (synced) {
        currency = synced.currency
        syncedOutstanding = BigInt(synced.outstandingMinor)
      } else {
        const c = obligationCurrency(ledger, accountId)
        if (!c) return { ok: false, reason: 'obligation_not_found' }
        currency = c
      }
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
        // Moeda não-USDC: reserva em unidades menores da moeda original; transação em USDC
        // via cotação autoritativa do RAZÃO ("moeda original por 1 USDC"). Sem conversão 1:1.
        amountMinor = parseExactDecimal(input.amountDecimal, exp)
        const fx = ledger.fxRates.find((r) => r.from === 'USDC' && r.to === currency)
        if (!fx) return { ok: false, reason: 'invalid_currency' }
        const rate = parseRate(fx.rate)
        if (!rate) return { ok: false, reason: 'invalid_currency' }
        const rateDecimals = (fx.rate.split('.')[1] ?? '').length
        usdcMinor = convertToUsdcMinor(amountMinor, exp, rate.num, rateDecimals)
      }
    } catch {
      return { ok: false, reason: 'invalid_amount' }
    }

    // 3. Validação de saldo disponível (obrigação − reservas ativas) dentro da transação.
    const outstanding = syncedOutstanding ?? obligationOutstandingMinor(ledger, accountId)
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

// -----------------------------------------------------------------------------------------------------------
// Consulta do comerciante (autenticada)
// -----------------------------------------------------------------------------------------------------------

export interface PaymentIntentSummary {
  intentId: string
  environment: GatewayEnvironment
  accountId: string
  currency: string
  amountMinor: string
  usdcMinor: string
  state: string
  createdAt: string
  expiresAt: string
  transactionHash: string | null
}

export function listPaymentIntents(db: LedgerDb, orgId: string, environment: GatewayEnvironment): PaymentIntentSummary[] {
  const rows = db.db
    .query(
      `SELECT pi.intent_id, pi.environment, pi.account_id, pi.currency, pi.amount_minor, pi.usdc_minor, pi.state, pi.created_at, pi.expires_at,
              (SELECT deposit_hash FROM payment_attempts pa WHERE pa.intent_id = pi.intent_id AND pa.deposit_hash IS NOT NULL LIMIT 1) AS tx_hash
       FROM payment_intents pi
       WHERE pi.organization_id = ? AND pi.environment = ?
       ORDER BY pi.created_at DESC`,
    )
    .all(orgId, environment) as { intent_id: string; environment: string; account_id: string; currency: string; amount_minor: string; usdc_minor: string; state: string; created_at: string; expires_at: string; tx_hash: string | null }[]
  return rows.map((r) => ({
    intentId: r.intent_id,
    environment: r.environment as GatewayEnvironment,
    accountId: r.account_id,
    currency: r.currency,
    amountMinor: r.amount_minor,
    usdcMinor: r.usdc_minor,
    state: r.state,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    transactionHash: r.tx_hash,
  }))
}

export function getPaymentIntent(db: LedgerDb, orgId: string, intentId: string): PaymentIntentSummary | null {
  const r = db.db
    .query(
      `SELECT intent_id, environment, account_id, currency, amount_minor, usdc_minor, state, created_at, expires_at
       FROM payment_intents WHERE intent_id = ? AND organization_id = ?`,
    )
    .get(intentId, orgId) as { intent_id: string; environment: string; account_id: string; currency: string; amount_minor: string; usdc_minor: string; state: string; created_at: string; expires_at: string } | undefined
  if (!r) return null
  return { intentId: r.intent_id, environment: r.environment as GatewayEnvironment, accountId: r.account_id, currency: r.currency, amountMinor: r.amount_minor, usdcMinor: r.usdc_minor, state: r.state, createdAt: r.created_at, expiresAt: r.expires_at, transactionHash: null }
}

export type ShareResult = { ok: true; checkoutToken: string; expiresAt: string } | { ok: false; reason: 'not_found' }

/** Reemite o link para uma intenção existente (sem duplicar intenção/reserva). */
export function sharePaymentIntent(db: LedgerDb, orgId: string, intentId: string): ShareResult {
  const intent = db.db.query('SELECT expires_at FROM payment_intents WHERE intent_id = ? AND organization_id = ?').get(intentId, orgId) as { expires_at: string } | undefined
  if (!intent) return { ok: false, reason: 'not_found' }
  const { token, tokenHash } = generateCheckoutToken()
  const now = new Date().toISOString()
  db.db.query('INSERT INTO checkout_tokens (token_hash, intent_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, intentId, now, intent.expires_at)
  return { ok: true, checkoutToken: token, expiresAt: intent.expires_at }
}

// -----------------------------------------------------------------------------------------------------------
// Tentativas e execução (checkout público)
// -----------------------------------------------------------------------------------------------------------

export type AttemptResult = { ok: true; attemptId: string } | { ok: false; reason: string }
export type HashResult = { ok: true; hash: string; replay: boolean } | { ok: false; reason: string }

const ACTIVE_ATTEMPT_STATES = ['CREATED', 'AWAITING_APPROVAL', 'APPROVAL_PENDING', 'READY_TO_DEPOSIT', 'AWAITING_SIGNATURE', 'SUBMITTED', 'AMBIGUOUS', 'REQUIRES_REVIEW']

function findIntentByToken(db: LedgerDb, token: string): { intent_id: string; organization_id: string; environment: string; state: string; depositor: string | null; expires_at: string } | null {
  if (!isCheckoutTokenValid(token)) return null
  const row = db.db
    .query('SELECT pi.intent_id, pi.organization_id, pi.environment, pi.state, pi.depositor, pi.expires_at FROM checkout_tokens ct JOIN payment_intents pi ON pi.intent_id = ct.intent_id WHERE ct.token_hash = ? AND ct.revoked_at IS NULL')
    .get(hashCheckoutToken(token)) as { intent_id: string; organization_id: string; environment: string; state: string; depositor: string | null; expires_at: string } | undefined
  return row ?? null
}

/** Cria uma tentativa autorizada para uma intenção pagável (uma tentativa ativa por vez). */
export function createCheckoutAttempt(db: LedgerDb, token: string, payer: string): AttemptResult {
  const intent = findIntentByToken(db, token)
  if (!intent) return { ok: false, reason: 'checkout_unavailable' }
  if (intent.depositor == null || intent.state !== 'CREATED' || Date.parse(intent.expires_at) <= Date.now()) return { ok: false, reason: 'checkout_unavailable' }
  if (typeof payer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(payer)) return { ok: false, reason: 'invalid_payer' }
  const active = db.db
    .query(`SELECT COUNT(*) AS c FROM payment_attempts WHERE intent_id = ? AND state IN (${ACTIVE_ATTEMPT_STATES.map(() => '?').join(',')})`)
    .get(intent.intent_id, ...ACTIVE_ATTEMPT_STATES) as { c: number }
  if (active.c > 0) return { ok: false, reason: 'attempt_requires_recovery' }
  const attemptId = randomUUID()
  const now = new Date().toISOString()
  db.db
    .query('INSERT INTO payment_attempts (attempt_id, intent_id, organization_id, environment, chain_id, payer, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(attemptId, intent.intent_id, intent.organization_id, intent.environment, 0, payer, 'CREATED', now, now)
  return { ok: true, attemptId }
}

/** Persiste o início da submissão (AWAITING_SIGNATURE) ANTES da chamada à carteira. */
export function beginDepositSubmission(db: LedgerDb, token: string, attemptId: string, payer: string): { ok: true } | { ok: false; reason: string } {
  const intent = findIntentByToken(db, token)
  if (!intent) return { ok: false, reason: 'checkout_unavailable' }
  if (typeof payer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(payer)) return { ok: false, reason: 'invalid_payer' }
  const attempt = db.db.query('SELECT intent_id, state FROM payment_attempts WHERE attempt_id = ?').get(attemptId) as { intent_id: string; state: string } | undefined
  if (!attempt || attempt.intent_id !== intent.intent_id) return { ok: false, reason: 'attempt_not_found' }
  if (attempt.state !== 'CREATED' && attempt.state !== 'READY') return { ok: false, reason: 'invalid_attempt_state' }
  db.db.query('UPDATE payment_attempts SET payer = ?, state = ?, submission_started_at = ?, updated_at = ? WHERE attempt_id = ?').run(payer, 'AWAITING_SIGNATURE', new Date().toISOString(), new Date().toISOString(), attemptId)
  return { ok: true }
}

/** Registra o hash do depósito (imutável; replay idempotente). Exige submissão iniciada. */
export function registerDepositSubmission(db: LedgerDb, token: string, attemptId: string, txHash: string): HashResult {
  if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) return { ok: false, reason: 'invalid_hash' }
  const hash = txHash.toLowerCase()
  const attempt = db.db.query('SELECT * FROM payment_attempts WHERE attempt_id = ?').get(attemptId) as { deposit_hash: string | null; state: string; submission_started_at: string | null } | undefined
  if (!attempt) return { ok: false, reason: 'attempt_not_found' }
  if (attempt.deposit_hash) return attempt.deposit_hash.toLowerCase() === hash ? { ok: true, hash, replay: true } : { ok: false, reason: 'hash_conflict' }
  if (attempt.state !== 'AWAITING_SIGNATURE' && attempt.state !== 'AMBIGUOUS') return { ok: false, reason: 'invalid_submission_state' }
  if (!attempt.submission_started_at) return { ok: false, reason: 'submission_not_started' }
  db.db.query('UPDATE payment_attempts SET deposit_hash = ?, state = ?, updated_at = ? WHERE attempt_id = ?').run(hash, 'SUBMITTED', new Date().toISOString(), attemptId)
  return { ok: true, hash, replay: false }
}

/** Consulta de progresso pública (estado da intenção + tentativas). */
export function getCheckoutStatus(db: LedgerDb, token: string): { intentId: string; state: string; attempts: { attemptId: string; state: string; depositHash: string | null }[] } | null {
  const intent = findIntentByToken(db, token)
  if (!intent) return null
  const attempts = db.db
    .query('SELECT attempt_id, state, deposit_hash FROM payment_attempts WHERE intent_id = ? ORDER BY created_at DESC')
    .all(intent.intent_id) as { attempt_id: string; state: string; deposit_hash: string | null }[]
  return { intentId: intent.intent_id, state: intent.state, attempts: attempts.map((a) => ({ attemptId: a.attempt_id, state: a.state, depositHash: a.deposit_hash })) }
}
