import { describe, expect, test } from 'bun:test'
import { quantityError, parseQuantity } from '../src/lib/quantity'

describe('edição direta de quantidade no carrinho (FIN-03.2)', () => {
  test('aceita quantidades inteiras positivas dentro do estoque', () => {
    expect(quantityError('1', 100)).toBeNull()
    expect(quantityError('50000', 50000)).toBeNull()
    expect(quantityError('1000000', 2000000)).toBeNull()
  })

  test('campo vazio é estado temporário de edição (não é zero nem inválido-final)', () => {
    expect(quantityError('', 100)).toBe('empty')
    expect(quantityError('   ', 100)).toBe('empty')
  })

  test('zero é rejeitado', () => {
    expect(quantityError('0', 100)).toBe('zero')
  })

  test('negativo é rejeitado', () => {
    expect(quantityError('-5', 100)).toBe('invalid')
  })

  test('notação científica é rejeitada', () => {
    expect(quantityError('1e5', 1000000)).toBe('invalid')
    expect(quantityError('1E3', 1000000)).toBe('invalid')
  })

  test('valores não finitos são rejeitados', () => {
    expect(quantityError('Infinity', 100)).toBe('invalid')
    expect(quantityError('NaN', 100)).toBe('invalid')
  })

  test('decimais e separadores são rejeitados (produto por unidade)', () => {
    expect(quantityError('1.5', 100)).toBe('invalid')
    expect(quantityError('1,5', 100)).toBe('invalid')
  })

  test('quantidade acima do estoque é rejeitada', () => {
    expect(quantityError('101', 100)).toBe('over_stock')
    expect(quantityError('50001', 50000)).toBe('over_stock')
  })

  test('valores acima do limite numérico seguro são rejeitados', () => {
    expect(quantityError('99999999999999999999', Number.MAX_SAFE_INTEGER)).toBe('invalid')
  })

  test('parseQuantity devolve o inteiro apenas quando válido', () => {
    expect(parseQuantity('50000', 50000)).toBe(50000)
    expect(parseQuantity('0', 100)).toBeNull()
    expect(parseQuantity('1e5', 1000000)).toBeNull()
    expect(parseQuantity('101', 100)).toBeNull()
  })
})
