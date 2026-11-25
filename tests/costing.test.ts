import { describe, expect, test } from 'bun:test'
import { weightedAverageCost } from '../src/lib/costing'

describe('custo médio ponderado móvel (FIN-02 hotfix)', () => {
  test('média ponderada preserva o custo do estoque antigo', () => {
    // Arroz: 150.000 × 5 + 30.000 × 6 = 180.000 unidades, valor 930.000.
    const avg = weightedAverageCost(150000, 5, 30000, 6)
    expect(avg).toBeCloseTo(930000 / 180000, 10)
    expect(avg).toBeCloseTo(5.1666667, 6)
  })

  test('último custo NUNCA deve valorizar o estoque inteiro', () => {
    const avg = weightedAverageCost(150000, 5, 30000, 6)
    expect(avg).not.toBe(6) // não é o último custo
    expect(avg).toBeLessThan(6)
  })

  test('primeira entrada com estoque zero adota o custo da entrada', () => {
    expect(weightedAverageCost(0, 0, 30000, 6)).toBe(6)
  })

  test('estoque total zero preserva o custo anterior', () => {
    expect(weightedAverageCost(0, 5, 0, 6)).toBe(5)
  })

  test('cenário completo: valor de estoque esperado pelo custo médio = 2.370.000', () => {
    // Feijão 100.000×6, Arroz 150.000×5, Café 100.000×9 = 2.250.000.
    // Entrada arroz: +30.000×6 → custo médio arroz.
    // Venda feijão 10.000 → CMV 60.000.
    const feijao = { stock: 100000 - 10000, cost: 6 }
    const arroz = { stock: 180000, cost: weightedAverageCost(150000, 5, 30000, 6) }
    const cafe = { stock: 100000, cost: 9 }
    const value = Math.round((feijao.stock * feijao.cost + arroz.stock * arroz.cost + cafe.stock * cafe.cost) * 100) / 100
    expect(value).toBe(2370000)
  })
})
