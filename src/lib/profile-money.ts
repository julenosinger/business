import type { CurrencyCode } from './types'
import { formatCurrency, num } from './format'

/**
 * Agrupamento monetário por moeda real (fase UI 2.2.1).
 * Nunca soma BRL, USD, USDC ou outras moedas diretamente; registros sem moeda identificada
 * são agrupados como `unspecified` (moeda não especificada), nunca assumidos como a moeda atual.
 */
export type MoneyGroupCode = CurrencyCode | 'unspecified'

export interface MoneyGroup {
  code: MoneyGroupCode
  total: number
}

export function groupMoneyByCurrency(items: readonly { amount: number; currency?: CurrencyCode }[]): MoneyGroup[] {
  const map = new Map<MoneyGroupCode, number>()
  for (const it of items) {
    const code: MoneyGroupCode = it.currency ?? 'unspecified'
    map.set(code, (map.get(code) ?? 0) + it.amount)
  }
  return [...map.entries()].map(([code, total]) => ({ code, total }))
}

/** Formata o total de um grupo monetário. `unspecified` usa um rótulo próprio, sem símbolo arbitrário. */
export function formatMoneyGroup(g: MoneyGroup): string {
  if (g.code === 'unspecified') return num(g.total)
  return formatCurrency(g.total, g.code)
}
