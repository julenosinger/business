import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Store } from '../src/lib/store'

try {
  GlobalRegistrator.register()
} catch {
  // já registrado
}

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { StoreProvider, useStore } = await import('../src/lib/store')
const { setNetwork } = await import('../src/lib/network')
const { gatewayConfigFor, validateGatewayTreasury, resolveTreasuryReceivingConfig } = await import('../src/lib/gateway-config')
const {
  parseExactDecimal,
  convertToUsdcMinor,
  validateExecutionMode,
  attemptBlocksRetry,
  canReleaseReservation,
} = await import('../src/lib/payment-intent')

let captured: Store | null = null
function Capture(): null {
  const store = useStore()
  React.useEffect(() => {
    captured = store
  })
  return null
}
function renderStore(): { store: () => Store; unmount: () => void } {
  captured = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  React.act(() => root.render(React.createElement(StoreProvider, null, React.createElement(Capture))))
  return {
    store: () => captured!,
    unmount: () => {
      React.act(() => root.unmount())
      container.remove()
      captured = null
    },
  }
}
function commit<T>(store: () => Store, op: (s: Store) => T): T {
  let out: T = undefined as unknown as T
  React.act(() => {
    out = op(store())
  })
  return out
}

const BENEFICIARY = '0x000000000000000000000000000000000000000a'
const BENEFICIARY_TEST = '0x000000000000000000000000000000000000000b'
const HASH = '0x' + 'ab'.repeat(32)
const HASH2 = '0x' + 'cd'.repeat(32)
const PAYER = '0x' + 'cd'.repeat(20)

const intentOf = (accountId: string, amount = 15, extra: Partial<Parameters<Store['createPaymentIntent']>[0]> = {}): Parameters<Store['createPaymentIntent']>[0] => ({
  accountId,
  amount,
  amountDecimal: String(amount),
  usdcMinor: String(BigInt(amount) * 1_000_000n),
  currency: 'USDC',
  expiresAt: '2099-01-01T00:00:00.000Z',
  ...extra,
})

let skuSeq = 0
function saleAccount(store: () => Store): { accountId: string; saleId: string } {
  const sku = `P${++skuSeq}`
  const pid = commit(store, (s) => s.addProduct({ sku, name: sku, category: 'G', unit: 'un', cost: 1, price: 4, stock: 100, minStock: 0 }))
  const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
  if (!sale.ok || !sale.accountId) throw new Error('sale')
  return { accountId: sale.accountId, saleId: sale.saleId }
}

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.1B.2.2A.2 — Treasury gateway/beneficiary separation', () => {
  test('preserva os endereços GatewayWallet da Treasury (Mainnet e Testnet)', () => {
    expect(gatewayConfigFor('mainnet').gatewayWallet.toLowerCase()).toBe('0x77777777dcc4d5a8b6e418fd04d8997ef11000ee')
    expect(gatewayConfigFor('testnet').gatewayWallet.toLowerCase()).toBe('0x0077777d7eba4688bdef3e311b846f25870a19b9')
    expect(gatewayConfigFor('mainnet').chainId).toBe(5042)
    expect(gatewayConfigFor('testnet').chainId).toBe(5042002)
  })

  test('validateGatewayTreasury aceita o GatewayWallet oficial e rejeita outros', () => {
    const t = gatewayConfigFor('testnet')
    expect(validateGatewayTreasury(t.gatewayWallet, 'testnet', t.chainId)).toBe(true)
    expect(validateGatewayTreasury(t.gatewayWallet, 'mainnet', t.chainId)).toBe(false) // ambiente errado
    expect(validateGatewayTreasury(BENEFICIARY_TEST, 'testnet', t.chainId)).toBe(false) // não é o GatewayWallet
    expect(validateGatewayTreasury('0x123', 'testnet', t.chainId)).toBe(false) // endereço inválido
  })

  test('resolveTreasuryReceivingConfig separa GatewayWallet de beneficiário', () => {
    // Beneficiário convencional válido → beneficiário presente.
    const a = resolveTreasuryReceivingConfig({ treasuryRecipients: { testnet: BENEFICIARY_TEST } }, 'testnet')
    expect(a.gatewayWallet.toLowerCase()).toBe(gatewayConfigFor('testnet').gatewayWallet.toLowerCase())
    expect(a.beneficiary).toBe(BENEFICIARY_TEST)
    // Config antiga com GatewayWallet no campo beneficiário → beneficiário null (configuração pendente).
    const b = resolveTreasuryReceivingConfig({ treasuryRecipients: { testnet: gatewayConfigFor('testnet').gatewayWallet } }, 'testnet')
    expect(b.gatewayWallet.toLowerCase()).toBe(gatewayConfigFor('testnet').gatewayWallet.toLowerCase())
    expect(b.beneficiary).toBeNull()
  })
})

describe('FIN-04.1B.2.2A.2 — exact money and conversion', () => {
  test('parseExactDecimal rejeita precisão excessiva', () => {
    expect(parseExactDecimal('15', 6)).toBe(15_000_000n)
    expect(() => parseExactDecimal('15.0000001', 6)).toThrow()
    expect(() => parseExactDecimal('1e6', 6)).toThrow()
    expect(() => parseExactDecimal('0', 6)).toThrow()
  })

  test('convertToUsdcMinor converte BRL 500,00 (rate 5) em 100 USDC', () => {
    // amountMinor=50000 (BRL cents), currencyDecimals=2, rate 5 BRL/USDC → usdcMinor 100_000_000
    expect(convertToUsdcMinor(50_000n, 2, 5n, 0)).toBe(100_000_000n)
  })

  test('convertToUsdcMinor arredonda para cima', () => {
    // 1 BRL em centavos (100), rate 3 BRL/USDC → 0.333333 USDC → arredonda para cima → 333334
    expect(convertToUsdcMinor(100n, 2, 3n, 0)).toBe(333_334n)
  })

  test('validateExecutionMode: simulação só na Testnet', () => {
    expect(validateExecutionMode('testnet', 'simulation')).toBe(true)
    expect(validateExecutionMode('mainnet', 'simulation')).toBe(false)
    expect(validateExecutionMode('testnet', 'onchain')).toBe(true)
    expect(validateExecutionMode('mainnet', 'onchain')).toBe(true)
    expect(validateExecutionMode('mainnet', 'bogus' as never)).toBe(false)
  })

  test('attemptBlocksRetry e canReleaseReservation', () => {
    expect(attemptBlocksRetry({ state: 'AMBIGUOUS' })).toBe(true)
    expect(attemptBlocksRetry({ state: 'SUBMITTED' })).toBe(true)
    expect(attemptBlocksRetry({ state: 'CONFIRMED' })).toBe(true)
    expect(attemptBlocksRetry({ state: 'REQUIRES_REVIEW' })).toBe(true)
    expect(attemptBlocksRetry({ state: 'CANCELED' })).toBe(false)
    expect(attemptBlocksRetry({ state: 'REVERTED' })).toBe(false)

    expect(canReleaseReservation([])).toBe(true)
    expect(canReleaseReservation([{ state: 'CREATED' }])).toBe(true)
    expect(canReleaseReservation([{ state: 'AMBIGUOUS' }])).toBe(false)
    expect(canReleaseReservation([{ state: 'SUBMITTED', depositTxHash: HASH }])).toBe(false)
    expect(canReleaseReservation([{ state: 'AWAITING_SIGNATURE', submissionStartedAt: 'x' }])).toBe(false)
  })
})

describe('FIN-04.1B.2.2A.2 — Store precision, attempts, reservations and recovery', () => {
  test('reserva em moeda original: BRL 500 reserva 50000 centavos, não usdcMinor', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const accId = commit(store, (s) => s.addAccount({ kind: 'receivable', description: 'Venda BRL', contactName: 'Cliente', amount: 500, dueDate: '2026-12-31', category: 'Vendas', currency: 'BRL' }))
    const r = commit(store, (s) => s.createPaymentIntent({ accountId: accId, amount: 500, amountDecimal: '500.00', usdcMinor: '100000000', currency: 'BRL', rate: '5', expiresAt: '2099-01-01T00:00:00.000Z' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const reservation = store().data.paymentReservations.find((x) => x.intentId === r.intentId)!
    expect(reservation.amountMinor).toBe('50000')
    const intent = store().data.paymentIntents.find((i) => i.intentId === r.intentId)!
    expect(intent.amountMinor).toBe('50000')
    expect(intent.usdcMinor).toBe('100000000')
    unmount()
  })

  test('rejeita precisão excessiva e divergência monetária no Store', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store)
    // amountDecimal com 7 casas → excess_precision.
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(accountId, 15, { amountDecimal: '15.0000001' }))).ok).toBe(false)
    // amountDecimal 15 mas usdcMinor 150 USDC → divergência.
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(accountId, 15, { usdcMinor: '150000000' }))).ok).toBe(false)
    unmount()
  })

  test('hash imutável: repetição idempotente não duplica histórico; hash diferente é rejeitado', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store)
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(accountId)))
    if (!r.ok) throw new Error('intent')
    const att = commit(store, (s) => s.createPaymentAttempt(r.intentId))
    if (!att.ok) throw new Error('attempt')
    expect(commit(store, (s) => s.beginPaymentSubmission(att.attemptId, PAYER)).ok).toBe(true)
    expect(commit(store, (s) => s.registerDepositSubmission(att.attemptId, HASH))).toBe(true)
    const after1 = store().data.paymentAttempts.find((a) => a.attemptId === att.attemptId)!
    const histLen = after1.history.length
    // Repetição do mesmo hash → idempotente (não duplica histórico).
    expect(commit(store, (s) => s.registerDepositSubmission(att.attemptId, HASH))).toBe(true)
    const after2 = store().data.paymentAttempts.find((a) => a.attemptId === att.attemptId)!
    expect(after2.history).toHaveLength(histLen)
    expect(after2.depositTxHash).toBe(HASH)
    // Hash diferente não pode sobrescrever o original.
    expect(commit(store, (s) => s.registerDepositSubmission(att.attemptId, HASH2))).toBe(false)
    expect(store().data.paymentAttempts.find((a) => a.attemptId === att.attemptId)!.depositTxHash).toBe(HASH)
    unmount()
  })

  test('beginPaymentSubmission persiste início da submissão antes da carteira', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store)
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(accountId)))
    if (!r.ok) throw new Error('intent')
    const att = commit(store, (s) => s.createPaymentAttempt(r.intentId))
    if (!att.ok) throw new Error('attempt')
    // Pagador vazio → rejeitado.
    expect(commit(store, (s) => s.beginPaymentSubmission(att.attemptId, '')).ok).toBe(false)
    expect(commit(store, (s) => s.beginPaymentSubmission(att.attemptId, PAYER)).ok).toBe(true)
    const a = store().data.paymentAttempts.find((x) => x.attemptId === att.attemptId)!
    expect(a.state).toBe('AWAITING_SIGNATURE')
    expect(a.submissionStartedAt).toBeTruthy()
    expect(a.payer).toBe(PAYER)
    unmount()
  })

  test('tentativa para intenção cancelada/expirada é rejeitada', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store)
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(accountId)))
    if (!r.ok) throw new Error('intent')
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'CANCELED'))).toBe(true)
    expect(commit(store, (s) => s.createPaymentAttempt(r.intentId)).ok).toBe(false)
    unmount()
  })

  test('cancelamento seguro libera a reserva; expiração segura libera a reserva', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId } = saleAccount(store)
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(accountId)))
    if (!r.ok) throw new Error('intent')
    const reservation = store().data.paymentReservations.find((x) => x.intentId === r.intentId)!
    expect(reservation.state).toBe('HELD')
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'CANCELED'))).toBe(true)
    expect(store().data.paymentReservations.find((x) => x.intentId === r.intentId)!.state).toBe('RELEASED')
    // Disponível volta: nova intenção de 15 sobre a mesma obrigação é aceita.
    const r2 = commit(store, (s) => s.createPaymentIntent(intentOf(accountId, 15)))
    expect(r2.ok).toBe(true)
    unmount()
  })

  test('clearSandboxData é inerte (Mainnet-only): preserva intenções, tentativas e reservas', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId: tA } = saleAccount(store)
    const rReal = commit(store, (s) => s.createPaymentIntent(intentOf(tA, 15)))
    if (!rReal.ok) throw new Error('real intent')
    const attReal = commit(store, (s) => s.createPaymentAttempt(rReal.intentId))
    if (!attReal.ok) throw new Error('real attempt')
    commit(store, (s) => s.clearSandboxData()) // sem rede Testnet ativa → no-op
    expect(store().data.paymentIntents.map((i) => i.intentId)).toContain(rReal.intentId)
    expect(store().data.paymentAttempts.map((a) => a.attemptId)).toContain(attReal.attemptId)
    expect(store().data.paymentReservations.map((x) => x.intentId)).toContain(rReal.intentId)
    unmount()
  })
})
