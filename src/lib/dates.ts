// Datas localizadas (fase 1F). Módulo puro, sem React nem DOM: tudo é calculado em UTC para nunca deslocar um dia por fuso.
//
// Regra: o valor guardado é sempre uma data ISO (YYYY-MM-DD). O que muda por idioma é só a apresentação e a digitação:
//   pt: dd/mm/aaaa      en: mm/dd/yyyy
// O navegador decide o formato de <input type="date"> pelo idioma do sistema, e não pelo idioma do app. Por isso o app
// usa o seletor próprio de components/DateField.tsx, que usa estas funções.
export type DateLang = 'pt' | 'en'

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Data ISO real (dia existente no calendário). */
export function isValidIso(s: string): boolean {
  const m = ISO_RE.exec(s)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  return y >= 1000 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
}

export function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** ISO → texto no idioma. Valor inválido ou vazio vira texto vazio. */
export function formatIso(iso: string, lang: DateLang): string {
  const m = ISO_RE.exec(iso)
  if (!m || !isValidIso(iso)) return ''
  return lang === 'pt' ? `${m[3]}/${m[2]}/${m[1]}` : `${m[2]}/${m[3]}/${m[1]}`
}

export function placeholder(lang: DateLang): string {
  return lang === 'pt' ? 'DD/MM/AAAA' : 'MM/DD/YYYY'
}

/** Aplica a máscara progressivamente a partir dos dígitos digitados (até 8). */
export function maskDigits(digits: string, lang: DateLang): string {
  void lang // pt e en usam a mesma máscara 2/2/4; só a ordem dos campos muda
  const d = digits.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

/**
 * Texto digitado → ISO. Aceita o formato do idioma (dd/mm/aaaa ou mm/dd/yyyy) e também ISO direto (colar, testes, automações).
 * Retorna null quando incompleto ou quando o dia não existe (ex.: 31/02).
 */
export function parseText(text: string, lang: DateLang): string | null {
  const s = text.trim()
  if (ISO_RE.test(s)) return isValidIso(s) ? s : null
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (!m) return null
  const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const [day, month] = lang === 'pt' ? [a, b] : [b, a]
  const iso = toIso(y, month, day)
  return isValidIso(iso) ? iso : null
}

export type DateIssue = 'incomplete' | 'invalid' | 'range'

/** Diz por que um texto não vira uma data utilizável (ou null se está tudo certo). Vazio não é erro. */
export function dateIssue(text: string, lang: DateLang, min?: string, max?: string): DateIssue | null {
  if (!text.trim()) return null
  const digits = text.replace(/\D/g, '')
  if (!ISO_RE.test(text.trim()) && digits.length < 8) return 'incomplete'
  const iso = parseText(text, lang)
  if (!iso) return 'invalid'
  if ((min && iso < min) || (max && iso > max)) return 'range'
  return null
}

export const inRange = (iso: string, min?: string, max?: string): boolean => !((min && iso < min) || (max && iso > max))

/** Dia da semana (0 = domingo) de uma data ISO, calculado em UTC. */
export function weekday(iso: string): number {
  const m = ISO_RE.exec(iso)
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() : 0
}

export function addDaysIso(iso: string, n: number): string {
  const m = ISO_RE.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n))
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Soma meses mantendo o dia, limitado ao último dia do mês de destino (31/01 + 1 mês = 28/02). */
export function addMonthsIso(iso: string, n: number): string {
  const m = ISO_RE.exec(iso)
  if (!m) return iso
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n
  const y = Math.floor(total / 12)
  const mo = (total % 12) + 1
  return toIso(y, mo, Math.min(Number(m[3]), daysInMonth(y, mo)))
}

/** Grade de 6 semanas (domingo primeiro) para o mês de `iso`. As células fora do mês também vêm preenchidas. */
export function monthGrid(iso: string): string[][] {
  const m = ISO_RE.exec(iso)
  const y = m ? Number(m[1]) : 1970
  const mo = m ? Number(m[2]) : 1
  const first = toIso(y, mo, 1)
  const start = addDaysIso(first, -weekday(first))
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDaysIso(start, w * 7 + d)))
}

// ---------- Hora (24h) ----------

export function maskTime(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4)
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`
}

export function isValidTime(s: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59
}

/** 'YYYY-MM-DDTHH:mm' → partes. */
export function splitDateTime(v: string): { date: string; time: string } {
  const [date = '', time = ''] = v.split('T')
  return { date, time }
}

export const joinDateTime = (date: string, time: string): string => (isValidIso(date) && isValidTime(time) ? `${date}T${time}` : '')
