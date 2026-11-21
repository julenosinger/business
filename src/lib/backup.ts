import type { AppData } from './types'
import { emptyData } from './store'
import { iso } from './format'
import { t } from './i18n'

const LAST_KEY = 'gbos:lastBackup'
const FORMAT = 'global-business-os'

export function lastBackupAt(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

/** Dias desde o último backup, ou null se nunca foi feito. */
export function daysSinceBackup(): number | null {
  const last = lastBackupAt()
  return last === null ? null : Math.floor((Date.now() - last) / 86_400_000)
}

export function exportBackup(data: AppData): void {
  const payload = { app: FORMAT, version: 1, exportedAt: new Date().toISOString(), data }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `business-os-backup-${iso(new Date())}.json`
  a.click()
  URL.revokeObjectURL(url)
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()))
  } catch {
    // ignore
  }
}

export type ParseResult = { ok: true; data: AppData; counts: { products: number; sales: number; accounts: number } } | { ok: false; error: string }

const LIST_KEYS = ['products', 'moves', 'contacts', 'entries', 'accounts', 'sales', 'employees', 'treasuryOps', 'requests'] as const

export function parseBackup(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: t('O arquivo não é um JSON válido.', 'The file is not valid JSON.') }
  }
  const root = raw as { app?: unknown; data?: unknown } | null
  const body = (root && typeof root === 'object' && root.app === FORMAT ? root.data : raw) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return { ok: false, error: t('Arquivo de backup não reconhecido.', 'Unrecognized backup file.') }
  }
  const base = emptyData()
  const next: AppData = { ...base }
  for (const key of LIST_KEYS) {
    const value = body[key]
    if (value === undefined) continue
    if (!Array.isArray(value)) {
      return { ok: false, error: t(`Campo inválido no backup: ${key}.`, `Invalid field in backup: ${key}.`) }
    }
    ;(next as unknown as Record<string, unknown>)[key] = value
  }
  if (body.settings && typeof body.settings === 'object') {
    next.settings = { ...base.settings, ...(body.settings as Partial<AppData['settings']>) }
  }
  if (!LIST_KEYS.some((k) => body[k] !== undefined)) {
    return { ok: false, error: t('Arquivo de backup não reconhecido.', 'Unrecognized backup file.') }
  }
  return { ok: true, data: next, counts: { products: next.products.length, sales: next.sales.length, accounts: next.accounts.length } }
}
