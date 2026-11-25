import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const g = globalThis as unknown as Record<string, unknown>
const store: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { emptyData } = await import('../src/lib/store')
const { autoPost } = await import('../src/lib/accounting/autopost')
const { postEvent, trialBalance, isReversed, registerFee, confirmFee, reverseEntry, validateEntry } = await import('../src/lib/accounting/engine')
const { createAccount, updateAccount, setAccountActive, deleteAccount, accountUsage } = await import('../src/lib/accounting/chart-ops')
const { recordReview, recordFxRate, convertForReporting, findFxRate } = await import('../src/lib/accounting/reviews')
const { buildReconciliation, summarize } = await import('../src/lib/accounting/reconcile-center')
const { glRows, entryDetail, glCsvRows } = await import('../src/lib/accounting/gl')
const { chartTree, descendants, defaultChart } = await import('../src/lib/accounting/chart')
const { cashBookEvent } = await import('../src/lib/accounting/adapters')
const { planPurchaseReconciliation, applyPurchaseReconciliation } = await import('../src/lib/accounting/purchase-reconcile')
import type { AppData, Account, Sale, TreasuryOp, Entry, PurchaseRef } from '../src/lib/types'
import type { EventDraft } from '../src/lib/accounting/types'

const NOW = '2026-11-22T10:00:00.000Z'
const TODAY = '2026-11-22'
const opts = { today: TODAY, actorId: 'Dono', now: NOW }
const user = { id: 'Dono', kind: 'user' as const }
const ctx = { now: NOW, actor: user }

function withFlags(d: AppData, on: Partial<AppData['ledger']['flags']['adapters']>): AppData {
  return { ...d, ledger: { ...d.ledger, flags: { adapters: { ...d.ledger.flags.adapters, ...on } } } }
}
const base = (on: Partial<AppData['ledger']['flags']['adapters']> = {}, currency: AppData['settings']['currency'] = 'BRL'): AppData => {
  const d = withFlags(emptyData(), on)
  return { ...d, settings: { ...d.settings, currency } }
}
const sale = (over: Partial<Sale> = {}): Sale => ({ id: 's1', date: TODAY, customerName: 'Ana', items: [], total: 100, cogs: 40, method: 'dinheiro', ...over })
const cashIn = (over: Partial<Entry> = {}): Entry => ({ id: 'e1', date: TODAY, type: 'in', category: 'Vendas', description: 'Venda para Ana (dinheiro)', amount: 100, sourceKind: 'sale', sourceId: 's1', ...over })
const acct = (over: Partial<Account> = {}): Account => ({ id: 'a1', kind: 'payable', description: 'Aluguel da loja', contactName: 'Imob', amount: 500, dueDate: '2026-12-01', category: 'Aluguel', status: 'open', source: 'manual', ...over })
const bal = (d: AppData, code: string, cur: 'BRL' | 'USDC' = 'BRL'): bigint => trialBalance(d.ledger, { currency: cur })[0]?.rows.find((r) => r.code === code)?.balance ?? 0n

describe('lançamento automático por diferença de estado (atrás de flags)', () => {
  test('com tudo desligado (padrão) nada é lançado', () => {
    const prev = base()
    const next = { ...prev, sales: [sale()], entries: [cashIn()] }
    expect(autoPost(prev, next, opts)).toBe(next)
    expect(prev.ledger.flags.adapters.sales).toBe(false)
  })
  test('venda à vista: receita + CMV, ligada ao registro do Livro-Caixa; reprocessar não duplica', () => {
    const prev = base({ sales: true })
    const next = { ...prev, sales: [sale()], entries: [cashIn()] }
    const out = autoPost(prev, next, opts)
    expect(out.ledger.journal).toHaveLength(1)
    const je = out.ledger.journal[0]!
    expect(je.links).toMatchObject({ cashEntryId: 'e1', saleId: 's1' })
    expect(bal(out, '4000')).toBe(10000n) // receita 100,00
    expect(bal(out, '1000')).toBe(10000n)
    expect(bal(out, '5000')).toBe(4000n) // CMV
    expect(bal(out, '1200')).toBe(-4000n)
    const again = autoPost(prev, out, opts) // mesmo "prev": reaplicar sobre o resultado
    expect(again.ledger.journal).toHaveLength(1)
    const twice = autoPost(prev, { ...out }, opts)
    expect(twice.ledger.events).toHaveLength(1)
  })
  test('venda a prazo + recebimento: receita uma única vez (competência separada do caixa)', () => {
    const on = { sales: true, payables: true }
    const s0 = base(on)
    const credit = sale({ id: 's2', method: 'prazo', accountId: 'ar1' })
    const ar = acct({ id: 'ar1', kind: 'receivable', source: 'sale', category: 'Vendas', description: 'Venda a prazo (1 item)', amount: 100 })
    const s1 = autoPost(s0, { ...s0, sales: [credit], accounts: [ar] }, opts)
    expect(bal(s1, '1100')).toBe(10000n)
    expect(bal(s1, '4000')).toBe(10000n)
    expect(s1.ledger.journal).toHaveLength(1) // a conta a receber (source sale) não gera evento próprio
    const paid: Account = { ...ar, status: 'paid', paidAt: TODAY }
    const settleEntry = cashIn({ id: 'e2', description: ar.description, sourceKind: 'account', sourceId: 'ar1' })
    const s2 = autoPost(s1, { ...s1, accounts: [paid], entries: [settleEntry] }, opts)
    expect(s2.ledger.journal).toHaveLength(2)
    expect(bal(s2, '4000')).toBe(10000n) // não reconheceu de novo
    expect(bal(s2, '1100')).toBe(0n)
    expect(bal(s2, '1000')).toBe(10000n)
    expect(s2.ledger.journal[1]!.links.cashEntryId).toBe('e2')
  })
  test('baixa sem obrigação no razão (anterior à ativação) não é lançada: fica para revisão', () => {
    const prev = base({ payables: true })
    const open = acct()
    const paid: Account = { ...open, status: 'paid', paidAt: TODAY }
    const out = autoPost({ ...prev, accounts: [open] }, { ...prev, accounts: [paid], entries: [cashIn({ id: 'e9', type: 'out', category: 'Aluguel', description: open.description, amount: 500 })] }, opts)
    expect(out.ledger.journal).toHaveLength(0)
    expect(buildReconciliation({ ...out, accounts: [paid] }).some((i) => i.reason === 'obligation_missing')).toBe(true)
  })
  test('conta manual: obrigação, edição (estorno + novo) e remoção', () => {
    const prev = base({ payables: true })
    const created = autoPost(prev, { ...prev, accounts: [acct()] }, opts)
    expect(bal(created, '2000')).toBe(50000n)
    expect(bal(created, '5100')).toBe(50000n)
    const edited = autoPost({ ...created, accounts: [acct()] }, { ...created, accounts: [acct({ amount: 650 })] }, opts)
    expect(bal(edited, '2000')).toBe(65000n)
    expect(edited.ledger.journal.filter((j) => j.reversalOf)).toHaveLength(1)
    const removed = autoPost({ ...edited, accounts: [acct({ amount: 650 })] }, { ...edited, accounts: [] }, opts)
    expect(bal(removed, '2000')).toBe(0n)
    expect(removed.ledger.events.filter((e) => e.idempotencyKey.startsWith('account:a1:created:r')).map((e) => e.idempotencyKey)).toEqual(['account:a1:created:r0', 'account:a1:created:r1'])
  })
  test('frete lançado (conta manual de categoria Logística) vai para a despesa de frete', () => {
    const prev = base({ payables: true })
    const out = autoPost(prev, { ...prev, accounts: [acct({ id: 'fr1', category: 'Logística', description: 'Frete SHP-0001 · Transp', amount: 52.1 })] }, opts)
    expect(bal(out, '5120')).toBe(5210n)
    expect(bal(out, '2000')).toBe(5210n)
  })
  test('compra à vista, a prazo e aguardando recebimento (só lança quando o estoque entra)', () => {
    const prev = base({ purchases: true })
    const paidP: PurchaseRef = { id: 'PUR-0001', date: TODAY, supplierName: 'Forn', items: [], total: 200, stockPosted: true, createdAt: NOW }
    const paidEntry = cashIn({ id: 'p1', type: 'out', category: 'Compra de mercadorias', description: 'Compra', amount: 200, sourceKind: 'purchase', sourceId: 'PUR-0001' })
    const a = autoPost(prev, { ...prev, purchases: [paidP], entries: [paidEntry] }, opts)
    expect(bal(a, '1200')).toBe(20000n)
    expect(bal(a, '1000')).toBe(-20000n)
    const creditP: PurchaseRef = { ...paidP, id: 'PUR-0002', total: 300 }
    const ap = acct({ id: 'ap9', source: 'purchase', sourceId: 'PUR-0002', category: 'Compra de mercadorias', description: 'Compra', contactName: 'Forn', amount: 300 })
    const b = autoPost(a, { ...a, purchases: [creditP, paidP], accounts: [ap] }, opts)
    expect(bal(b, '2000')).toBe(30000n)
    // aguardando recebimento: nada lançado
    const waiting: PurchaseRef = { ...paidP, id: 'PUR-0003', total: 80, stockPosted: false }
    const apW = acct({ id: 'ap10', source: 'purchase', sourceId: 'PUR-0003', category: 'Compra de mercadorias', description: 'Compra', contactName: 'Forn', amount: 80 })
    const c = autoPost(b, { ...b, purchases: [waiting, creditP, paidP], accounts: [apW, ap] }, opts)
    expect(c.ledger.journal).toHaveLength(b.ledger.journal.length)
    // recebimento: o estoque entra e a compra é lançada
    const d = autoPost({ ...c, purchases: [waiting, creditP, paidP], accounts: [apW, ap] }, { ...c, purchases: [{ ...waiting, stockPosted: true }, creditP, paidP], accounts: [apW, ap] }, opts)
    expect(d.ledger.journal).toHaveLength(b.ledger.journal.length + 1)
    expect(bal(d, '1200')).toBe(20000n + 30000n + 8000n)
  })
  test('folha: apropriação, e pagamento só com a obrigação lançada', () => {
    const prev = base({ payroll: true })
    const pay = acct({ id: 'pr1', source: 'payroll', category: 'Folha de pagamento', description: 'Salário Ana - 2026-11', amount: 3000, employeeId: 'emp1' })
    const a = autoPost(prev, { ...prev, accounts: [pay] }, opts)
    expect(bal(a, '5110')).toBe(300000n)
    expect(bal(a, '2100')).toBe(300000n)
    const paid: Account = { ...pay, status: 'paid', paidAt: TODAY }
    const b = autoPost({ ...a, accounts: [pay] }, { ...a, accounts: [paid], entries: [cashIn({ id: 'pe', type: 'out', category: 'Folha de pagamento', description: pay.description, amount: 3000 })] }, opts)
    expect(bal(b, '2100')).toBe(0n)
    expect(bal(b, '1000')).toBe(-300000n)
  })
  test('cancelamento de venda estorna o lançamento; venda a prazo já recebida vai para revisão', () => {
    const prev = base({ sales: true })
    const s = autoPost(prev, { ...prev, sales: [sale()], entries: [cashIn()] }, opts)
    const canceled = autoPost({ ...s, sales: [sale()] }, { ...s, sales: [sale({ canceledAt: TODAY })] }, opts)
    expect(canceled.ledger.journal.filter((j) => j.reversalOf)).toHaveLength(1)
    expect(trialBalance(canceled.ledger)[0]!.rows.every((r) => r.balance === 0n)).toBe(true)
    // prazo recebido e cancelado: não estorna sozinho
    const on = base({ sales: true, payables: true })
    const credit = sale({ id: 's7', method: 'prazo', accountId: 'ar7' })
    const ar = acct({ id: 'ar7', kind: 'receivable', source: 'sale', category: 'Vendas', description: 'Venda a prazo (1 item)', amount: 100 })
    const c1 = autoPost(on, { ...on, sales: [credit], accounts: [ar] }, opts)
    const paid: Account = { ...ar, status: 'paid', paidAt: TODAY }
    const c2 = autoPost(c1, { ...c1, accounts: [paid], entries: [cashIn({ id: 'x1', description: ar.description })] }, opts)
    const c3 = autoPost({ ...c2, sales: [credit], accounts: [paid] }, { ...c2, sales: [{ ...credit, canceledAt: TODAY }], accounts: [paid] }, opts)
    expect(c3.ledger.journal.filter((j) => j.reversalOf)).toHaveLength(0)
    expect(buildReconciliation({ ...c3, sales: [{ ...credit, canceledAt: TODAY }], accounts: [paid] }).some((i) => i.reason === 'sale_canceled_unreversed')).toBe(true)
  })
  test('a moeda do lançamento é a vigente no registro e não muda depois', () => {
    const brl = autoPost(base({ sales: true }, 'BRL'), { ...base({ sales: true }, 'BRL'), sales: [sale()], entries: [cashIn()] }, opts)
    expect(brl.ledger.journal[0]!.currency).toBe('BRL')
    const switched: AppData = { ...brl, settings: { ...brl.settings, currency: 'USDC' } }
    const more = autoPost(switched, { ...switched, sales: [sale({ id: 's3' }), sale()], entries: [cashIn({ id: 'e3' })] }, opts)
    expect(more.ledger.journal.map((j) => j.currency)).toEqual(['BRL', 'USDC'])
  })
  test('operações em duas etapas aplicadas em sequência (concorrência no store) não duplicam', () => {
    const prev = base({ sales: true })
    const next = { ...prev, sales: [sale()], entries: [cashIn()] }
    let state = next
    for (let i = 0; i < 20; i++) state = autoPost(prev, state, opts) // 20 reaplicações sobre o estado mais recente
    expect(state.ledger.journal).toHaveLength(1)
  })
})

describe('tesouraria: pendente até revisão humana', () => {
  const depositOp: TreasuryOp = { id: 'op1', date: TODAY, kind: 'deposit', chain: 'Base_Sepolia', amount: '25.5', txHash: '0xabc', note: '', explorerUrl: 'https://sepolia.basescan.org/tx/0xabc' }
  test('depósito com hash nasce pendente; confirmar lança uma vez; transferência interna não é receita', () => {
    const prev = base({ treasury: true }, 'USDC')
    const out = autoPost(prev, { ...prev, treasuryOps: [depositOp] }, opts)
    expect(out.ledger.journal).toHaveLength(0)
    expect(out.ledger.events[0]!.status).toBe('pending')
    const items = buildReconciliation({ ...out, treasuryOps: [depositOp] })
    const pending = items.find((i) => i.reason === 'pending_confirmation')!
    expect(pending.state).toBe('pending')
    expect(pending.key.startsWith('event:')).toBe(true)
    const done = recordReview(out.ledger, { itemKey: pending.key, decision: 'confirmed', note: 'conferido no explorer', evidence: { txHash: '0xabc', explorerUrl: depositOp.explorerUrl } }, ctx)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.ledger.journal).toHaveLength(1)
    expect(done.ledger.reviews[0]!.evidence?.txHash).toBe('0xabc')
    const tb = trialBalance(done.ledger)[0]!
    expect(tb.rows.some((r) => r.class === 'revenue' || r.class === 'expense')).toBe(false)
    expect(done.ledger.journal[0]!.links).toMatchObject({ txHash: '0xabc', opId: 'op1', chain: 'Base_Sepolia' })
    const again = recordReview(done.ledger, { itemKey: pending.key, decision: 'confirmed', note: 'de novo' }, ctx)
    expect(again.ok).toBe(false)
    expect(done.ledger.journal).toHaveLength(1)
  })
  test('operação falha ou sem hash nunca é lançada', () => {
    const prev = base({ treasury: true }, 'USDC')
    const noHash = { ...depositOp, id: 'op2', txHash: undefined }
    const out = autoPost(prev, { ...prev, treasuryOps: [noHash, depositOp] }, opts)
    expect(out.ledger.events).toHaveLength(1) // só a que tem hash, e pendente
    const failed = recordReview(out.ledger, { itemKey: `event:${out.ledger.events[0]!.idempotencyKey}`, decision: 'failed', note: 'rede recusou' }, ctx)
    expect(failed.ok && failed.ledger.events[0]!.status).toBe('failed')
    expect(failed.ok && failed.ledger.journal).toHaveLength(0)
    const items = buildReconciliation({ ...out, treasuryOps: [noHash] })
    expect(items.find((i) => i.refs.opId === 'op2')!).toMatchObject({ state: 'review', reason: 'no_evidence' })
  })
  test('pagamento via Gateway de uma conta fica pendente; confirmar com evidência baixa a obrigação', () => {
    const prev = base({ payables: true }, 'USDC')
    const open = acct({ id: 'gw1', amount: 120.5 })
    const created = autoPost(prev, { ...prev, accounts: [open] }, opts)
    const paid: Account = { ...open, status: 'paid', paidAt: TODAY, treasuryTx: 'https://x.test/tx/0xdef' }
    const settled = autoPost({ ...created, accounts: [open] }, { ...created, accounts: [paid], entries: [cashIn({ id: 'g1', type: 'out', category: 'Aluguel', description: open.description, amount: 120.5, sourceKind: 'account', sourceId: 'gw1' })] }, opts)
    expect(bal(settled, '2000', 'USDC')).toBe(120_500_000n) // obrigação ainda aberta no razão
    const all = buildReconciliation({ ...settled, accounts: [paid], entries: [cashIn({ id: 'g1', type: 'out', category: 'Aluguel', description: open.description, amount: 120.5, sourceKind: 'account', sourceId: 'gw1' })] })
    expect(all.find((i) => i.key === 'cashbook:g1')).toMatchObject({ state: 'pending', reason: 'pending_confirmation' }) // caixa aguarda o evento pendente
    const item = all.find((i) => i.state === 'pending' && i.key.startsWith('event:'))!
    expect(item.reason).toBe('pending_confirmation')
    const ok = recordReview(settled.ledger, { itemKey: item.key, decision: 'confirmed', note: '', evidence: { txHash: '0xdef' } }, ctx)
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(trialBalance(ok.ledger, { currency: 'USDC' })[0]!.rows.find((r) => r.code === '2000')!.balance).toBe(0n)
    expect(trialBalance(ok.ledger, { currency: 'USDC' })[0]!.rows.find((r) => r.code === '1020')!.balance).toBe(-120_500_000n)
  })
  test('revisão exige usuário humano, motivo e evidência válida', () => {
    const l = base().ledger
    expect(recordReview(l, { itemKey: 'x', decision: 'dismissed', note: 'ok ok' }, { now: NOW, actor: { id: 'ai', kind: 'agent' } }).ok).toBe(false)
    expect(recordReview(l, { itemKey: 'x', decision: 'dismissed', note: '' }, ctx).ok).toBe(false)
    expect(recordReview(l, { itemKey: 'x', decision: 'confirmed', note: '' }, ctx).ok).toBe(false)
    expect(recordReview(l, { itemKey: 'x', decision: 'dismissed', note: 'tudo certo', evidence: { explorerUrl: 'http://inseguro' } }, ctx).ok).toBe(false)
    expect(recordReview(l, { itemKey: 'x', decision: 'dismissed', note: 'tudo certo' }, ctx).ok).toBe(true)
  })
})

describe('plano de contas', () => {
  const l0 = base().ledger
  test('árvore hierárquica e descendentes', () => {
    const tree = chartTree(l0.chart)
    expect(tree[0]!.account.code).toBe('1')
    expect(tree.find((t) => t.account.code === '5110')!.depth).toBe(2)
    expect(descendants(l0.chart, '5100').map((c) => c.code)).toEqual(['5110', '5120', '5130', '5140', '5150'])
  })
  test('criar: código único, subtipo coerente, pai da mesma classe; só usuários', () => {
    const input = { code: '5160', class: 'expense' as const, subtype: 'expense_operating' as const, name: { pt: 'Marketing', en: 'Marketing' }, parent: '5100' }
    const ok = createAccount(l0, input, ctx)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.ledger.chart.find((c) => c.code === '5160')!.parent).toBe('5100')
    expect(createAccount(l0, { ...input, code: '1000' }, ctx).ok).toBe(false)
    expect((createAccount(l0, { ...input, subtype: 'cash' }, ctx) as { errors: string[] }).errors).toContain('invalid_subtype')
    expect((createAccount(l0, { ...input, parent: '1' }, ctx) as { errors: string[] }).errors).toContain('invalid_parent')
    expect((createAccount(l0, { ...input, code: 'ab cd' }, ctx) as { errors: string[] }).errors).toContain('invalid_code')
    expect((createAccount(l0, input, { now: NOW, actor: { id: 'ai', kind: 'agent' } }) as { errors: string[] }).errors).toContain('not_authorized')
  })
  test('conta nova só recebe lançamento se não for grupo; grupo é recusado', () => {
    const draft: EventDraft = { orgId: 'local', idempotencyKey: 'g1', type: 'adjustment', source: { module: 'adjustment', recordId: 'x' }, occurredAt: NOW, accountingDate: TODAY, currency: 'BRL', amountMinor: '100', payload: { debit: 'expense_operating', credit: 'cash', reason: 'teste' }, confirmation: 'confirmed' }
    expect(postEvent(l0, draft, ctx).ok).toBe(true)
    expect((validateEntry(l0, { currency: 'BRL', lines: [{ accountCode: '5', side: 'debit', amountMinor: '100' }, { accountCode: '1000', side: 'credit', amountMinor: '100' }] }))).toContain('group_account')
  })
  test('editar: nome/pai livres; classe e subtipo imutáveis após lançamentos; ciclo recusado', () => {
    const used = postEvent(l0, cashBookDraft(), ctx).ledger
    expect(accountUsage(used, '1000')).toBe(1)
    expect((updateAccount(used, '1000', { subtype: 'receivable' }, ctx) as { errors: string[] }).errors).toContain('immutable_field')
    const renamed = updateAccount(used, '1000', { name: { pt: 'Caixa geral', en: 'General cash' } }, ctx)
    expect(renamed.ok && renamed.ledger.chart.find((c) => c.code === '1000')!.name.pt).toBe('Caixa geral')
    expect((updateAccount(l0, '5100', { parent: '5110' }, ctx) as { errors: string[] }).errors).toContain('invalid_parent')
  })
  test('desativar/excluir: conta com lançamentos, com filhas ou último subtipo ativo não podem sair', () => {
    const used = postEvent(l0, cashBookDraft(), ctx).ledger
    expect((deleteAccount(used, '1000', ctx) as { errors: string[] }).errors).toContain('account_in_use')
    expect((deleteAccount(l0, '5100', ctx) as { errors: string[] }).errors).toContain('account_in_use') // tem filhas
    expect((setAccountActive(l0, '1000', false, ctx) as { errors: string[] }).errors).toContain('last_active_subtype')
    const extra = createAccount(l0, { code: '1001', class: 'asset', subtype: 'cash', name: { pt: 'Caixa 2', en: 'Cash 2' } }, ctx)
    if (!extra.ok) throw new Error('x')
    expect(setAccountActive(extra.ledger, '1000', false, ctx).ok).toBe(true)
    expect(deleteAccount(extra.ledger, '1001', ctx).ok).toBe(true) // sem lançamentos e há outra conta ativa do subtipo
    // conta desativada não recebe lançamentos novos
    const inactive = (setAccountActive(extra.ledger, '1001', false, ctx) as { ledger: typeof l0 }).ledger
    expect(inactive.chart.find((c) => c.code === '1001')!.active).toBe(false)
  })
  test('modelos de país ainda não existem: só o genérico', () => {
    expect(defaultChart().every((c) => !/[A-Z]{2}-/.test(c.code))).toBe(true)
  })
})

function cashBookDraft(): EventDraft {
  const ledger = base().ledger
  const res = cashBookEvent(ledger, { id: 'c1', type: 'in', amount: 10, date: TODAY, category: 'Outras receitas' }, { currency: 'BRL', revision: 0 })
  if (!res.ok) throw new Error('draft')
  return res.draft
}

describe('Razão Geral (consulta)', () => {
  const prev = base({ sales: true })
  const ledger = autoPost(prev, { ...prev, sales: [sale()], entries: [cashIn()] }, opts).ledger
  test('uma linha por conta, com débito/crédito, status e transação relacionada', () => {
    const rows = glRows(ledger)
    expect(rows).toHaveLength(4)
    const cash = rows.find((r) => r.accountCode === '1000')!
    expect(cash).toMatchObject({ debit: '100.00', credit: '', currency: 'BRL', status: 'posted', related: 'cash:e1', module: 'sales', type: 'sale.recorded' })
    expect(rows.find((r) => r.accountCode === '4000')!.credit).toBe('100.00')
  })
  test('filtros por período, conta, moeda, tipo, origem, status e busca', () => {
    expect(glRows(ledger, { account: '5000' })).toHaveLength(1)
    expect(glRows(ledger, { from: '2026-12-01' })).toHaveLength(0)
    expect(glRows(ledger, { currency: 'USDC' })).toHaveLength(0)
    expect(glRows(ledger, { type: 'sale.recorded', module: 'sales' })).toHaveLength(4)
    expect(glRows(ledger, { module: 'treasury' })).toHaveLength(0)
    expect(glRows(ledger, { q: 'receita' })).toHaveLength(1)
    expect(glRows(ledger, { q: 'cash:e1' })).toHaveLength(4)
    const reversed = reverseEntry(ledger, ledger.journal[0]!.id, 'cancelamento', ctx).ledger
    expect(glRows(reversed, { status: 'reversed' })).toHaveLength(4)
    expect(glRows(reversed, { status: 'reversal' })).toHaveLength(4)
  })
  test('detalhe: linhas, origem, taxas e auditoria; CSV com cabeçalho coerente', () => {
    const fee = registerFee(ledger, { source: { module: 'sales', recordId: 's1' }, kind: 'processing', status: 'confirmed', amountMinor: '250', currency: 'BRL', paidFrom: 'cash', accountingDate: TODAY, relatedRef: 'r1' }, ctx)
    expect(fee.ok).toBe(true)
    const det = entryDetail(ledger, ledger.journal[0]!.id)!
    expect(det.event?.type).toBe('sale.recorded')
    expect(det.audit.some((a) => a.action === 'event.posted')).toBe(true)
    const feeDet = entryDetail((fee as { ledger: typeof ledger }).ledger, (fee as { ledger: typeof ledger }).ledger.journal[1]!.id)!
    expect(feeDet.fees).toHaveLength(1)
    const csv = glCsvRows(glRows(ledger), 'pt')
    expect(csv[0]).toHaveLength(12)
    expect(entryDetail(ledger, 'JE-999')).toBeNull()
  })
  test('isolamento: linhas de outra organização não aparecem', () => {
    const foreign = { ...ledger, journal: [...ledger.journal, { ...ledger.journal[0]!, id: 'JE-000099', orgId: 'intruso' }] }
    expect(glRows(foreign).every((r) => r.entryId !== 'JE-000099')).toBe(true)
  })
})

describe('taxas no razão', () => {
  test('estimada não lança; confirmada lança uma vez e fica rastreável; nunca duplica', () => {
    let l = base({}, 'USDC').ledger
    const input = { source: { module: 'treasury' as const, recordId: 'op1' }, kind: 'gateway' as const, status: 'estimated' as const, amountMinor: '300000', currency: 'USDC' as const, paidFrom: 'usdc_gateway' as const, accountingDate: TODAY, relatedRef: '0xabc', rate: '0.0050' }
    const est = registerFee(l, input, ctx)
    if (!est.ok) throw new Error('x')
    l = est.ledger
    expect(l.journal).toHaveLength(0)
    expect(buildReconciliation({ ...base({}, 'USDC'), ledger: l }).find((i) => i.reason === 'fee_estimated')!.state).toBe('pending')
    const conf = confirmFee(l, l.fees[0]!.dedupeKey, { accountingDate: TODAY, amountMinor: '310000' }, ctx)
    if (!conf.ok) throw new Error('y')
    expect(conf.ledger.journal).toHaveLength(1)
    expect(registerFee(conf.ledger, { ...input, status: 'confirmed' }, ctx).ledger.journal).toHaveLength(1)
    expect(buildReconciliation({ ...base({}, 'USDC'), ledger: conf.ledger }).find((i) => i.group === 'fees')!.state).toBe('matched')
  })
})

describe('moeda de relatório e câmbio informado', () => {
  test('conversão só com taxa registrada (fonte + horário); sem taxa devolve null (indisponível)', () => {
    const l = base().ledger
    expect(convertForReporting(l, 10000n, 'BRL', 'USDC', TODAY)).toBeNull()
    expect(recordFxRate(l, { from: 'BRL', to: 'USDC', rate: '0.18', source: '', at: NOW }, ctx).ok).toBe(false)
    expect(recordFxRate(l, { from: 'BRL', to: 'BRL', rate: '1', source: 'x', at: NOW }, ctx).ok).toBe(false)
    expect(recordFxRate(l, { from: 'BRL', to: 'USDC', rate: '0.18', source: 'manual', at: NOW }, { now: NOW, actor: { id: 'ai', kind: 'agent' } }).ok).toBe(false)
    const rec = recordFxRate(l, { from: 'BRL', to: 'USDC', rate: '0.18', source: 'manual', at: NOW }, ctx)
    if (!rec.ok) throw new Error('fx')
    expect(findFxRate(rec.ledger, 'BRL', 'USDC', '2026-11-21')).toBeNull() // taxa posterior à data
    const conv = convertForReporting(rec.ledger, 10000n, 'BRL', 'USDC', TODAY)
    expect(conv?.amountMinor).toBe(18_000_000n) // 100,00 BRL x 0,18 = 18,000000 USDC
    expect(conv?.fx.source).toBe('manual')
    expect(conv?.currency).toBe('USDC')
  })
})

describe('Centro de Conciliação', () => {
  test('estados: conferido, divergência, duplicidade e revisão para legado', () => {
    const prev = base({ sales: true })
    const posted = autoPost(prev, { ...prev, sales: [sale()], entries: [cashIn(), cashIn({ id: 'old', description: 'Antigo', amount: 7 })] }, opts)
    const items = buildReconciliation({ ...posted, sales: [sale()], entries: [cashIn(), cashIn({ id: 'old', description: 'Antigo', amount: 7 })] })
    expect(items.find((i) => i.key === 'cashbook:e1')).toMatchObject({ state: 'matched' })
    expect(items.find((i) => i.key === 'cashbook:old')).toMatchObject({ state: 'review', reason: 'legacy_unledgered' })
    // Divergência: o valor no Livro-Caixa foi alterado depois do lançamento
    const changed = buildReconciliation({ ...posted, sales: [sale()], entries: [cashIn({ amount: 90 })] })
    expect(changed.find((i) => i.key === 'cashbook:e1')).toMatchObject({ state: 'mismatch', reason: 'amount_mismatch' })
    // Duplicata no Livro-Caixa
    const dup = buildReconciliation({ ...posted, entries: [cashIn(), cashIn({ id: 'e1b' })] })
    expect(dup.some((i) => i.reason === 'duplicate_candidate')).toBe(true)
    // Registro removido do Livro-Caixa mas ainda com efeito no razão
    expect(buildReconciliation({ ...posted, entries: [] }).some((i) => i.reason === 'removed_record')).toBe(true)
    const s = summarize(items)
    expect(s.matched + s.pending + s.mismatch + s.review + s.resolved).toBe(s.total)
  })
  test('lançamento desbalanceado e duplicidade de lançamento são divergências', () => {
    const prev = base({ sales: true })
    const posted = autoPost(prev, { ...prev, sales: [sale()], entries: [cashIn()] }, opts)
    const broken = { ...posted, ledger: { ...posted.ledger, journal: posted.ledger.journal.map((j) => ({ ...j, lines: j.lines.slice(0, 3) })) } }
    expect(buildReconciliation(broken).some((i) => i.reason === 'unbalanced')).toBe(true)
    const doubled = { ...posted, ledger: { ...posted.ledger, journal: [...posted.ledger.journal, { ...posted.ledger.journal[0]!, id: 'JE-000002' }] } }
    expect(buildReconciliation({ ...doubled, entries: [cashIn()] }).find((i) => i.key === 'cashbook:e1')!.reason).toBe('duplicate_posting')
  })
  test('revisão "dispensar" resolve o item sem mudar nenhum saldo', () => {
    const d = base()
    const before = JSON.stringify(trialBalance(d.ledger))
    const items = buildReconciliation({ ...d, entries: [cashIn()] })
    const target = items.find((i) => i.key === 'cashbook:e1')!
    const r = recordReview(d.ledger, { itemKey: target.key, decision: 'dismissed', note: 'registro histórico conferido' }, ctx)
    if (!r.ok) throw new Error('r')
    const after = buildReconciliation({ ...d, ledger: r.ledger, entries: [cashIn()] }).find((i) => i.key === target.key)!
    expect(after.resolved?.decision).toBe('dismissed')
    expect(summarize([after]).resolved).toBe(1)
    expect(JSON.stringify(trialBalance(r.ledger))).toBe(before)
    expect(r.ledger.journal).toHaveLength(0)
  })
  test('a camada de conciliação e o lançamento automático não tocam no Circle Gateway', () => {
    for (const f of ['autopost.ts', 'reconcile-center.ts', 'reviews.ts', 'chart-ops.ts', 'gl.ts']) {
      const src = readFileSync(new URL(`../src/lib/accounting/${f}`, import.meta.url), 'utf8')
      expect(/from ['"][^'"]*gateway/i.test(src)).toBe(false)
      expect(src.includes('@circle-fin')).toBe(false)
    }
  })
})

describe('integridade: partida dobrada e parcial', () => {
  test('liquidações parciais reduzem a obrigação; chave de sequência impede duplicar', () => {
    let l = base({ payables: true }).ledger
    const mk = (key: string, type: EventDraft['type'], amount: string): EventDraft => ({ orgId: 'local', idempotencyKey: key, type, source: { module: 'payables', recordId: 'a1' }, occurredAt: NOW, accountingDate: TODAY, currency: 'BRL', amountMinor: amount, payload: { accountId: 'a1', category: 'Aluguel', settleIn: 'cash' }, confirmation: 'confirmed' })
    l = postEvent(l, mk('account:a1:created:r0', 'payable.created', '100000'), ctx).ledger
    l = postEvent(l, mk('account:a1:settle:1', 'payable.settled', '40000'), ctx).ledger
    l = postEvent(l, mk('account:a1:settle:2', 'payable.settled', '30000'), ctx).ledger
    l = postEvent(l, mk('account:a1:settle:2', 'payable.settled', '30000'), ctx).ledger // repetido
    const tb = trialBalance(l)[0]!
    expect(tb.rows.find((r) => r.code === '2000')!.balance).toBe(30000n)
    expect(tb.rows.find((r) => r.code === '1000')!.balance).toBe(-70000n)
    expect(l.journal).toHaveLength(3)
    expect(isReversed(l, l.journal[0]!.id)).toBe(false)
  })
})

describe('liquidações parciais (múltiplas baixas por conta)', () => {
  test('duas baixas parciais geram dois eventos com sequência; o saldo em aberto fica correto', () => {
    const prev = base({ payables: true })
    const open = acct({ id: 'pp1', amount: 1000 })
    const created = autoPost(prev, { ...prev, accounts: [open] }, opts)
    expect(bal(created, '2000')).toBe(100000n)

    const settleEntry = (id: string, amount: number) => cashIn({ id, type: 'out', category: 'Aluguel', description: open.description, amount })
    const partial1: Account = { ...open, settlements: [{ id: 'st1', sequence: 1, amount: 400, date: TODAY }] }
    const s1 = autoPost({ ...created, accounts: [open] }, { ...created, accounts: [partial1], entries: [settleEntry('pe1', 400)] }, opts)
    expect(bal(s1, '2000')).toBe(60000n)
    expect(s1.ledger.events.filter((e) => e.idempotencyKey === 'account:pp1:settle:1')).toHaveLength(1)

    const partial2: Account = { ...open, settlements: [{ id: 'st1', sequence: 1, amount: 400, date: TODAY }, { id: 'st2', sequence: 2, amount: 300, date: TODAY }] }
    const s2 = autoPost({ ...s1, accounts: [partial1] }, { ...s1, accounts: [partial2], entries: [settleEntry('pe2', 300)] }, opts)
    expect(bal(s2, '2000')).toBe(30000n)
    expect(s2.ledger.events.filter((e) => e.idempotencyKey === 'account:pp1:settle:2')).toHaveLength(1)

    const full: Account = { ...open, status: 'paid', paidAt: TODAY, settlements: [...partial2.settlements!, { id: 'st3', sequence: 3, amount: 300, date: TODAY }] }
    const s3 = autoPost({ ...s2, accounts: [partial2] }, { ...s2, accounts: [full], entries: [settleEntry('pe3', 300)] }, opts)
    expect(bal(s3, '2000')).toBe(0n)
    expect(s3.ledger.journal.filter((j) => !j.reversalOf)).toHaveLength(4) // obrigação + 3 baixas
  })

  test('conta parcial aparece no Centro de Conciliação como parcial, com saldo em aberto', () => {
    const prev = base({ payables: true })
    const open = acct({ id: 'pp2', amount: 1000 })
    const created = autoPost(prev, { ...prev, accounts: [open] }, opts)
    const partial: Account = { ...open, settlements: [{ id: 'st1', sequence: 1, amount: 400, date: TODAY }] }
    const s1 = autoPost({ ...created, accounts: [open] }, { ...created, accounts: [partial], entries: [cashIn({ id: 'pe1', type: 'out', category: 'Aluguel', description: open.description, amount: 400 })] }, opts)
    const items = buildReconciliation({ ...s1, accounts: [partial], entries: [cashIn({ id: 'pe1', type: 'out', category: 'Aluguel', description: open.description, amount: 400 })] })
    const it = items.find((i) => i.key === 'account:pp2')!
    expect(it).toMatchObject({ state: 'pending', reason: 'partial_payment', amount: 600 })
  })
})

describe('conciliação histórica de compras', () => {
  test('dry-run propõe; aplicar lança uma vez; reprocessar não duplica', () => {
    const d = base({})
    const purchase: PurchaseRef = { id: 'PUR-0009', date: '2026-10-05', supplierName: 'Forn', items: [], total: 150, stockPosted: true, createdAt: NOW }
    const ap = acct({ id: 'ap9', source: 'purchase', category: 'Compra de mercadorias', description: 'Compra de mercadorias - Forn', contactName: 'Forn', amount: 150 })
    const data: AppData = { ...d, purchases: [purchase], accounts: [ap] }
    const plan = planPurchaseReconciliation(data)
    expect(plan).toHaveLength(1)
    expect(plan[0]!.status).toBe('ready')
    expect(plan[0]!.draft!.idempotencyKey).toBe('purchase:PUR-0009:recorded')
    const applied = applyPurchaseReconciliation(data.ledger, plan, ctx)
    expect(applied.posted).toBe(1)
    expect(bal({ ...data, ledger: applied.ledger }, '1200')).toBe(15000n)
    expect(bal({ ...data, ledger: applied.ledger }, '2000')).toBe(15000n)
    const again = applyPurchaseReconciliation(applied.ledger, plan, ctx)
    expect(again.posted).toBe(0)
    expect(again.duplicates).toBe(1)
    expect(again.ledger.journal).toHaveLength(1)
    const replan = planPurchaseReconciliation({ ...data, ledger: applied.ledger })
    expect(replan[0]!.status).toBe('posted')
  })

  test('aguardando recebimento e sem evidência ficam fora do lançamento', () => {
    const d = base({})
    const waiting: PurchaseRef = { id: 'PUR-0010', date: '2026-10-05', supplierName: 'Forn', items: [], total: 80, stockPosted: false, createdAt: NOW }
    const noEvidence: PurchaseRef = { id: 'PUR-0011', date: '2026-10-05', supplierName: 'Forn', items: [], total: 90, stockPosted: true, createdAt: NOW }
    const plan = planPurchaseReconciliation({ ...d, purchases: [waiting, noEvidence] })
    expect(plan.find((i) => i.purchaseId === 'PUR-0010')!.status).toBe('awaiting_receipt')
    expect(plan.find((i) => i.purchaseId === 'PUR-0011')!.status).toBe('requires_review')
    const applied = applyPurchaseReconciliation(d.ledger, plan, ctx)
    expect(applied.posted).toBe(0)
    expect(applied.rejected).toBe(2)
  })

  test('compra paga na hora (saída no Livro-Caixa) lança Dr Estoque / Cr Caixa', () => {
    const d = base({})
    const purchase: PurchaseRef = { id: 'PUR-0012', date: '2026-10-05', supplierName: 'Forn', items: [], total: 200, stockPosted: true, createdAt: NOW }
    const entry = cashIn({ id: 'pc1', type: 'out', category: 'Compra de mercadorias', description: 'Compra', amount: 200, date: '2026-10-05' })
    const data = { ...d, purchases: [purchase], entries: [entry] }
    const plan = planPurchaseReconciliation(data)
    expect(plan[0]!.status).toBe('ready')
    expect(plan[0]!.paidNow).toBe(true)
    const applied = applyPurchaseReconciliation(data.ledger, plan, ctx)
    expect(bal({ ...data, ledger: applied.ledger }, '1200')).toBe(20000n)
    expect(bal({ ...data, ledger: applied.ledger }, '1000')).toBe(-20000n)
  })
})
