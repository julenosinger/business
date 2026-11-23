import { describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

try {
  GlobalRegistrator.register()
} catch {
  // Já registrado em outro arquivo de teste do mesmo processo.
}

const { emptyData } = await import('../src/lib/store')
const { businessContext, businessTools } = await import('../src/lib/intelligence')
const { today, addDays } = await import('../src/lib/format')

describe('inteligência operacional (indicadores reais, por moeda)', () => {
  test('resumo de vendas usa moeda da empresa e exclui canceladas', () => {
    const d = emptyData()
    d.settings.currency = 'BRL'
    d.sales = [
      { id: 's1', date: today(), customerId: undefined, customerName: 'A', items: [], total: 100, cogs: 60, method: 'pix', environment: 'mainnet' },
      { id: 's2', date: today(), customerId: undefined, customerName: 'B', items: [], total: 50, cogs: 30, method: 'pix', environment: 'mainnet', canceledAt: '2026-01-01T00:00:00.000Z' },
      { id: 's3', date: '2000-01-01', customerId: undefined, customerName: 'C', items: [], total: 999, cogs: 0, method: 'pix', environment: 'mainnet' },
    ]
    const s = businessTools.salesSummary(d, 'mainnet')
    expect(s.count).toBe(1)
    expect(s.total).toEqual({ value: 100, currency: 'BRL' })
    expect(s.averageTicket).toBe(100)
  })

  test('a receber e a pagar são agrupados por moeda, nunca somados', () => {
    const d = emptyData()
    d.accounts = [
      { id: 'a1', kind: 'receivable', description: 'R', contactName: 'C', amount: 100, dueDate: addDays(today(), 10), category: 'Vendas', status: 'open', source: 'manual', currency: 'BRL', environment: 'mainnet' },
      { id: 'a2', kind: 'receivable', description: 'R2', contactName: 'C', amount: 50, dueDate: addDays(today(), 10), category: 'Vendas', status: 'open', source: 'manual', currency: 'USDC', environment: 'mainnet' },
      { id: 'a3', kind: 'payable', description: 'P', contactName: 'S', amount: 200, dueDate: addDays(today(), -5), category: 'Aluguel', status: 'open', source: 'manual', currency: 'BRL', environment: 'mainnet' },
    ]
    const rec = businessTools.receivablesSummary(d, 'mainnet')
    expect(rec.open).toEqual([
      { value: 100, currency: 'BRL' },
      { value: 50, currency: 'USDC' },
    ])
    const pay = businessTools.payablesSummary(d, 'mainnet')
    expect(pay.open).toEqual([{ value: 200, currency: 'BRL' }])
    expect(pay.overdue).toEqual([{ value: 200, currency: 'BRL' }])
  })

  test('liquidação parcial é identificada e saldo usa o valor em aberto', () => {
    const d = emptyData()
    d.accounts = [
      {
        id: 'a1', kind: 'receivable', description: 'Parcial', contactName: 'C', amount: 100, dueDate: addDays(today(), 10), category: 'Vendas', status: 'open', source: 'manual', currency: 'BRL', environment: 'mainnet',
        settlements: [{ id: 'st1', sequence: 1, amount: 30, date: today() }],
      },
    ]
    const rec = businessTools.receivablesSummary(d, 'mainnet')
    expect(rec.partialCount).toBe(1)
    expect(rec.open).toEqual([{ value: 70, currency: 'BRL' }])
  })

  test('isolamento Mainnet/Testnet: contas de outro ambiente ficam fora', () => {
    const d = emptyData()
    d.accounts = [
      { id: 'm', kind: 'receivable', description: 'M', contactName: 'C', amount: 100, dueDate: addDays(today(), 10), category: 'Vendas', status: 'open', source: 'manual', currency: 'BRL', environment: 'mainnet' },
      { id: 't', kind: 'receivable', description: 'T', contactName: 'C', amount: 999, dueDate: addDays(today(), 10), category: 'Vendas', status: 'open', source: 'manual', currency: 'BRL', environment: 'testnet' },
    ]
    const rec = businessTools.receivablesSummary(d, 'mainnet')
    expect(rec.openCount).toBe(1)
    expect(rec.open).toEqual([{ value: 100, currency: 'BRL' }])
  })

  test('estoque baixo é listado com valores reais', () => {
    const d = emptyData()
    d.products = [
      { id: 'p1', sku: 'S1', name: 'Produto A', category: 'Geral', unit: 'un', cost: 10, price: 20, stock: 2, minStock: 5, environment: 'mainnet' },
      { id: 'p2', sku: 'S2', name: 'Produto B', category: 'Geral', unit: 'un', cost: 5, price: 9, stock: 10, minStock: 3, environment: 'mainnet' },
    ]
    const s = businessTools.stockSummary(d, 'mainnet')
    expect(s.lowStock).toEqual([{ name: 'Produto A', stock: 2, minStock: 5 }])
  })

  test('contagem de itens do estoque considera somente o ambiente selecionado', () => {
    const d = emptyData()
    d.products = [
      { id: 'p1', sku: 'S1', name: 'A', category: 'Geral', unit: 'un', cost: 1, price: 2, stock: 1, minStock: 0, environment: 'mainnet' },
      { id: 'p2', sku: 'S2', name: 'B', category: 'Geral', unit: 'un', cost: 1, price: 2, stock: 1, minStock: 0, environment: 'testnet' },
    ]
    expect(businessTools.stockSummary(d, 'mainnet').totalItems).toBe(1)
    expect(businessTools.stockSummary(d, 'testnet').totalItems).toBe(1)
  })

  test('contexto consolidado distingue ausência de dados (sem erro)', () => {
    const d = emptyData()
    const ctx = businessContext(d, 'mainnet')
    expect(ctx.company).toBeTruthy()
    expect(ctx.sales.count).toBe(0)
    expect(ctx.receivables.openCount).toBe(0)
    expect(ctx.payables.openCount).toBe(0)
    expect(ctx.stock.totalItems).toBe(0)
    expect(ctx.period.label).toBeTruthy()
  })
})
