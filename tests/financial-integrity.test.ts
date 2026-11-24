import { describe, expect, test } from 'bun:test'

// O store importa módulos que tocam o DOM/localStorage no carregamento; stubs vêm antes dos imports dinâmicos.
const g = globalThis as unknown as Record<string, unknown>
const storage: Record<string, string> = {}
g.localStorage = { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => void (storage[k] = v), removeItem: (k: string) => void delete storage[k] }
g.navigator = { language: 'pt-BR' }
const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, dataset: {}, classList: { add() {}, remove() {} } })
g.document = { documentElement: el(), head: el(), body: el(), createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [el()], querySelector: () => null, addEventListener() {}, removeEventListener() {} }
g.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, localStorage: g.localStorage }

const { kpis, expensesByCategory, monthPeriod } = await import('../src/lib/selectors')
const { emptyData } = await import('../src/lib/store')
const { emptyLedger, normalizeLedger, postEvent } = await import('../src/lib/accounting/engine')
const { cashBookEvent } = await import('../src/lib/accounting/adapters')
const { isUnsupportedCategory, natureOfCategory, categoryRequiresCogs } = await import('../src/lib/financial-categories')
import type { AppData, Entry, Sale } from '../src/lib/types'
import { CAT_PURCHASE, CAT_SALES } from '../src/lib/types'

const P = monthPeriod(0)
const entry = (over: Partial<Entry> = {}): Entry => ({ id: 'e', date: P.from, type: 'in', category: 'Outras receitas', description: 'd', amount: 100, ...over })
const sale = (over: Partial<Sale> = {}): Sale => ({ id: 's', date: P.from, customerName: 'c', items: [], total: 100, cogs: 40, method: 'pix', ...over })

describe('integridade financeira (FIN-03.2) — classificação por natureza', () => {
  test('não trata toda entrada como receita nem toda saída como despesa', () => {
    // Reembolso (direito, natureza ativo) NÃO é receita; equipamento (ativo) NÃO é despesa.
    const d: AppData = {
      ...emptyData(),
      entries: [
        entry({ id: 'in-reembolso', type: 'in', category: 'Reembolsos', amount: 1000 }),
        entry({ id: 'out-equip', type: 'out', category: 'Equipamentos', amount: 2000 }),
        entry({ id: 'in-servico', type: 'in', category: 'Serviços prestados', amount: 500 }),
        entry({ id: 'out-aluguel', type: 'out', category: 'Aluguel', amount: 300 }),
      ],
    }
    const k = kpis(d, P)
    expect(k.revenue).toBe(500) // só a receita de serviços
    expect(k.opex).toBe(300) // só o aluguel
    expect(k.inflow).toBe(1500) // caixa: 1000 + 500
    expect(k.outflow).toBe(2300) // caixa: 2000 + 300
  })

  test('compra de estoque (matéria-prima/insumos/embalagens) não é despesa nem reduz o lucro', () => {
    const d: AppData = {
      ...emptyData(),
      sales: [sale({ total: 5000, cogs: 2000 })],
      entries: [
        entry({ id: 'v', type: 'in', category: CAT_SALES, amount: 5000 }),
        entry({ id: 'mp', type: 'out', category: 'Matéria-prima', amount: 4000 }),
        entry({ id: 'in', type: 'out', category: 'Insumos', amount: 1000 }),
        entry({ id: 'emb', type: 'out', category: 'Embalagens', amount: 500 }),
        entry({ id: 'al', type: 'out', category: 'Aluguel', amount: 300 }),
      ],
    }
    const k = kpis(d, P)
    expect(k.cogs).toBe(2000) // apenas da venda, nunca inferido das compras
    expect(k.opex).toBe(300) // só aluguel; matéria-prima/insumos/embalagens ficam no estoque
    expect(k.grossProfit).toBe(3000)
    expect(k.profit).toBe(2700)
  })

  test('Cenário: venda 500.000 com CMV 300.000, compra 300.000 e despesa 3.000', () => {
    const d: AppData = {
      ...emptyData(),
      sales: [sale({ id: 's1', total: 500000, cogs: 300000 })],
      entries: [
        entry({ id: 'e-venda', type: 'in', category: CAT_SALES, amount: 500000 }),
        entry({ id: 'e-compra', type: 'out', category: CAT_PURCHASE, amount: 300000 }),
        entry({ id: 'e-desp', type: 'out', category: 'Impostos', amount: 3000 }),
      ],
    }
    const k = kpis(d, P)
    expect(k.revenue).toBe(500000)
    expect(k.cogs).toBe(300000)
    expect(k.grossProfit).toBe(200000)
    expect(k.opex).toBe(3000)
    expect(k.profit).toBe(197000)
    expect(k.inflow).toBe(500000)
    expect(k.outflow).toBe(303000)
    expect(k.inflow - k.outflow).toBe(197000) // resultado de caixa
    expect(k.cogsIncomplete).toBe(false)
    // Margem líquida = 197000 / 500000 = 39,4%
    expect(Math.round((k.profit / k.revenue) * 1000) / 10).toBe(39.4)
  })

  test('recebimento classificado como venda de mercadorias sem vínculo sinaliza CMV incompleto', () => {
    const d: AppData = {
      ...emptyData(),
      entries: [entry({ id: 'e', type: 'in', category: 'Venda de mercadorias', amount: 500000 })],
    }
    const k = kpis(d, P)
    expect(k.revenue).toBe(500000)
    expect(k.cogs).toBe(0)
    expect(k.cogsIncomplete).toBe(true)
    // "Outras receitas" (sem exigência de CMV) não sinaliza incompletude.
    const k2 = kpis({ ...emptyData(), entries: [entry({ id: 'e2', category: 'Outras receitas', amount: 500000 })] }, P)
    expect(k2.cogsIncomplete).toBe(false)
  })

  test('liquidação de venda a prazo não duplica a receita', () => {
    const d: AppData = {
      ...emptyData(),
      sales: [sale({ id: 's1', total: 500000, cogs: 300000, method: 'prazo' })],
      // Recebimento posterior da conta a receber (categoria interna de vendas).
      entries: [entry({ id: 'e-receb', type: 'in', category: CAT_SALES, amount: 500000, sourceKind: 'account' })],
    }
    const k = kpis(d, P)
    expect(k.revenue).toBe(500000) // uma única vez
    expect(k.cogs).toBe(300000)
  })

  test('expensesByCategory exclui compras de estoque (cogs) e mantém despesas reais', () => {
    const d: AppData = {
      ...emptyData(),
      entries: [
        entry({ id: 'a', type: 'out', category: 'Aluguel', amount: 300 }),
        entry({ id: 'b', type: 'out', category: CAT_PURCHASE, amount: 5000 }),
        entry({ id: 'c', type: 'out', category: 'Matéria-prima', amount: 2000 }),
      ],
    }
    expect(expensesByCategory(d, P).map((c) => c.category)).toEqual(['Aluguel'])
  })
})

describe('catálogo: natureza e suporte (FIN-03.2)', () => {
  test('natureOfCategory e categoryRequiresCogs', () => {
    expect(natureOfCategory('Venda de mercadorias')).toBe('revenue')
    expect(natureOfCategory('Compra de mercadorias')).toBe('cogs')
    expect(natureOfCategory('Reembolsos')).toBe('asset')
    expect(natureOfCategory('Categoria desconhecida')).toBeUndefined()
    expect(categoryRequiresCogs('Venda de mercadorias')).toBe(true)
    expect(categoryRequiresCogs('Serviços prestados')).toBe(false)
  })

  test('isUnsupportedCategory só rejeita categorias explicitamente não suportadas', () => {
    expect(isUnsupportedCategory('Reembolsos')).toBe(true)
    expect(isUnsupportedCategory('Equipamentos')).toBe(true)
    expect(isUnsupportedCategory('Aluguel')).toBe(false)
    expect(isUnsupportedCategory('Categoria histórica desconhecida')).toBe(false) // legado preservado
  })
})

describe('motor contábil rejeita categorias não suportadas (FIN-03.2)', () => {
  test('adaptador do Livro-Caixa recusa supported:false', () => {
    const l = emptyLedger()
    const res = cashBookEvent(l, { id: 'c1', type: 'in', amount: 100, date: '2026-11-22', category: 'Reembolsos' }, { currency: 'USDC', revision: 0 })
    expect(res).toEqual({ ok: false, reason: 'unsupported_category' })
  })

  test('regra cashbook.income recusa categoria não suportada', () => {
    const ctx = { now: '2026-11-22T10:00:00.000Z', actor: { id: 'Dono', kind: 'user' as const } }
    const draft = {
      orgId: 'local',
      idempotencyKey: 'k1',
      type: 'cashbook.income' as const,
      source: { module: 'cashbook' as const, recordId: 'c1' },
      occurredAt: ctx.now,
      accountingDate: '2026-11-22',
      currency: 'USDC' as const,
      amountMinor: '100000000',
      payload: { category: 'Reembolsos' },
      confirmation: 'confirmed' as const,
    }
    const res = postEvent(emptyLedger(), draft, ctx)
    expect(res.ok).toBe(false)
    expect(res.errors).toContain('unsupported_category')
  })

  test('regra payable.created recusa categoria não suportada (não contabiliza como despesa)', () => {
    const ctx = { now: '2026-11-22T10:00:00.000Z', actor: { id: 'Dono', kind: 'user' as const } }
    const draft = {
      orgId: 'local',
      idempotencyKey: 'k2',
      type: 'payable.created' as const,
      source: { module: 'payables' as const, recordId: 'a1' },
      occurredAt: ctx.now,
      accountingDate: '2026-11-22',
      currency: 'USDC' as const,
      amountMinor: '100000000',
      payload: { category: 'Empréstimos e financiamentos', description: 'x' },
      confirmation: 'confirmed' as const,
    }
    const res = postEvent(emptyLedger(), draft, ctx)
    expect(res.ok).toBe(false)
    expect(res.errors).toContain('unsupported_category')
  })
})

describe('migração aditiva e idempotente dos mapeamentos (FIN-03.2)', () => {
  test('normalizeLedger mescla mapeamentos novos preservando personalizações', () => {
    const merged = normalizeLedger({ categoryMap: { Aluguel: 'expense_tax' } })
    expect(merged.categoryMap['Aluguel']).toBe('expense_tax') // personalização preservada
    expect(merged.categoryMap['Compra de mercadorias']).toBe('inventory') // padrão presente
    expect(merged.categoryMap['Matéria-prima']).toBe('inventory') // categoria nova adicionada
    expect(merged.categoryMap['Taxas de transação']).toBe('expense_fees')
    // Idempotente: mesclar de novo não altera nada.
    const again = normalizeLedger({ categoryMap: merged.categoryMap })
    expect(again.categoryMap).toEqual(merged.categoryMap)
  })
})
