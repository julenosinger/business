import { describe, expect, test } from 'bun:test'
import { barcodeIsValid, validateProduct, marginOf, markupOf, type ProductValues } from '../src/lib/product'

const base: ProductValues = {
  name: 'Arroz', sku: 'AR1', cost: 5, price: 8, stock: 0, minStock: 0,
}

describe('validação de código de barras (INV-1.0)', () => {
  test('aceita GTIN/EAN/UPC de 8, 12, 13 e 14 dígitos', () => {
    expect(barcodeIsValid('12345678')).toBe(true)
    expect(barcodeIsValid('123456789012')).toBe(true)
    expect(barcodeIsValid('7891234567890')).toBe(true)
    expect(barcodeIsValid('12345678901234')).toBe(true)
  })
  test('rejeita códigos com tamanho inválido ou não numéricos', () => {
    expect(barcodeIsValid('1234567')).toBe(false)
    expect(barcodeIsValid('123456789')).toBe(false)
    expect(barcodeIsValid('abc')).toBe(false)
  })
})

describe('validação de produto (INV-1.0)', () => {
  test('nome obrigatório em ambos os ambientes', () => {
    expect(validateProduct({ ...base, name: '' }, 'mainnet', false).errors).toContain('name_required')
    expect(validateProduct({ ...base, name: '' }, 'testnet', false).errors).toContain('name_required')
  })
  test('rejeita valores não finitos e negativos em ambos os ambientes', () => {
    expect(validateProduct({ ...base, cost: Number.NaN }, 'testnet', false).ok).toBe(false)
    expect(validateProduct({ ...base, cost: Infinity }, 'testnet', false).ok).toBe(false)
    expect(validateProduct({ ...base, cost: -1 }, 'testnet', false).errors).toContain('cost_invalid')
    expect(validateProduct({ ...base, stock: -5 }, 'testnet', false).errors).toContain('stock_invalid')
  })
  test('Mainnet rejeita código de barras inválido; Testnet aceita incompleto', () => {
    expect(validateProduct({ ...base, barcode: 'abc' }, 'mainnet', false).errors).toContain('barcode_invalid')
    expect(validateProduct({ ...base, barcode: 'abc' }, 'testnet', false).ok).toBe(true)
  })
  test('Mainnet rejeita SKU duplicado no mesmo ambiente; Testnet não exige unicidade', () => {
    expect(validateProduct(base, 'mainnet', true).errors).toContain('sku_duplicate')
    expect(validateProduct(base, 'testnet', true).ok).toBe(true)
  })
  test('margem e markup', () => {
    expect(marginOf({ price: 8, cost: 5 })).toBeCloseTo(37.5, 10)
    expect(markupOf({ price: 8, cost: 5 })).toBeCloseTo(60, 10)
    expect(marginOf({ price: 0, cost: 5 })).toBe(0)
    expect(markupOf({ price: 8, cost: 0 })).toBe(0)
  })
})
