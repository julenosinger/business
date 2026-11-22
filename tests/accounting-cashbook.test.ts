import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// O store/backup importam módulos que tocam o DOM no carregamento; os stubs vêm antes dos imports dinâmicos.
const g = globalThis as unknown as Record<string, unknown>
const store: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { emptyLedger, postEvent, trialBalance, isReversed } = await import('../src/lib/accounting/engine')
const { syncAdded, syncRemoved, syncUpdated } = await import('../src/lib/accounting/cashbook-sync')
const { reconcileCashBook } = await import('../src/lib/accounting/reconcile')
const { emptyData, guardLedger } = await import('../src/lib/store')
const { parseBackup } = await import('../src/lib/backup')
const { buildDemoData } = await import('../src/lib/demo')
const { kpis, monthlySeries, expensesByCategory, accountTotals } = await import('../src/lib/selectors')
type Row = { id: string; type: 'in' | 'out'; amount: number; date: string; category: string; description?: string }

const NOW = '2026-11-22T10:00:00.000Z'
const ctx = { now: NOW, actor: { id: 'Dono', kind: 'user' as const }, currency: 'USDC' as const }
const row = (over: Partial<Row> = {}): Row => ({ id: 'c1', type: 'in', amount: 120.5, date: '2026-11-22', category: 'Outras receitas', description: 'Teste', ...over })

describe('Livro-Caixa x razão (compatibilidade)', () => {
  test('lançamento novo gera 1 lançamento no razão com vínculo, moeda e ator', () => {
    const l = syncAdded(emptyLedger(), row(), ctx)
    expect(l.journal).toHaveLength(1)
    const je = l.journal[0]!
    expect(je.currency).toBe('USDC')
    expect(je.links.cashEntryId).toBe('c1')
    expect(je.postedBy).toEqual({ id: 'Dono', kind: 'user' })
    expect(je.lines.find((x) => x.side === 'debit')!.amountMinor).toBe('120500000') // 120,5 USDC em 6 casas
    expect(reconcileCashBook(l, [row()]).clean).toBe(true)
  })
  test('mesmo lançamento processado duas vezes não duplica (sem entrada de caixa duplicada)', () => {
    const once = syncAdded(emptyLedger(), row(), ctx)
    const twice = syncAdded(once, row(), ctx)
    expect(twice.journal).toHaveLength(1)
    expect(reconcileCashBook(twice, [row()]).duplicates).toEqual([])
  })
  test('adaptador desligado não registra nada', () => {
    const off = { ...emptyLedger(), flags: { adapters: { ...emptyLedger().flags.adapters, cashBook: false } } }
    const l = syncAdded(off, row(), ctx)
    expect(l.journal).toHaveLength(0)
    expect(l.events).toHaveLength(0)
  })
  test('edição financeira estorna e relança; saldo do razão acompanha o caixa', () => {
    let l = syncAdded(emptyLedger(), row(), ctx)
    const after = row({ amount: 80, category: 'Rendimentos' })
    l = syncUpdated(l, row(), after, ctx)
    expect(l.journal).toHaveLength(3) // original + estorno + novo
    expect(isReversed(l, l.journal[0]!.id)).toBe(true)
    expect(reconcileCashBook(l, [after]).clean).toBe(true)
    expect(trialBalance(l)[0]!.rows.find((r) => r.code === '1000')!.balance).toBe(80_000_000n)
    // outra edição gera a revisão seguinte, sem colidir chaves
    l = syncUpdated(l, after, { ...after, amount: 90 }, ctx)
    expect(l.events.filter((e) => e.idempotencyKey.startsWith('cashbook:c1:r')).map((e) => e.idempotencyKey)).toEqual(['cashbook:c1:r0', 'cashbook:c1:r1', 'cashbook:c1:r2'])
    expect(reconcileCashBook(l, [{ ...after, amount: 90 }]).clean).toBe(true)
  })
  test('edição só de descrição não mexe no razão', () => {
    const l = syncAdded(emptyLedger(), row(), ctx)
    const same = syncUpdated(l, row(), row({ description: 'Outro texto' }), ctx)
    expect(same).toBe(l)
  })
  test('moeda do lançamento existente é preservada mesmo se a moeda do app mudou', () => {
    const brl = { ...ctx, currency: 'BRL' as const }
    let l = syncAdded(emptyLedger(), row(), brl)
    expect(l.journal[0]!.currency).toBe('BRL')
    l = syncUpdated(l, row(), row({ amount: 50 }), { ...ctx, currency: 'USDC' }) // app agora em USDC
    expect(l.journal.every((j) => j.currency === 'BRL')).toBe(true)
  })
  test('remoção estorna uma única vez; histórico legado fica intocado', () => {
    let l = syncAdded(emptyLedger(), row(), ctx)
    l = syncRemoved(l, row(), ctx)
    expect(l.journal).toHaveLength(2)
    expect(trialBalance(l)[0]!.rows.every((r) => r.balance === 0n)).toBe(true)
    const again = syncRemoved(l, row(), ctx)
    expect(again.journal).toHaveLength(2)
    const legacy = emptyLedger()
    expect(syncRemoved(legacy, row({ id: 'old' }), ctx)).toBe(legacy)
    expect(syncUpdated(legacy, row({ id: 'old' }), row({ id: 'old', amount: 1 }), ctx)).toBe(legacy)
  })
  test('falha dentro do razão nunca propaga (o Livro-Caixa tem prioridade)', () => {
    const data = emptyData()
    const out = guardLedger(data, () => {
      throw new Error('boom')
    })
    expect(out).toBe(data.ledger)
  })
})

describe('DRE e dados existentes', () => {
  test('o razão não altera DRE nem indicadores (selectors não leem o razão)', () => {
    const demo = buildDemoData('BRL')
    const period = { from: '2000-01-01', to: '2100-01-01', label: 'all' }
    const withLedger = { ...demo, ledger: syncAdded(demo.ledger, row({ id: 'novo' }), ctx) }
    expect(kpis(withLedger, period)).toEqual(kpis(demo, period))
    expect(expensesByCategory(withLedger, period)).toEqual(expensesByCategory(demo, period))
    expect(monthlySeries(withLedger, 6)).toEqual(monthlySeries(demo, 6))
    expect(accountTotals(withLedger)).toEqual(accountTotals(demo))
    const src = readFileSync(new URL('../src/lib/selectors.ts', import.meta.url), 'utf8')
    expect(src.includes('accounting')).toBe(false)
  })
  test('registros de demonstração permanecem idênticos e fora do razão', () => {
    const demo = buildDemoData('BRL')
    const snapshot = JSON.stringify(demo.entries)
    const l = syncAdded(demo.ledger, row({ id: 'manual-1' }), ctx)
    expect(JSON.stringify(demo.entries)).toBe(snapshot)
    expect(demo.ledger.journal).toHaveLength(0)
    const report = reconcileCashBook(l, demo.entries.map((e) => ({ id: e.id, type: e.type, amount: e.amount, date: e.date, category: e.category })))
    expect(report.legacyUnledgered).toHaveLength(demo.entries.length) // sinalizados, não reclassificados
    expect(report.legacyUnledgered.every((x) => x.reason === 'unknown_currency')).toBe(true)
  })
  test('nova instalação inicia com razão vazio e adaptador do Livro-Caixa ligado', () => {
    const d = emptyData()
    expect(d.ledger.journal).toHaveLength(0)
    expect(d.ledger.flags.adapters.cashBook).toBe(true)
    expect(d.ledger.flags.adapters.treasury).toBe(false)
    expect(d.settings.currency).toBe('USDC')
  })
})

describe('backup preserva o razão', () => {
  test('exporta e restaura lançamentos; backup antigo sem razão continua válido', () => {
    const d = emptyData()
    const withEntry = { ...d, entries: [{ id: 'c1', date: '2026-11-22', type: 'in' as const, category: 'Outras receitas', description: 'x', amount: 10 }], ledger: syncAdded(d.ledger, row({ amount: 10 }), ctx) }
    const text = JSON.stringify({ app: 'global-business-os', version: 1, data: withEntry })
    const back = parseBackup(text)
    expect(back.ok && back.data.ledger.journal).toHaveLength(1)
    const oldText = JSON.stringify({ app: 'global-business-os', version: 1, data: { ...withEntry, ledger: undefined } })
    const old = parseBackup(oldText)
    expect(old.ok && old.data.ledger.journal).toHaveLength(0)
    const junk = parseBackup(JSON.stringify({ app: 'global-business-os', version: 1, data: { ...withEntry, ledger: { journal: 'oops', chart: 5 } } }))
    expect(junk.ok && junk.data.ledger.chart.length).toBeGreaterThan(10)
  })
  test('importação histórica manual não reaproveita chaves já lançadas', () => {
    const l = syncAdded(emptyLedger(), row(), ctx)
    const posted = postEvent(l, { ...l.events[0]!, id: undefined } as never, { now: NOW, actor: { id: 'x', kind: 'user' } })
    expect(posted.ledger.journal).toHaveLength(1)
  })
})
