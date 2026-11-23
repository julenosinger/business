// Diretório de transportadoras (fase 1C). Módulo puro.
//
// Adaptadores: cada transportadora usa um adaptador. Hoje existe só o "manual" (modelo de URL de rastreio). Integrações reais
// (DHL, FedEx, UPS, Correios, regionais) entrarão como novos adaptadores com credenciais e respostas verificadas: nenhuma
// integração é simulada ou declarada aqui.
import type { AppData, Carrier, CarrierAdapterId, CarrierCostStructure, CarrierServiceLevel, CurrencyCode } from './types'
import type { NetworkId } from './network'
import { CURRENCIES, DEFAULT_ORG, clean, fail, round2, uid, type ErrorCode, type Outcome } from './logistics'

export interface CarrierAdapter {
  id: CarrierAdapterId
  /** Link de rastreio público, ou null quando não há modelo configurado. */
  trackingUrl(carrier: Pick<Carrier, 'trackingUrlTemplate'>, trackingNumber: string): string | null
  /** Eventos automáticos: o adaptador manual não busca nada. */
  readonly liveTracking: boolean
}

export const MANUAL_ADAPTER: CarrierAdapter = {
  id: 'manual',
  liveTracking: false,
  trackingUrl(carrier, trackingNumber) {
    const tpl = carrier.trackingUrlTemplate
    const code = trackingNumber.trim()
    if (!tpl || !code) return null
    return tpl.replace(/\{tracking\}/g, encodeURIComponent(code))
  },
}

const ADAPTERS: Record<CarrierAdapterId, CarrierAdapter> = { manual: MANUAL_ADAPTER }
export const adapterFor = (c: Pick<Carrier, 'adapter'>): CarrierAdapter => ADAPTERS[c.adapter] ?? MANUAL_ADAPTER

export const trackingUrl = (c: Carrier | undefined, trackingNumber: string): string | null => (c ? adapterFor(c).trackingUrl(c, trackingNumber) : null)

/** Estimativa a partir da estrutura de custo cadastrada (valores do próprio usuário, não uma cotação). */
export function estimateFreight(c: Carrier | undefined, weightKg: number): { amount: number; currency: CurrencyCode } | null {
  if (!c?.cost || !Number.isFinite(weightKg) || weightKg < 0) return null
  return { amount: round2(c.cost.baseFee + c.cost.perKg * weightKg), currency: c.cost.currency }
}

export interface CarrierInput {
  name: string
  countries: string[]
  methods: string[]
  contactName: string
  email: string
  phone: string
  trackingUrlTemplate: string
  serviceLevels: Omit<CarrierServiceLevel, 'id'>[]
  cost?: CarrierCostStructure
  active: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normalize(d: AppData, input: CarrierInput, selfId?: string): { errors: ErrorCode[]; value?: Omit<Carrier, 'id' | 'orgId' | 'adapter' | 'createdAt' | 'updatedAt'> } {
  const errors = new Set<ErrorCode>()
  const name = clean(input.name, 60)
  if (name.length < 2) errors.add('invalid_name')
  if (d.carriers.some((c) => c.id !== selfId && c.name.toLowerCase() === name.toLowerCase())) errors.add('duplicate_carrier')

  const list = (xs: string[], max: number) => [...new Set(xs.map((x) => clean(x, max)).filter(Boolean))]
  const email = clean(input.email, 80)
  if (email && !EMAIL_RE.test(email)) errors.add('invalid_email')

  // O modelo precisa ser https e conter {tracking}: nada de javascript:, data: ou links sem o código.
  const tpl = clean(input.trackingUrlTemplate, 300)
  if (tpl) {
    try {
      const probe = new URL(tpl.replace(/\{tracking\}/g, 'X'))
      if (probe.protocol !== 'https:' || !tpl.includes('{tracking}')) errors.add('invalid_url')
    } catch {
      errors.add('invalid_url')
    }
  }

  const serviceLevels = input.serviceLevels
    .filter((s) => s.name.trim() || s.minDays || s.maxDays)
    .map((s) => ({ id: uid(), name: clean(s.name, 40), minDays: Number(s.minDays), maxDays: Number(s.maxDays) }))
  if (serviceLevels.some((s) => !s.name || !Number.isInteger(s.minDays) || !Number.isInteger(s.maxDays) || s.minDays < 0 || s.maxDays < s.minDays)) errors.add('invalid_service_level')

  let cost: CarrierCostStructure | undefined
  if (input.cost) {
    const { currency, baseFee, perKg } = input.cost
    if (!CURRENCIES.includes(currency)) errors.add('invalid_currency')
    if (!(Number.isFinite(baseFee) && baseFee >= 0 && Number.isFinite(perKg) && perKg >= 0)) errors.add('invalid_number')
    else cost = { currency, baseFee: round2(baseFee), perKg: round2(perKg) }
  }

  if (errors.size) return { errors: [...errors] }
  return {
    errors: [],
    value: {
      name,
      countries: list(input.countries, 40),
      methods: list(input.methods, 40),
      contactName: clean(input.contactName, 80),
      email,
      phone: clean(input.phone, 30),
      trackingUrlTemplate: tpl,
      serviceLevels,
      cost,
      active: !!input.active,
    },
  }
}

export function nextCarrierId(carriers: readonly { id: string }[]): string {
  const max = carriers.reduce((m, c) => {
    const n = /^CAR-(\d+)$/.exec(c.id)
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `CAR-${String(max + 1).padStart(4, '0')}`
}

export function createCarrier(d: AppData, input: CarrierInput, now: string, env: NetworkId = 'mainnet'): Outcome<{ id: string }> {
  const r = normalize(d, input)
  if (!r.value) return fail(...r.errors)
  const id = nextCarrierId(d.carriers)
  const carrier: Carrier = { id, orgId: DEFAULT_ORG, adapter: 'manual', ...r.value, environment: env, createdAt: now, updatedAt: now }
  return { ok: true, data: { ...d, carriers: [carrier, ...d.carriers] }, value: { id } }
}

/** Editar uma transportadora não muda o nome gravado nas remessas já criadas (o histórico se mantém). */
export function updateCarrier(d: AppData, id: string, input: CarrierInput, now: string): Outcome<{ id: string }> {
  const cur = d.carriers.find((c) => c.id === id)
  if (!cur) return fail('not_found')
  const r = normalize(d, input, id)
  if (!r.value) return fail(...r.errors)
  return { ok: true, data: { ...d, carriers: d.carriers.map((c) => (c.id === id ? { ...c, ...r.value, updatedAt: now } : c)) }, value: { id } }
}

export function setCarrierActive(d: AppData, id: string, active: boolean, now: string): Outcome<{ id: string }> {
  const cur = d.carriers.find((c) => c.id === id)
  if (!cur) return fail('not_found')
  return { ok: true, data: { ...d, carriers: d.carriers.map((c) => (c.id === id ? { ...c, active, updatedAt: now } : c)) }, value: { id } }
}

/** Só remove quem nunca foi usado. Quem já tem remessas deve ser desativado, para manter o histórico. */
export function removeCarrier(d: AppData, id: string): Outcome<{ id: string }> {
  if (!d.carriers.some((c) => c.id === id)) return fail('not_found')
  if (d.shipments.some((s) => s.carrierId === id)) return fail('carrier_in_use')
  return { ok: true, data: { ...d, carriers: d.carriers.filter((c) => c.id !== id) }, value: { id } }
}

/** Atende o país? Sem países cadastrados, considera que atende qualquer um. */
export function servesCountry(c: Carrier, country: string): boolean {
  if (c.countries.length === 0 || !country.trim()) return true
  const want = country.trim().toLowerCase()
  return c.countries.some((x) => x.toLowerCase() === want)
}
