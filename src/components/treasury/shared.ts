export type Period = 7 | 30 | 90

export const PERIODS: Period[] = [7, 30, 90]

export const DAY_MS = 86_400_000

/** True quando a data ISO cai nos últimos `days` dias (inclui hoje). */
export function inLastDays(iso: string, days: number, now = Date.now()): boolean {
  const ts = new Date(iso).getTime()
  return Number.isFinite(ts) && ts <= now && now - ts <= days * DAY_MS
}

export const sameAddress = (a?: string, b?: string): boolean => Boolean(a && b && a.toLowerCase() === b.toLowerCase())
