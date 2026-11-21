// Análises de logística (fase 1D). Módulo puro: só lê os registros e aplica regras simples e transparentes.
// Nada aqui é "inteligência artificial" nem previsão garantida, e nada altera estoque, financeiro ou remessas.
import type { AppData, Shipment } from './types'
import { ACTIVE_STATUSES, MOVING_STATUSES, dateOf, dispatchedOn, isOverdue, lastTrackingEvent, round2 } from './logistics'
import { freightTotal, freightVariance } from './freight'
import { countryCode } from './international'

/** Dias sem nenhum registro para considerar uma remessa em movimento como parada. */
export const STALE_DAYS = 3
/** Dias até a previsão de entrega para alertar que uma remessa ainda não saiu para entrega. */
export const DUE_SOON_DAYS = 1
/** Semanas com remessas necessárias para a projeção simples. */
export const FORECAST_MIN_WEEKS = 4

const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
const addDaysIso = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const inPeriod = (s: Shipment, from: string): boolean => !from || dateOf(s.createdAt) >= from

// ---------- Desempenho por transportadora ----------

export interface CarrierPerformance {
  carrier: string
  /** Remessas já despachadas, criadas no período. */
  handled: number
  delivered: number
  /** Entregas com data prevista e real (base do percentual). */
  onTimeSample: number
  onTimeRate: number | null
  avgTransitDays: number | null
  /** Remessas que estão ou já estiveram atrasadas ou com exceção. */
  withProblems: number
  problemRate: number | null
  /** Custo médio por remessa, por moeda (moedas não se misturam). */
  avgCost: Record<string, number>
}

const HAD_PROBLEM = (s: Shipment): boolean => s.status === 'delayed' || s.status === 'exception' || s.events.some((e) => e.kind === 'status' && (e.toStatus === 'delayed' || e.toStatus === 'exception'))

export function carrierPerformance(shipments: readonly Shipment[], from: string): CarrierPerformance[] {
  const groups = new Map<string, Shipment[]>()
  for (const s of shipments) {
    if (!inPeriod(s, from) || s.status === 'draft' || s.status === 'ready' || s.status === 'cancelled') continue
    const key = s.carrier || ''
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  const rows = [...groups.entries()].map(([carrier, list]): CarrierPerformance => {
    const delivered = list.filter((s) => s.status === 'delivered' && s.deliveredAt)
    const withEta = delivered.filter((s) => !!s.estimatedDelivery)
    const onTime = withEta.filter((s) => (s.deliveredAt ?? '') <= (s.estimatedDelivery ?? ''))
    const days = delivered.flatMap((s) => {
      const start = dispatchedOn(s)
      return start && s.deliveredAt ? [Math.max(0, dayDiff(start, s.deliveredAt))] : []
    })
    const problems = list.filter(HAD_PROBLEM).length
    const sums: Record<string, { total: number; n: number }> = {}
    for (const s of list) {
      const total = freightTotal(s)
      if (total <= 0) continue
      const cur = sums[s.currency] ?? { total: 0, n: 0 }
      sums[s.currency] = { total: cur.total + total, n: cur.n + 1 }
    }
    return {
      carrier,
      handled: list.length,
      delivered: delivered.length,
      onTimeSample: withEta.length,
      onTimeRate: withEta.length ? (onTime.length / withEta.length) * 100 : null,
      avgTransitDays: days.length ? round2(days.reduce((a, b) => a + b, 0) / days.length) : null,
      withProblems: problems,
      problemRate: list.length ? (problems / list.length) * 100 : null,
      avgCost: Object.fromEntries(Object.entries(sums).map(([cur, v]) => [cur, round2(v.total / v.n)])),
    }
  })
  return rows.sort((a, b) => (b.onTimeRate ?? -1) - (a.onTimeRate ?? -1) || b.handled - a.handled || a.carrier.localeCompare(b.carrier))
}

// ---------- Risco de atraso (regras) ----------

export type DelayReason = 'exception' | 'delayed' | 'overdue' | 'stalled' | 'due_soon'

export interface DelayRisk {
  shipment: Shipment
  reasons: DelayReason[]
  severity: 'critical' | 'warning'
  /** Dias desde o último registro (quando relevante). */
  idleDays: number
}

/** Data do último registro da remessa (rastreio, status ou edição). */
export function lastActivityDate(s: Shipment): string {
  const stamps = s.events.map((e) => e.occurredAt ?? e.at).concat(s.updatedAt)
  const sorted = stamps.sort()
  return dateOf(sorted[sorted.length - 1] ?? s.createdAt)
}

/** Detecta remessas com risco de atraso por regras simples e visíveis. Não é uma previsão estatística. */
export function delayRisks(shipments: readonly Shipment[], today: string): DelayRisk[] {
  const out: DelayRisk[] = []
  for (const s of shipments) {
    if (!ACTIVE_STATUSES.includes(s.status)) continue
    const reasons: DelayReason[] = []
    if (s.status === 'exception') reasons.push('exception')
    if (s.status === 'delayed') reasons.push('delayed')
    if (isOverdue(s, today)) reasons.push('overdue')
    const idleDays = Math.max(0, dayDiff(lastActivityDate(s), today))
    if ((MOVING_STATUSES.includes(s.status) || s.status === 'delayed') && idleDays >= STALE_DAYS) reasons.push('stalled')
    if (s.estimatedDelivery && ['ready', 'dispatched', 'in_transit'].includes(s.status) && s.estimatedDelivery >= today && s.estimatedDelivery <= addDaysIso(today, DUE_SOON_DAYS)) reasons.push('due_soon')
    if (reasons.length === 0) continue
    out.push({ shipment: s, reasons, severity: reasons.includes('exception') || reasons.includes('overdue') ? 'critical' : 'warning', idleDays })
  }
  return out.sort((a, b) => (a.severity === b.severity ? (a.shipment.estimatedDelivery ?? '9999').localeCompare(b.shipment.estimatedDelivery ?? '9999') : a.severity === 'critical' ? -1 : 1))
}

// ---------- Resumo de exceções ----------

export interface ExceptionSummary {
  shipment: Shipment
  state: 'exception' | 'delayed' | 'overdue'
  since: string
  daysOpen: number
  note: string
  lastTracking?: string
}

/** Resumo factual das remessas com problema: desde quando, motivo informado e último rastreio. Sem texto inventado. */
export function exceptionSummaries(shipments: readonly Shipment[], today: string): ExceptionSummary[] {
  const rows: ExceptionSummary[] = []
  for (const s of shipments) {
    const state = s.status === 'exception' ? 'exception' : s.status === 'delayed' ? 'delayed' : isOverdue(s, today) ? 'overdue' : null
    if (!state) continue
    const change = [...s.events].reverse().find((e) => e.kind === 'status' && e.toStatus === s.status)
    const since = state === 'overdue' ? (s.estimatedDelivery ?? dateOf(s.updatedAt)) : dateOf(change?.at ?? s.updatedAt)
    rows.push({ shipment: s, state, since, daysOpen: Math.max(0, dayDiff(since, today)), note: state === 'overdue' ? '' : (change?.description ?? ''), lastTracking: lastTrackingEvent(s)?.description })
  }
  return rows.sort((a, b) => b.daysOpen - a.daysOpen || a.shipment.id.localeCompare(b.shipment.id))
}

// ---------- Análise de frete ----------

export interface FreightAnalysis {
  perKg: { carrier: string; currency: string; costPerKg: number; shipments: number; kg: number }[]
  lanes: { lane: string; currency: string; shipments: number; total: number }[]
  overruns: { shipment: Shipment; variance: number }[]
  /** Frete como % do valor declarado, por moeda. */
  shareOfValue: { currency: string; percent: number }[]
}

export function freightAnalysis(shipments: readonly Shipment[], from: string): FreightAnalysis {
  const list = shipments.filter((s) => s.status !== 'cancelled' && inPeriod(s, from) && freightTotal(s) > 0)
  const kg = new Map<string, { carrier: string; currency: string; total: number; kg: number; n: number }>()
  const lanes = new Map<string, { lane: string; currency: string; shipments: number; total: number }>()
  const value = new Map<string, { cost: number; declared: number }>()
  for (const s of list) {
    const total = freightTotal(s)
    const weight = s.packages.reduce((sum, p) => sum + p.weightKg, 0)
    if (weight > 0) {
      const k = `${s.carrier}|${s.currency}`
      const cur = kg.get(k) ?? { carrier: s.carrier, currency: s.currency, total: 0, kg: 0, n: 0 }
      kg.set(k, { ...cur, total: cur.total + total, kg: cur.kg + weight, n: cur.n + 1 })
    }
    const lane = `${countryCode(s.origin.country) || '?'} → ${countryCode(s.destination.country) || '?'}`
    const lk = `${lane}|${s.currency}`
    const l = lanes.get(lk) ?? { lane, currency: s.currency, shipments: 0, total: 0 }
    lanes.set(lk, { ...l, shipments: l.shipments + 1, total: round2(l.total + total) })
    if (s.declaredValue > 0) {
      const v = value.get(s.currency) ?? { cost: 0, declared: 0 }
      value.set(s.currency, { cost: v.cost + total, declared: v.declared + s.declaredValue })
    }
  }
  return {
    perKg: [...kg.values()].map((v) => ({ carrier: v.carrier, currency: v.currency, costPerKg: round2(v.total / v.kg), shipments: v.n, kg: round2(v.kg) })).sort((a, b) => a.costPerKg - b.costPerKg),
    lanes: [...lanes.values()].sort((a, b) => b.total - a.total),
    overruns: list
      .map((shipment) => ({ shipment, variance: freightVariance(shipment) ?? 0 }))
      .filter((x) => x.variance > 0)
      .sort((a, b) => b.variance - a.variance)
      .slice(0, 5),
    shareOfValue: [...value.entries()].map(([currency, v]) => ({ currency, percent: round2((v.cost / v.declared) * 100) })),
  }
}

// ---------- Sugestões de reposição ----------

export interface ReorderSuggestion {
  productId: string
  name: string
  sku: string
  stock: number
  minStock: number
  /** Quantidade que já está a caminho: compras que aguardam recebimento. */
  incoming: number
  /** Meta = 2 × estoque mínimo. Sugerido = meta − (estoque + a caminho). */
  suggested: number
}

/** Quantidade por produto que já está a caminho: compras registradas aguardando recebimento. */
export function incomingByProduct(d: AppData): Map<string, number> {
  const incoming = new Map<string, number>()
  for (const p of d.purchases) {
    if (p.stockPosted || p.receiptId) continue
    for (const i of p.items) incoming.set(i.productId, (incoming.get(i.productId) ?? 0) + i.qty)
  }
  return incoming
}

/** Produtos cujo estoque somado ao que já vai chegar está abaixo do mínimo. É só uma sugestão: nenhuma compra é criada. */
export function reorderSuggestions(d: AppData): ReorderSuggestion[] {
  const incoming = incomingByProduct(d)
  return d.products
    .filter((p) => p.minStock > 0 && p.stock + (incoming.get(p.id) ?? 0) < p.minStock)
    .map((p) => {
      const inc = incoming.get(p.id) ?? 0
      return { productId: p.id, name: p.name, sku: p.sku, stock: p.stock, minStock: p.minStock, incoming: inc, suggested: Math.max(0, Math.ceil(p.minStock * 2 - (p.stock + inc))) }
    })
    .sort((a, b) => (a.stock + a.incoming) / a.minStock - (b.stock + b.incoming) / b.minStock || a.name.localeCompare(b.name))
}

// ---------- Previsão simples ----------

export interface Forecast {
  sufficient: boolean
  /** Remessas criadas por semana, da mais antiga para a mais recente. */
  history: number[]
  /** Média das últimas 4 semanas repetida pelas próximas semanas. */
  projection: number[]
  average: number
  method: 'moving_average_4w'
}

/** Projeção por média móvel de 4 semanas. Só aparece com histórico suficiente e não é uma previsão estatística. */
export function forecast(shipments: readonly Shipment[], today: string, weeks = 8, horizon = 4): Forecast {
  const history = Array.from({ length: weeks }, () => 0)
  for (const s of shipments) {
    const age = dayDiff(dateOf(s.createdAt), today)
    if (age < 0 || age >= weeks * 7) continue
    const idx = weeks - 1 - Math.floor(age / 7)
    history[idx] = (history[idx] ?? 0) + 1
  }
  const filled = history.filter((n) => n > 0).length
  const total = history.reduce((a, b) => a + b, 0)
  const sufficient = filled >= FORECAST_MIN_WEEKS && total >= 8
  const last = history.slice(-4)
  const average = round2(last.reduce((a, b) => a + b, 0) / Math.max(last.length, 1))
  return { sufficient, history, projection: sufficient ? Array.from({ length: horizon }, () => average) : [], average, method: 'moving_average_4w' }
}
