/**
 * Validação de quantidades digitadas no carrinho de vendas (produtos vendidos por unidade).
 * Pura e sem DOM: reutilizada pela interface e testável isoladamente.
 *
 * Regras (P7):
 * - Campo vazio é um estado de edição temporário (não é zero nem venda inválida).
 * - Aceita apenas números inteiros positivos (dígitos).
 * - Rejeita negativos, notação científica, decimais, não-finitos e valores acima do estoque.
 * - Rejeita valores acima do limite numérico seguro (Number.MAX_SAFE_INTEGER).
 */
export type QuantityError = 'empty' | 'zero' | 'invalid' | 'over_stock'

export function quantityError(raw: string, stock: number): QuantityError | null {
  const s = raw.trim()
  if (s === '') return 'empty'
  // Apenas dígitos: qualquer sinal, separador, casa decimal, expoente ou texto é inválido.
  if (!/^\d+$/.test(s)) return 'invalid'
  const n = Number(s)
  if (!Number.isSafeInteger(n)) return 'invalid'
  if (n === 0) return 'zero'
  if (n > stock) return 'over_stock'
  return null
}

/** Interpreta uma quantidade válida como inteiro seguro; `null` quando inválida. */
export function parseQuantity(raw: string, stock: number): number | null {
  if (quantityError(raw, stock) !== null) return null
  return Number(raw.trim())
}
