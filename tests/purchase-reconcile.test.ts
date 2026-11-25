import { describe, expect, test } from 'bun:test'

// Stubs leves (o store importa módulos que tocam DOM/localStorage).
const g = globalThis as unknown as Record<string, unknown>
const storage: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => void (storage[k] = v), removeItem: (k: string) => void delete storage[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { emptyData } = await import('../src/lib/store')
const { emptyLedger, trialBalance } = await import('../src/lib/accounting/engine')
const { planPurchaseReconciliation, applyPurchaseReconciliation } = await import('../src/lib/accounting/purchase-reconcile')
import { CAT_PURCHASE } from '../src/lib/types'
import type { Account, AppData, PurchaseRef } from '../src/lib/types'

const NOW = '2026-11-22T10:00:00.000Z'
const ctx = { now: NOW, actor: { id: 'Dono', kind: 'user' as const } }

const scenario = (payableStatus: Account['status'] = 'paid'): AppData => {
  const purchase: PurchaseRef = {
    id: 'PUR-0001',
    date: '2026-11-20',
    supplierName: 'ETH FOOD',
    items: [{ productId: 'p-arroz', name: 'Arroz', sku: 'ARR', qty: 30000, cost: 6 }],
    total: 180000,
    stockPosted: true,
    createdAt: NOW,
    environment: 'mainnet',
  }
  const payable: Account = {
    id: 'acc-1',
    kind: 'payable',
    description: 'Compra de mercadorias - ETH FOOD',
    contactName: 'ETH FOOD',
    amount: 180000,
    dueDate: '2026-12-20',
    category: CAT_PURCHASE,
    status: payableStatus,
    source: 'purchase',
    currency: 'USDC',
    environment: 'mainnet',
    ...(payableStatus === 'paid' ? { paidAt: '2026-11-21', settlements: [{ id: 's1', sequence: 1, amount: 180000, date: '2026-11-21' }] } : {}),
  }
  const entry = {
    id: 'cash-1',
    date: '2026-11-21',
    type: 'out' as const,
    category: CAT_PURCHASE,
    description: 'Compra de mercadorias - ETH FOOD',
    amount: 180000,
    environment: 'mainnet',
    sourceKind: 'account' as const,
    sourceId: 'acc-1',
  }
  return { ...emptyData(), purchases: [purchase], accounts: [payable], entries: [entry] }
}

describe('recuperação histórica de compras (FIN-02 hotfix)', () => {
  test('compra a prazo já paga recupera reconhecimento E liquidação', () => {
    const data = scenario('paid')
    const plan = planPurchaseReconciliation(data)
    expect(plan).toHaveLength(1)
    const item = plan[0]!
    expect(item.status).toBe('ready')
    expect(item.paidNow).toBe(false)
    expect(item.payableAccountId).toBe('acc-1')
    expect(item.draft).toBeTruthy() // reconhecimento (inventory/payable)
    expect(item.settlementDraft).toBeTruthy() // liquidação (payable/cash)

    const out = applyPurchaseReconciliation(emptyLedger(), plan, ctx)
    expect(out.posted).toBe(2) // reconhecimento + liquidação
    expect(out.duplicates).toBe(0)
    expect(out.rejected).toBe(0)
    // Partidas equilibradas e obrigação com saldo zero.
    const tb = trialBalance(out.ledger, { currency: 'USDC' })[0]
    expect(tb?.balanced).toBe(true)
    const payableBalance = tb?.rows.find((r) => r.code === '2000')?.balance ?? 0n
    expect(payableBalance).toBe(0n) // contas a pagar liquidadas
  })

  test('recuperação repetida não duplica (idempotente)', () => {
    const data = scenario('paid')
    const plan = planPurchaseReconciliation(data)
    const once = applyPurchaseReconciliation(emptyLedger(), plan, ctx)
    expect(once.posted).toBe(2)
    const again = applyPurchaseReconciliation(once.ledger, plan, ctx)
    expect(again.posted).toBe(0)
    expect(again.duplicates).toBe(2)
    expect(again.ledger.journal).toHaveLength(once.ledger.journal.length)
  })

  test('compra a prazo ainda aberta recupera só o reconhecimento', () => {
    const data = scenario('open')
    const plan = planPurchaseReconciliation(data)
    expect(plan[0]!.status).toBe('ready')
    expect(plan[0]!.settlementDraft).toBeUndefined()
    const out = applyPurchaseReconciliation(emptyLedger(), plan, ctx)
    expect(out.posted).toBe(1) // só o reconhecimento
  })

  test('recuperação não altera estoque nem Livro-Caixa', () => {
    const data = scenario('paid')
    const productsBefore = JSON.stringify(data.products)
    const entriesBefore = JSON.stringify(data.entries)
    const purchasesBefore = JSON.stringify(data.purchases)
    planPurchaseReconciliation(data)
    applyPurchaseReconciliation(emptyLedger(), planPurchaseReconciliation(data), ctx)
    // plan/apply são puros sobre o AppData de entrada; nada além do razão é tocado.
    expect(JSON.stringify(data.products)).toBe(productsBefore)
    expect(JSON.stringify(data.entries)).toBe(entriesBefore)
    expect(JSON.stringify(data.purchases)).toBe(purchasesBefore)
  })
})
