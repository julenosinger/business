// Preparação para remessas internacionais (fase 1C). Módulo puro.
//
// Nada aqui calcula tributos nem declara conformidade aduaneira: impostos, taxas e referências são informados à mão,
// e a lista de documentos é apenas um lembrete do que costuma ser pedido. Cada país terá um adaptador próprio
// (formato do código HS/NCM); hoje existem o genérico e o do Brasil. Integrações aduaneiras reais não existem.
import type { AppData, Incoterm, InternationalInfo, Shipment } from './types'
import { clean, event, fail, replace, round2, type Outcome } from './logistics'

export const INCOTERMS: readonly Incoterm[] = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']

const COUNTRY_ALIASES: Record<string, string> = {
  BRASIL: 'BR',
  BRAZIL: 'BR',
  PORTUGAL: 'PT',
  'ESTADOS UNIDOS': 'US',
  'UNITED STATES': 'US',
  USA: 'US',
  EUA: 'US',
  CHINA: 'CN',
  ARGENTINA: 'AR',
  URUGUAI: 'UY',
  URUGUAY: 'UY',
  PARAGUAI: 'PY',
  PARAGUAY: 'PY',
  CHILE: 'CL',
  COLOMBIA: 'CO',
  MEXICO: 'MX',
  ESPANHA: 'ES',
  SPAIN: 'ES',
  ALEMANHA: 'DE',
  GERMANY: 'DE',
  FRANCA: 'FR',
  FRANCE: 'FR',
  ITALIA: 'IT',
  ITALY: 'IT',
  'REINO UNIDO': 'GB',
  'UNITED KINGDOM': 'GB',
  UK: 'GB',
  JAPAO: 'JP',
  JAPAN: 'JP',
  CANADA: 'CA',
}

const strip = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase()

/** Código do país (ISO de 2 letras) a partir do que foi digitado. Desconhecido volta como digitado, em maiúsculas. */
export function countryCode(raw: string): string {
  const s = strip(raw)
  if (!s) return ''
  return s.length === 2 ? s : (COUNTRY_ALIASES[s] ?? s)
}

/** Remessa que cruza fronteira: origem e destino em países diferentes (ambos informados). */
export function isInternational(s: Pick<Shipment, 'origin' | 'destination'>): boolean {
  const a = countryCode(s.origin.country)
  const b = countryCode(s.destination.country)
  return !!a && !!b && a !== b
}

export interface CustomsAdapter {
  code: string
  name: string
  /** Quantidade de dígitos aceita no código de classificação. */
  digits: readonly number[]
  hint: string
}

const GENERIC: CustomsAdapter = { code: 'GEN', name: 'HS (genérico)', digits: [6, 8, 10], hint: 'HS com 6, 8 ou 10 dígitos' }
const BRAZIL: CustomsAdapter = { code: 'BR', name: 'NCM (Brasil)', digits: [8], hint: 'NCM com 8 dígitos' }

const ADAPTERS: Record<string, CustomsAdapter> = { BR: BRAZIL }

/** Adaptador do país envolvido (Brasil tem prioridade); os demais usam o genérico. */
export function adapterForShipment(s: Pick<Shipment, 'origin' | 'destination'>): CustomsAdapter {
  return ADAPTERS[countryCode(s.destination.country)] ?? ADAPTERS[countryCode(s.origin.country)] ?? GENERIC
}

export const normalizeHs = (raw: string): string => raw.replace(/[\s.\-]/g, '')

export function validHs(raw: string, adapter: CustomsAdapter): boolean {
  const digits = normalizeHs(raw)
  return /^\d+$/.test(digits) && adapter.digits.includes(digits.length)
}

export type ReadinessKey = 'incoterm' | 'hs_codes' | 'commercial_invoice' | 'packing_list' | 'customs_ref'

/** Lembrete do que costuma ser exigido. Não é uma verificação de conformidade. */
export function readiness(s: Shipment): { key: ReadinessKey; ok: boolean }[] {
  const adapter = adapterForShipment(s)
  const has = (type: string) => s.documents.some((d) => d.type === type)
  return [
    { key: 'incoterm', ok: !!s.international?.incoterm },
    { key: 'hs_codes', ok: s.items.length > 0 && s.items.every((i) => !!i.hsCode && validHs(i.hsCode, adapter)) },
    { key: 'commercial_invoice', ok: has('invoice') },
    { key: 'packing_list', ok: has('packing_list') },
    { key: 'customs_ref', ok: !!s.international?.customsRef },
  ]
}

export interface InternationalInput {
  incoterm?: Incoterm | ''
  customsRef: string
  importExportRef: string
  dutiesAmount: number
  taxesAmount: number
  /** Código HS/NCM por item (id do item → código). Vazio remove. */
  hsCodes: Record<string, string>
}

/** Grava os dados internacionais informados. Só para remessas que cruzam fronteira. Gera auditoria. */
export function setInternational(d: AppData, id: string, input: InternationalInput, now: string, actor: string): Outcome<{ id: string }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (cur.status === 'cancelled' || cur.status === 'returned') return fail('locked')
  if (!isInternational(cur)) return fail('not_international')
  if (input.incoterm && !INCOTERMS.includes(input.incoterm)) return fail('invalid_incoterm')
  const money = (n: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0
  if (!money(input.dutiesAmount) || !money(input.taxesAmount)) return fail('invalid_number')

  const adapter = adapterForShipment(cur)
  const items = cur.items.map((i) => {
    const raw = input.hsCodes[i.id]
    return raw === undefined ? i : { ...i, hsCode: raw.trim() ? normalizeHs(raw) : undefined }
  })
  if (items.some((i) => i.hsCode && !validHs(i.hsCode, adapter))) return fail('invalid_hs')

  const international: InternationalInfo = {
    incoterm: input.incoterm || undefined,
    customsRef: clean(input.customsRef, 60),
    importExportRef: clean(input.importExportRef, 60),
    dutiesAmount: round2(input.dutiesAmount),
    taxesAmount: round2(input.taxesAmount),
  }
  const next: Shipment = { ...cur, items, international, events: [...cur.events, event({ kind: 'edit', at: now, description: '', fields: ['international'], actor: clean(actor, 60) })], updatedAt: now }
  return { ok: true, data: replace(d, next), value: { id } }
}
