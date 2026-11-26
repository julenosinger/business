import { describe, expect, test } from 'bun:test'
import {
  parseUsdcMinor,
  parseMinorUnits,
  validateUsdcAmount,
  isValidTxHash,
  normalizeTxHash,
  scopedIdempotencyKey,
  intentFingerprint,
  matchesIntentScope,
  availableForReservation,
  authorizeIntentTransition,
  type IntentTransitionContext,
} from '../src/lib/payment-intent'

const ctx = (overrides: Partial<IntentTransitionContext> = {}): IntentTransitionContext => ({
  source: 'system',
  sameOrganization: true,
  sameEnvironment: true,
  expired: false,
  hasActiveAttempt: true,
  hasDepositHash: true,
  submissionUnresolved: false,
  hasVerifiedReceipt: false,
  hasVerifiedRevert: false,
  safeCancellation: true,
  ...overrides,
})

describe('Exact USDC precision', () => {
  test('15 USDC exact', () => {
    expect(parseUsdcMinor('15')).toBe(15_000_000n)
  })
  test('minimum unit', () => {
    expect(parseUsdcMinor('0.000001')).toBe(1n)
  })
  test('trailing fraction zeros are exact', () => {
    expect(parseUsdcMinor('15.000000')).toBe(15_000_000n)
  })
  test('reject excess precision', () => {
    expect(() => parseUsdcMinor('15.0000001')).toThrow()
  })
  test('reject scientific notation', () => {
    expect(() => parseUsdcMinor('1e6')).toThrow()
  })
  test('reject zero amount', () => {
    expect(() => parseUsdcMinor('0')).toThrow()
  })
  test('reject negative', () => {
    expect(() => parseUsdcMinor('-1')).toThrow()
  })
  test('reject mismatched amount', () => {
    expect(validateUsdcAmount('15', '150000000')).toBe(false)
  })
  test('accept matched amount', () => {
    expect(validateUsdcAmount('15', '15000000')).toBe(true)
  })
  test('reject uint256 overflow', () => {
    expect(() => parseMinorUnits(String(1n << 256n))).toThrow()
  })
  test('reject non-integer minor units', () => {
    expect(() => parseMinorUnits('12.3')).toThrow()
  })
  test('reject zero minor units', () => {
    expect(() => parseMinorUnits('0')).toThrow()
  })
})

describe('Transaction hash validation', () => {
  const hash = '0x' + 'ab'.repeat(32)
  test('accepts a valid 64-hex hash', () => {
    expect(isValidTxHash(hash)).toBe(true)
  })
  test('normalizes to lowercase', () => {
    expect(normalizeTxHash('0x' + 'AB'.repeat(32))).toBe(hash)
  })
  test('rejects zero hash', () => {
    expect(isValidTxHash('0x' + '0'.repeat(64))).toBe(false)
  })
  test('rejects short hash', () => {
    expect(isValidTxHash('0x1234')).toBe(false)
  })
  test('rejects non-string', () => {
    expect(isValidTxHash(123)).toBe(false)
  })
  test('normalizeTxHash throws on invalid', () => {
    expect(() => normalizeTxHash('0x1234')).toThrow()
  })
})

describe('Scoped idempotency', () => {
  test('same scope and key produce a stable key', () => {
    const a = scopedIdempotencyKey({ organizationId: 'o1', environment: 'mainnet' }, 'k1')
    const b = scopedIdempotencyKey({ organizationId: 'o1', environment: 'mainnet' }, 'k1')
    expect(a).toBe(b)
  })
  test('different environments do not collide', () => {
    const a = scopedIdempotencyKey({ organizationId: 'o1', environment: 'mainnet' }, 'k1')
    const b = scopedIdempotencyKey({ organizationId: 'o1', environment: 'testnet' }, 'k1')
    expect(a).not.toBe(b)
  })
  test('different organizations do not collide', () => {
    const a = scopedIdempotencyKey({ organizationId: 'o1', environment: 'mainnet' }, 'k1')
    const b = scopedIdempotencyKey({ organizationId: 'o2', environment: 'mainnet' }, 'k1')
    expect(a).not.toBe(b)
  })
  test('rejects empty key', () => {
    expect(() => scopedIdempotencyKey({ organizationId: 'o1', environment: 'mainnet' }, '  ')).toThrow()
  })
  test('rejects oversized key', () => {
    expect(() => scopedIdempotencyKey({ organizationId: 'o1', environment: 'mainnet' }, 'x'.repeat(129))).toThrow()
  })
})

describe('Intent fingerprint and scope', () => {
  const base = {
    organizationId: 'o1',
    environment: 'mainnet',
    accountId: 'a1',
    currency: 'USDC',
    amountMinor: '15000000',
    usdcMinor: '15000000',
    beneficiary: '0x000000000000000000000000000000000000000A',
    gatewayWallet: '0x0000000000000000000000000000000000000001',
    token: '0x3600000000000000000000000000000000000000',
    chainId: 5042,
    expiresAt: '2099-01-01T00:00:00.000Z',
  }
  test('identical parameters produce identical fingerprint', () => {
    expect(intentFingerprint(base)).toBe(intentFingerprint(base))
  })
  test('different amount produces a different fingerprint', () => {
    expect(intentFingerprint({ ...base, usdcMinor: '25000000' })).not.toBe(intentFingerprint(base))
  })
  test('matchesIntentScope checks chain id per environment', () => {
    expect(matchesIntentScope({ organizationId: 'o1', environment: 'mainnet', chainId: 5042 }, { organizationId: 'o1', environment: 'mainnet' })).toBe(true)
    expect(matchesIntentScope({ organizationId: 'o1', environment: 'mainnet', chainId: 5042002 }, { organizationId: 'o1', environment: 'mainnet' })).toBe(false)
  })
})

describe('Financial reservations', () => {
  test('computes available as outstanding minus reserved', () => {
    expect(availableForReservation(40_000_000n, 15_000_000n)).toBe(25_000_000n)
  })
  test('floors at zero', () => {
    expect(availableForReservation(10n, 20n)).toBe(0n)
  })
  test('rejects negative inputs', () => {
    expect(() => availableForReservation(-1n, 0n)).toThrow()
    expect(() => availableForReservation(0n, -1n)).toThrow()
  })
})

describe('authorizeIntentTransition (evidence-gated)', () => {
  test('blocks SUBMITTED without a deposit hash', () => {
    expect(authorizeIntentTransition('AWAITING_SIGNATURE', 'SUBMITTED', ctx({ hasDepositHash: false }))).toBe(false)
  })
  test('blocks SUBMITTED without an active attempt', () => {
    expect(authorizeIntentTransition('AWAITING_SIGNATURE', 'SUBMITTED', ctx({ hasActiveAttempt: false }))).toBe(false)
  })
  test('allows SUBMITTED with attempt and hash (system source)', () => {
    expect(authorizeIntentTransition('AWAITING_SIGNATURE', 'SUBMITTED', ctx())).toBe(true)
  })
  test('blocks user-driven SUBMITTED (protected state)', () => {
    expect(authorizeIntentTransition('AWAITING_SIGNATURE', 'SUBMITTED', ctx({ source: 'user' }))).toBe(false)
  })
  test('blocks ONCHAIN_CONFIRMED without verifier evidence', () => {
    expect(authorizeIntentTransition('SUBMITTED', 'ONCHAIN_CONFIRMED', ctx())).toBe(false)
  })
  test('allows ONCHAIN_CONFIRMED with verifier + verified receipt', () => {
    expect(authorizeIntentTransition('SUBMITTED', 'ONCHAIN_CONFIRMED', ctx({ source: 'verifier', hasVerifiedReceipt: true }))).toBe(true)
  })
  test('blocks CANCELED while a submission is unresolved', () => {
    expect(authorizeIntentTransition('AWAITING_WALLET', 'CANCELED', ctx({ submissionUnresolved: true, hasDepositHash: true }))).toBe(false)
  })
  test('blocks FAILED with a deposit hash but no verified revert', () => {
    expect(authorizeIntentTransition('SUBMITTED', 'FAILED', ctx())).toBe(false)
  })
  test('allows FAILED with verified revert from verifier', () => {
    expect(authorizeIntentTransition('SUBMITTED', 'FAILED', ctx({ source: 'verifier', hasVerifiedRevert: true, hasDepositHash: true }))).toBe(true)
  })
  test('blocks cross-organization and cross-environment', () => {
    expect(authorizeIntentTransition('CREATED', 'AWAITING_WALLET', ctx({ sameOrganization: false }))).toBe(false)
    expect(authorizeIntentTransition('CREATED', 'AWAITING_WALLET', ctx({ sameEnvironment: false }))).toBe(false)
  })
  test('blocks expired non-release transition', () => {
    expect(authorizeIntentTransition('CREATED', 'AWAITING_WALLET', ctx({ expired: true, hasDepositHash: false }))).toBe(false)
  })
  test('blocks CREATED → ONCHAIN_CONFIRMED regardless of evidence', () => {
    expect(authorizeIntentTransition('CREATED', 'ONCHAIN_CONFIRMED', ctx({ source: 'verifier', hasVerifiedReceipt: true }))).toBe(false)
  })
  test('same-state transition is idempotent', () => {
    expect(authorizeIntentTransition('CREATED', 'CREATED', ctx())).toBe(true)
  })
})
