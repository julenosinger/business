/**
 * Aritmética monetária decimal-safe do motor contábil.
 *
 * Valores autoritativos são inteiros em unidades menores (bigint), persistidos como
 * strings decimais inteiras ("1234500" = 1,2345 USDC). Nunca usamos ponto flutuante
 * para somar, comparar ou lançar. `fromNumber` existe só como fronteira explícita para
 * valores legados do app (números já arredondados em centavos).
 */
import type { CurrencyCode } from '../types'

/** Casas decimais por moeda. USD e USDC são moedas distintas (USDC usa 6 casas on-chain). */
export const EXPONENT: Record<CurrencyCode, number> = { USDC: 6, BRL: 2, USD: 2, EUR: 2 }

export const SUPPORTED_CURRENCIES = Object.keys(EXPONENT) as CurrencyCode[]

export const isCurrency = (v: unknown): v is CurrencyCode => typeof v === 'string' && v in EXPONENT

const pow10 = (n: number): bigint => 10n ** BigInt(n)

/** Converte string decimal estrita ("12.34") em unidades menores; null se inválida ou com casas demais. */
export function parseMinor(text: string, currency: CurrencyCode): bigint | null {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim())
  if (!m) return null
  const exp = EXPONENT[currency]
  const frac = m[3] ?? ''
  if (frac.length > exp) return null // sem arredondamento destrutivo
  const whole = BigInt(m[2] ?? '0') * pow10(exp)
  const part = frac === '' ? 0n : BigInt(frac.padEnd(exp, '0'))
  const value = whole + part
  return m[1] ? -value : value
}

/**
 * Fronteira com valores legados (number). Arredonda para o expoente da moeda (metade para longe do zero),
 * de forma explícita. Rejeita NaN/Infinity.
 */
export function fromNumber(value: number, currency: CurrencyCode): bigint | null {
  if (!Number.isFinite(value)) return null
  const exp = EXPONENT[currency]
  const fixed = Math.abs(value).toFixed(exp)
  const minor = parseMinor(fixed, currency)
  if (minor === null) return null
  return value < 0 ? -minor : minor
}

/** String decimal canônica com todas as casas da moeda ("12.340000"). */
export function formatDecimal(minor: bigint, currency: CurrencyCode): string {
  const exp = EXPONENT[currency]
  const neg = minor < 0n
  const abs = neg ? -minor : minor
  const base = pow10(exp)
  const whole = abs / base
  const frac = (abs % base).toString().padStart(exp, '0')
  return `${neg ? '-' : ''}${whole.toString()}${exp > 0 ? `.${frac}` : ''}`
}

/** Para exibição: número JS (perde precisão acima de 2^53; nunca usar em cálculo). */
export function toDisplayNumber(minor: bigint, currency: CurrencyCode): number {
  return Number(formatDecimal(minor, currency))
}

export const minorToString = (minor: bigint): string => minor.toString()

export function minorFromString(text: string): bigint | null {
  return /^-?\d+$/.test(text) ? BigInt(text) : null
}

/** Taxa decimal estrita (ex.: "5.4321" ou "0.0125"). Retorna numerador/denominador exatos. */
export function parseRate(rate: string): { num: bigint; den: bigint } | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim())
  if (!m) return null
  const frac = m[2] ?? ''
  const num = BigInt(`${m[1]}${frac}`)
  if (num === 0n) return null
  return { num, den: pow10(frac.length) }
}

/** Multiplica um valor em unidades menores por uma taxa exata; arredonda metade para cima (documentado). */
export function mulRate(minor: bigint, rate: string): bigint | null {
  const r = parseRate(rate)
  if (!r) return null
  const neg = minor < 0n
  const abs = neg ? -minor : minor
  const scaled = abs * r.num
  const q = scaled / r.den
  const rem = scaled % r.den
  const rounded = rem * 2n >= r.den ? q + 1n : q
  return neg ? -rounded : rounded
}

export interface FxRate {
  from: CurrencyCode
  to: CurrencyCode
  /** unidades da moeda `to` por 1 unidade da moeda `from` (decimal estrito). */
  rate: string
  source: string
  /** Momento em que a taxa foi obtida (ISO). */
  at: string
}

export interface ConvertedMoney {
  amountMinor: bigint
  currency: CurrencyCode
  fx: FxRate
}

/**
 * Conversão explícita. Exige taxa com origem e horário; nunca é chamada implicitamente.
 * Converte do valor em unidades menores de `from` para unidades menores de `to`.
 */
export function fxConvert(amountMinor: bigint, from: CurrencyCode, fx: FxRate): ConvertedMoney | { error: 'fx_invalid' | 'fx_mismatch' } {
  if (fx.from !== from) return { error: 'fx_mismatch' }
  if (!isCurrency(fx.to) || fx.from === fx.to) return { error: 'fx_invalid' }
  if (!fx.source.trim() || Number.isNaN(Date.parse(fx.at))) return { error: 'fx_invalid' }
  const r = parseRate(fx.rate)
  if (!r) return { error: 'fx_invalid' }
  // valor_from / 10^expFrom * rate * 10^expTo
  const expFrom = EXPONENT[from]
  const expTo = EXPONENT[fx.to]
  const neg = amountMinor < 0n
  const abs = neg ? -amountMinor : amountMinor
  const scaled = abs * r.num * pow10(expTo)
  const den = r.den * pow10(expFrom)
  const q = scaled / den
  const rem = scaled % den
  const rounded = rem * 2n >= den ? q + 1n : q
  return { amountMinor: neg ? -rounded : rounded, currency: fx.to, fx }
}
