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
const { parseBackup } = await import('../src/lib/backup')

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

const intentOf = (accountId: string, saleId: string, amount = 15): Parameters<Store['createPaymentIntent']>[0] => ({
  saleId,
  accountId,
  amount,
  usdcMinor: String(BigInt(amount) * 1_000_000n),
  currency: 'USDC',
  expiresAt: '2099-01-01T00:00:00.000Z',
})

/** Cria produto + venda USDC (obrigação de 40) e retorna accountId/saleId. */
let skuSeq = 0
function saleAccount(store: () => Store): { accountId: string; saleId: string } {
  const sku = `P${++skuSeq}`
  const pid = commit(store, (s) => s.addProduct({ sku, name: sku, category: 'G', unit: 'un', cost: 1, price: 4, stock: 100, minStock: 0 }))
  const sale = commit(store, (s) => s.recordSale({ method: 'usdc', items: [{ productId: pid, qty: 10, price: 4 }] }))
  if (!sale.ok || !sale.accountId) throw new Error('sale')
  return { accountId: sale.accountId, saleId: sale.saleId }
}

const WALK: Parameters<Store['transitionPaymentIntent']>[1][] = ['AWAITING_WALLET', 'AWAITING_APPROVAL', 'APPROVAL_PENDING', 'READY_TO_DEPOSIT', 'AWAITING_SIGNATURE']

beforeEach(() => {
  localStorage.clear()
  setNetwork('mainnet')
})
afterEach(() => {
  localStorage.clear()
})

describe('FIN-04.1B.2.2A.1 — Execution integrity (StoreProvider)', () => {
  test('bloqueia SUBMITTED ao percorrer estados sem tentativa/hash', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId, saleId } = saleAccount(store)
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(accountId, saleId)))
    if (!r.ok) throw new Error('intent')
    for (const st of WALK) {
      expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, st))).toBe(true)
    }
    // Sem tentativa nem hash de depósito, SUBMITTED deve ser bloqueado.
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'SUBMITTED'))).toBe(false)
    expect(store().data.paymentIntents.find((i) => i.intentId === r.intentId)!.state).toBe('AWAITING_SIGNATURE')
    unmount()
  })

  test('bloqueia ONCHAIN_CONFIRMED sem evidência autorizada do verificador', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId, saleId } = saleAccount(store)
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(accountId, saleId)))
    if (!r.ok) throw new Error('intent')
    const att = commit(store, (s) => s.createPaymentAttempt(r.intentId))
    if (!att.ok) throw new Error('attempt')
    expect(commit(store, (s) => s.registerDepositSubmission(att.attemptId, HASH))).toBe(true)
    for (const st of WALK) {
      expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, st))).toBe(true)
    }
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'SUBMITTED'))).toBe(true)
    // Hash isolado não comprova pagamento; a confirmação exige o caminho do verificador.
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'ONCHAIN_CONFIRMED'))).toBe(false)
    unmount()
  })

  test('rejeita hash inválido e reutilizado entre tentativas de intenções distintas', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const a = saleAccount(store)
    const b = saleAccount(store)
    const r1 = commit(store, (s) => s.createPaymentIntent(intentOf(a.accountId, a.saleId)))
    const r2 = commit(store, (s) => s.createPaymentIntent(intentOf(b.accountId, b.saleId)))
    if (!r1.ok || !r2.ok) throw new Error('intents')
    const att1 = commit(store, (s) => s.createPaymentAttempt(r1.intentId))
    const att2 = commit(store, (s) => s.createPaymentAttempt(r2.intentId))
    if (!att1.ok || !att2.ok) throw new Error('attempts')
    expect(commit(store, (s) => s.registerDepositSubmission(att1.attemptId, '0x1234'))).toBe(false) // inválido
    expect(commit(store, (s) => s.registerDepositSubmission(att1.attemptId, HASH))).toBe(true)
    expect(commit(store, (s) => s.registerDepositSubmission(att2.attemptId, HASH))).toBe(false) // reutilizado entre intenções
    unmount()
  })

  test('reserva é preservada em timeout ambíguo; cancelamento e falha são bloqueados', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId, saleId } = saleAccount(store)
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(accountId, saleId, 15)))
    if (!r.ok) throw new Error('intent')
    const att = commit(store, (s) => s.createPaymentAttempt(r.intentId))
    if (!att.ok) throw new Error('attempt')
    expect(commit(store, (s) => s.registerDepositSubmission(att.attemptId, HASH))).toBe(true)
    expect(commit(store, (s) => s.markAttemptAmbiguous(att.attemptId, 'timeout'))).toBe(true)
    // Uma tentativa ambígua (não resolvida) impede nova tentativa executável para a mesma intenção.
    expect(commit(store, (s) => s.createPaymentAttempt(r.intentId)).ok).toBe(false)
    // Cancelamento/falha sem resolução comprovada devem ser rejeitados.
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'CANCELED'))).toBe(false)
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'FAILED'))).toBe(false)
    const reservation = store().data.paymentReservations.find((x) => x.intentId === r.intentId)
    expect(reservation?.state).toBe('HELD')
    // Disponível permanece 25 (40 − 15 reservado): intenção de 25 é aceita, 30 é rejeitada.
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(accountId, saleId, 30))).ok).toBe(false)
    expect(commit(store, (s) => s.createPaymentIntent(intentOf(accountId, saleId, 25))).ok).toBe(true)
    unmount()
  })

  test('transição repetida para o mesmo estado não duplica histórico', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId, saleId } = saleAccount(store)
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(accountId, saleId)))
    if (!r.ok) throw new Error('intent')
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'AWAITING_WALLET'))).toBe(true)
    expect(commit(store, (s) => s.transitionPaymentIntent(r.intentId, 'AWAITING_WALLET'))).toBe(true)
    const intent = store().data.paymentIntents.find((i) => i.intentId === r.intentId)!
    expect(intent.state).toBe('AWAITING_WALLET')
    expect(intent.history).toHaveLength(2) // CREATED + AWAITING_WALLET (sem duplicação)
    unmount()
  })

  test('a mesma chave em ambientes diferentes não se contamina', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY, testnet: BENEFICIARY_TEST } }))
    const { accountId, saleId } = saleAccount(store)
    const a = commit(store, (s) => s.createPaymentIntent({ ...intentOf(accountId, saleId), idempotencyKey: 'k1' }))
    expect(a.ok).toBe(true)
    // Troca para Testnet: mesmo chave deve gerar uma intenção independente.
    setNetwork('testnet')
    const { accountId: tAccountId, saleId: tSaleId } = saleAccount(store)
    const b = commit(store, (s) => s.createPaymentIntent({ ...intentOf(tAccountId, tSaleId), idempotencyKey: 'k1' }))
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error('intents')
    expect(a.intentId).not.toBe(b.intentId)
    expect(store().data.paymentIntents).toHaveLength(2)
    expect(store().data.paymentIntents.map((i) => i.environment).sort()).toEqual(['mainnet', 'testnet'])
    unmount()
  })

  test('recupera intenções, tentativas, reservas e histórico após remontagem do StoreProvider', () => {
    const first = renderStore()
    commit(first.store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId, saleId } = saleAccount(first.store)
    const r = commit(first.store, (s) => s.createPaymentIntent(intentOf(accountId, saleId)))
    if (!r.ok) throw new Error('intent')
    const att = commit(first.store, (s) => s.createPaymentAttempt(r.intentId))
    if (!att.ok) throw new Error('attempt')
    commit(first.store, (s) => s.registerDepositSubmission(att.attemptId, HASH))
    commit(first.store, (s) => s.markAttemptAmbiguous(att.attemptId, 'timeout'))
    React.act(() => {})
    first.unmount()

    const second = renderStore()
    const intent = second.store().data.paymentIntents.find((i) => i.intentId === r.intentId)
    const attempt = second.store().data.paymentAttempts.find((a) => a.attemptId === att.attemptId)
    const reservation = second.store().data.paymentReservations.find((x) => x.intentId === r.intentId)
    expect(intent).toBeTruthy()
    expect(intent!.history.map((h) => h.state)).toEqual(['CREATED'])
    expect(attempt?.state).toBe('AMBIGUOUS')
    expect(attempt?.depositTxHash).toBe(HASH)
    expect(reservation?.state).toBe('HELD')
    second.unmount()
  })

  test('criação de intenção/tentativa não liquida a obrigação nem gera caixa', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId, saleId } = saleAccount(store)
    const entriesBefore = store().data.entries.length
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(accountId, saleId)))
    if (!r.ok) throw new Error('intent')
    const att = commit(store, (s) => s.createPaymentAttempt(r.intentId))
    if (!att.ok) throw new Error('attempt')
    commit(store, (s) => s.registerDepositSubmission(att.attemptId, HASH))
    const account = store().data.accounts.find((a) => a.id === accountId)!
    expect(account.status).toBe('open')
    expect(account.amount).toBe(40)
    expect(account.settlements ?? []).toHaveLength(0)
    expect(account.treasuryTx).toBeUndefined()
    expect(store().data.entries.length).toBe(entriesBefore) // nenhuma entrada de caixa/receita nova
    unmount()
  })

  test('backup preserva intenções, tentativas e reservas; backup legado importa com arrays vazios', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY } }))
    const { accountId, saleId } = saleAccount(store)
    const r = commit(store, (s) => s.createPaymentIntent(intentOf(accountId, saleId)))
    if (!r.ok) throw new Error('intent')
    const att = commit(store, (s) => s.createPaymentAttempt(r.intentId))
    if (!att.ok) throw new Error('attempt')
    const payload = JSON.stringify({ app: 'global-business-os', version: 1, data: store().data })
    const res = parseBackup(payload)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.paymentIntents).toHaveLength(1)
    expect(res.data.paymentAttempts).toHaveLength(1)
    expect(res.data.paymentReservations).toHaveLength(1)
    // Backup legado sem os campos novos importa com arrays vazios (não quebra).
    const legacy = parseBackup(JSON.stringify({ app: 'global-business-os', version: 1, data: { products: [], sales: [], accounts: [] } }))
    expect(legacy.ok).toBe(true)
    if (!legacy.ok) return
    expect(legacy.data.paymentAttempts).toEqual([])
    expect(legacy.data.paymentReservations).toEqual([])
    unmount()
  })

  test('clearSandboxData preserva tentativas/reservas da Mainnet e remove as da Testnet', () => {
    const { store, unmount } = renderStore()
    commit(store, (s) => s.updateSettings({ treasuryRecipients: { mainnet: BENEFICIARY, testnet: BENEFICIARY_TEST } }))
    const { accountId, saleId } = saleAccount(store)
    const rMain = commit(store, (s) => s.createPaymentIntent(intentOf(accountId, saleId)))
    if (!rMain.ok) throw new Error('main intent')
    commit(store, (s) => s.createPaymentAttempt(rMain.intentId))
    setNetwork('testnet')
    const { accountId: tA, saleId: tS } = saleAccount(store)
    const rTest = commit(store, (s) => s.createPaymentIntent(intentOf(tA, tS)))
    if (!rTest.ok) throw new Error('test intent')
    commit(store, (s) => s.createPaymentAttempt(rTest.intentId))
    expect(store().data.paymentAttempts).toHaveLength(2)
    commit(store, (s) => s.clearSandboxData())
    expect(store().data.paymentIntents.map((i) => i.environment)).toEqual(['mainnet'])
    expect(store().data.paymentAttempts.map((a) => a.environment)).toEqual(['mainnet'])
    expect(store().data.paymentReservations.map((x) => x.environment)).toEqual(['mainnet'])
    unmount()
  })
})
