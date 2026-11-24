import { describe, expect, test } from 'bun:test'
import { FINANCIAL_CATEGORIES, categoriesFor, categoryById, supportedCategoryIds, type FinancialGroup } from '../src/lib/financial-categories'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../src/lib/types'
import { defaultCategoryMap } from '../src/lib/accounting/chart'

describe('catálogo financeiro (FIN-03)', () => {
  test('categorias suportadas coincidem com as listas selecionáveis', () => {
    expect([...supportedCategoryIds('income')].sort()).toEqual([...INCOME_CATEGORIES].sort())
    expect([...supportedCategoryIds('expense')].sort()).toEqual([...EXPENSE_CATEGORIES].sort())
  })

  test('toda categoria suportada possui mapeamento contábil', () => {
    const map = defaultCategoryMap()
    for (const c of categoriesFor('income')) expect(map[c.id]).toBeTruthy()
    for (const c of categoriesFor('expense')) expect(map[c.id]).toBeTruthy()
  })

  test('categorias ampliadas estão presentes e agrupadas', () => {
    expect(INCOME_CATEGORIES).toContain('Venda de mercadorias')
    expect(INCOME_CATEGORIES).toContain('Consultoria')
    expect(INCOME_CATEGORIES).toContain('Juros recebidos')
    expect(EXPENSE_CATEGORIES).toContain('Matéria-prima')
    expect(EXPENSE_CATEGORIES).toContain('Energia elétrica')
    expect(EXPENSE_CATEGORIES).toContain('Benefícios')
    expect(EXPENSE_CATEGORIES).toContain('Taxas de transação')

    const groups = new Set<FinancialGroup>(categoriesFor('income').map((c) => c.group))
    expect(groups.has('operational_revenue')).toBe(true)
    expect(groups.has('financial_revenue')).toBe(true)
  })

  test('naturezas não suportadas (direitos/investimentos) não aparecem nos seletores', () => {
    const ids = new Set(FINANCIAL_CATEGORIES.map((c) => c.id))
    expect(ids.has('Reembolsos')).toBe(true) // no catálogo
    expect(INCOME_CATEGORIES).not.toContain('Reembolsos') // fora do seletor
    expect(EXPENSE_CATEGORIES).not.toContain('Equipamentos') // fora do seletor
    expect(categoryById('Reembolsos')?.supported).toBe(false)
    expect(categoryById('Equipamentos')?.supported).toBe(false)
  })

  test('categorias históricas existentes são preservadas', () => {
    expect(INCOME_CATEGORIES).toContain('Serviços prestados')
    expect(INCOME_CATEGORIES).toContain('Outras receitas')
    expect(EXPENSE_CATEGORIES).toContain('Compra de mercadorias')
    expect(EXPENSE_CATEGORIES).toContain('Folha de pagamento')
    expect(EXPENSE_CATEGORIES[2]).toBe('Aluguel') // índice usado como padrão
  })
})
