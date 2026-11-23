import { describe, expect, test } from 'bun:test'

// Stubs mínimos: format.ts importa i18n, que lê navigator/document no carregamento.
const g = globalThis as unknown as Record<string, unknown>
g.navigator = { language: 'pt-BR' }
g.document = { documentElement: { lang: '' } }
g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { groupMoneyByCurrency, formatMoneyGroup } = await import('../src/lib/profile-money')

describe('agrupamento monetário (integridade financeira)', () => {
  test('separa valores por moeda real', () => {
    const groups = groupMoneyByCurrency([
      { amount: 100, currency: 'BRL' },
      { amount: 200, currency: 'BRL' },
      { amount: 50, currency: 'USDC' },
      { amount: 30, currency: 'USD' },
    ])
    expect(groups).toEqual([
      { code: 'BRL', total: 300 },
      { code: 'USDC', total: 50 },
      { code: 'USD', total: 30 },
    ])
  })

  test('registros sem moeda identificada são agrupados como unspecified', () => {
    const groups = groupMoneyByCurrency([{ amount: 10 }, { amount: 20, currency: 'BRL' }])
    expect(groups).toEqual([
      { code: 'unspecified', total: 10 },
      { code: 'BRL', total: 20 },
    ])
  })

  test('formatMoneyGroup não atribui símbolo arbitrário a unspecified', () => {
    expect(formatMoneyGroup({ code: 'unspecified', total: 12.5 })).not.toContain('$')
    expect(formatMoneyGroup({ code: 'unspecified', total: 12.5 })).not.toContain('R$')
    expect(formatMoneyGroup({ code: 'unspecified', total: 12.5 })).not.toContain('USDC')
    expect(formatMoneyGroup({ code: 'BRL', total: 12.5 })).toContain('R$')
  })

  test('lista vazia produz grupos vazios', () => {
    expect(groupMoneyByCurrency([])).toEqual([])
  })
})
