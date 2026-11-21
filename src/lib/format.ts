import type { CurrencyCode } from './types'
import { getLang, locale } from './i18n'

let currency: CurrencyCode = 'BRL'

export function setCurrency(code: CurrencyCode): void {
  currency = code
}

export function currencyCode(): CurrencyCode {
  return currency
}

export function money(value: number): string {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(Number.isFinite(value) ? value : 0)
}

export function moneyCompact(value: number): string {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(
    Number.isFinite(value) ? value : 0,
  )
}

export function usdcFmt(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number.isFinite(n) ? n : 0)
}

export function num(value: number): string {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(value)
}

export function pct(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(value)}%`
}

/**
 * Accepts "1.234,56" (pt) and "1,234.56" (en). When both separators appear, the last one is the decimal.
 * A lone comma is a decimal comma in Portuguese and a thousands separator in English (when followed by 3 digits).
 * Returns NaN when invalid.
 */
export function parseNum(value: string): number {
  const v = value.trim()
  if (!v) return Number.NaN
  const lastComma = v.lastIndexOf(',')
  const lastDot = v.lastIndexOf('.')
  let normalized = v
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '')
  } else if (lastComma >= 0) {
    const thousands = getLang() === 'en' && /^\d{1,3}(,\d{3})+$/.test(v)
    normalized = thousands ? v.replace(/,/g, '') : v.replace(',', '.')
  }
  return Number(normalized)
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export function iso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export const today = (): string => iso(new Date())

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return iso(d)
}

/** Formats an ISO date (YYYY-MM-DD) for the active language. */
export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-')
  if (!y || !m || !d) return date
  return getLang() === 'pt' ? `${d}/${m}/${y}` : `${m}/${d}/${y}`
}

export const monthKey = (date: string): string => date.slice(0, 7)

function monthName(key: string, style: 'short' | 'long'): string {
  const [y, m] = key.split('-')
  const s = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(locale(), { month: style })
  return (s.charAt(0).toUpperCase() + s.slice(1)).replace('.', '')
}

export const monthLabel = (key: string): string => monthName(key, 'short')

export function monthTitle(key: string): string {
  return `${monthName(key, 'short')} ${key.split('-')[0]}`
}

export const shortAddr = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a)

export function daysUntil(date: string): number {
  const a = new Date(`${today()}T12:00:00`).getTime()
  const b = new Date(`${date}T12:00:00`).getTime()
  return Math.round((b - a) / 86400000)
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const blob = new Blob([`\uFEFF${rows.map((r) => r.map(esc).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
