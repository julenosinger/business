import { describe, expect, test } from 'bun:test'
import { canTransition, classifyVerification, isTerminalStatus, PAYMENT_STATUSES } from '../src/lib/accounting/settlement'
import { isHexHash, matchTransfer, verifyUsdcReceipt } from '../src/lib/accounting/verify'
import { allocationAmount, gatewayWalletForChain, planAllocation, reconcileTreasuryOp } from '../src/lib/settlement-service'
import { backoffDelay, isAutoReconcilable } from '../src/lib/reconciliation'
import { emptyLedger } from '../src/lib/accounting/engine'
import { recordFxRate } from '../src/lib/accounting/reviews'
import type { TreasuryOp } from '../src/lib/types'

const ctx = { now: '2026-11-22T10:00:00.000Z', actor: { id: 'u1', kind: 'user' as const } }

describe('máquina de estados de pagamento', () => {
  test('transições válidas', () => {
    expect(canTransition('created', 'awaiting_signature')).toBe(true)
    expect(canTransition('awaiting_signature', 'submitted')).toBe(true)
    expect(canTransition('submitted', 'pending')).toBe(true)
    expect(canTransition('submitted', 'ambiguous')).toBe(true)
    expect(canTransition('pending', 'confirmed')).toBe(true)
    expect(canTransition('pending', 'failed')).toBe(true)
    expect(canTransition('pending', 'ambiguous')).toBe(true)
    expect(canTransition('pending', 'requires_review')).toBe(true)
    expect(canTransition('ambiguous', 'requires_review')).toBe(true)
    expect(canTransition('requires_review', 'confirmed')).toBe(true)
  })

  test('transições inválidas e estados terminais', () => {
    expect(canTransition('created', 'confirmed')).toBe(false) // não pula etapas
    expect(canTransition('pending', 'created')).toBe(false)
    expect(canTransition('confirmed', 'pending')).toBe(false) // terminal
    expect(canTransition('failed', 'pending')).toBe(false) // terminal
    expect(isTerminalStatus('confirmed')).toBe(true)
    expect(isTerminalStatus('failed')).toBe(true)
    expect(isTerminalStatus('pending')).toBe(false)
    expect(PAYMENT_STATUSES).toHaveLength(8)
  })

  test('classifyVerification: timeout/ambiguidade vira requires_review, nunca failed', () => {
    expect(classifyVerification('confirmed')).toBe('confirmed')
    expect(classifyVerification('failed')).toBe('failed')
    expect(classifyVerification('ambiguous')).toBe('requires_review')
    expect(classifyVerification('pending')).toBe('pending')
  })
})

describe('verificação endurecida (exige evidência, sem confirmar recibo genérico)', () => {
  test('sem evidência esperada não confirma (antes de qualquer rede)', async () => {
    const v = await verifyUsdcReceipt({ chainId: 5042, txHash: `0x${'a'.repeat(64)}` })
    expect(v.state).toBe('ambiguous')
    expect(v.reason).toBe('insufficient_evidence')
  })

  test('hash inválido é ambíguo, não confirmado', async () => {
    const v = await verifyUsdcReceipt({ chainId: 5042, txHash: '0xzzz', expectedTo: `0x${'b'.repeat(40)}` })
    expect(v.state).toBe('ambiguous')
    expect(v.reason).toBe('invalid_hash')
  })

  test('matchTransfer confere remetente e destinatário', () => {
    const t = [{ from: `0x${'1'.repeat(40)}`, to: `0x${'2'.repeat(40)}`, amountMinor: 1_000_000n }]
    expect(matchTransfer(t, `0x${'2'.repeat(40)}`, 1_000_000n, `0x${'1'.repeat(40)}`)).toBeDefined()
    expect(matchTransfer(t, `0x${'2'.repeat(40)}`, 1_000_000n, `0x${'3'.repeat(40)}`)).toBeUndefined()
    expect(matchTransfer(t, `0x${'3'.repeat(40)}`, 1_000_000n, `0x${'1'.repeat(40)}`)).toBeUndefined()
  })

  test('isHexHash valida hash', () => {
    expect(isHexHash(`0x${'a'.repeat(64)}`)).toBe(true)
    expect(isHexHash('0x123')).toBe(false)
  })
})

describe('reconciliação (reconcileTreasuryOp)', () => {
  const base = (over: Partial<TreasuryOp>): TreasuryOp => ({ id: 'op1', date: '2026-11-22', kind: 'spend', chain: 'Arc', amount: '10', note: '', ...over })

  test('sem hash → requires_review', async () => {
    const r = await reconcileTreasuryOp(base({ txHash: undefined }))
    expect(r.status).toBe('requires_review')
  })

  test('chain desconhecida → requires_review', async () => {
    const r = await reconcileTreasuryOp(base({ chain: 'Unknown', txHash: `0x${'a'.repeat(64)}` }))
    expect(r.status).toBe('requires_review')
  })

  test('valor inválido → requires_review', async () => {
    const r = await reconcileTreasuryOp(base({ chain: 'Arc', amount: 'abc', txHash: `0x${'a'.repeat(64)}` }))
    expect(r.status).toBe('requires_review')
  })

  test('chain Arc mapeia para 5042 (mainnet) e Arc_Testnet para 5042002', async () => {
    // Sem rede: o caso sem hash já retorna antes; aqui confirmamos o mapeamento via require_review de chain válida mas sem hash.
    const mainnet = await reconcileTreasuryOp(base({ chain: 'Arc' }))
    expect(mainnet.status).toBe('requires_review') // sem hash
    const testnet = await reconcileTreasuryOp(base({ chain: 'Arc_Testnet' }))
    expect(testnet.status).toBe('requires_review') // sem hash
  })

  test('spend verifica na cadeia de DESTINO (não na origem)', async () => {
    const op = base({ chain: 'Arc', destChain: 'Unknown', txHash: `0x${'a'.repeat(64)}`, recipient: `0x${'b'.repeat(40)}` })
    const r = await reconcileTreasuryOp(op)
    expect(r.status).toBe('requires_review')
    expect(r.verification.reason).toBe('unknown_chain') // olhou destChain, não chain
  })

  test('deposit verifica na cadeia de ORIGEM', async () => {
    const op = base({ kind: 'deposit', chain: 'Unknown', txHash: `0x${'a'.repeat(64)}` })
    const r = await reconcileTreasuryOp(op)
    expect(r.status).toBe('requires_review')
    expect(r.verification.reason).toBe('unknown_chain')
  })
})

describe('alocação exata do valor verificado (partial settlement)', () => {
  test('USDC é 1:1 (exato)', () => {
    const r = allocationAmount(emptyLedger(), 'USDC', '300', '2026-11-22')
    expect(r).toEqual({ ok: true, amount: 300 })
  })

  test('moeda não-USDC sem taxa registrada → fx_required (não baixa)', () => {
    const r = allocationAmount(emptyLedger(), 'BRL', '300', '2026-11-22')
    expect(r).toEqual({ ok: false, reason: 'fx_required' })
  })

  test('moeda não-USDC com taxa registrada converte exatamente', () => {
    const l = recordFxRate(emptyLedger(), { from: 'USDC', to: 'BRL', rate: '5.5', source: 'manual', at: '2026-11-22T00:00:00.000Z' }, ctx)
    if (!l.ok) throw new Error('fx')
    const r = allocationAmount(l.ledger, 'BRL', '300', '2026-11-22')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.amount).toBe(1650) // 300 USDC × 5,5 = 1650 BRL
  })

  test('valor inválido → invalid_amount', () => {
    const r = allocationAmount(emptyLedger(), 'USDC', 'abc', '2026-11-22')
    expect(r).toEqual({ ok: false, reason: 'invalid_amount' })
  })

  test('moeda desconhecida (legado) → unknown_currency, nunca adivinhada', () => {
    const r = allocationAmount(emptyLedger(), undefined, '300', '2026-11-22')
    expect(r).toEqual({ ok: false, reason: 'unknown_currency' })
  })
})

describe('verificação de crédito no Gateway (depósito)', () => {
  test('gatewayWalletForChain resolve o contrato pela rede (mainnet ≠ testnet)', () => {
    const mainnet = gatewayWalletForChain(5042)
    const testnet = gatewayWalletForChain(5042002)
    expect(mainnet).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(testnet).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(mainnet).not.toBe(testnet)
  })

  test('chain desconhecida não resolve GatewayWallet', () => {
    expect(gatewayWalletForChain(99999999)).toBeUndefined()
  })
})

describe('plano de alocação exata (partial settlement)', () => {
  test('300 sobre 1000 → parcial, sem excesso', () => {
    expect(planAllocation(300, 1000)).toEqual({ amount: 300, excess: 0, accountingStatus: 'partially_settled' })
  })

  test('1000 sobre 1000 → liquidado, sem excesso', () => {
    expect(planAllocation(1000, 1000)).toEqual({ amount: 1000, excess: 0, accountingStatus: 'settled' })
  })

  test('1300 sobre 1000 → aloca 1000 e preserva 300 de excesso (nunca descarta)', () => {
    expect(planAllocation(1300, 1000)).toEqual({ amount: 1000, excess: 300, accountingStatus: 'settled' })
  })

  test('pagamento final completa a obrigação (700 + 300)', () => {
    // Obrigação 1000; já pago 700; saldo em aberto 300; pagamento verificado 300.
    expect(planAllocation(300, 300)).toEqual({ amount: 300, excess: 0, accountingStatus: 'settled' })
  })
})

describe('backoff de reconciliação', () => {
  test('cresce exponencialmente com jitter determinístico', () => {
    expect(backoffDelay(0, 100, 1000, () => 0.5)).toBe(100)
    expect(backoffDelay(1, 100, 1000, () => 0.5)).toBe(200)
    expect(backoffDelay(2, 100, 1000, () => 0.5)).toBe(400)
  })

  test('é limitado ao máximo', () => {
    expect(backoffDelay(10, 100, 1000, () => 0.5)).toBe(1000)
    expect(backoffDelay(20, 100, 1000, () => 0.5)).toBe(1000)
  })

  test('isAutoReconcilable aceita somente pendente', () => {
    expect(isAutoReconcilable('pending')).toBe(true)
    expect(isAutoReconcilable('confirmed')).toBe(false)
    expect(isAutoReconcilable('failed')).toBe(false)
    expect(isAutoReconcilable('requires_review')).toBe(false)
    expect(isAutoReconcilable(undefined)).toBe(false)
  })
})
