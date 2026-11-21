// Preparação para IA na logística (fase 1D). Módulo puro.
//
// Princípios de segurança:
//  1. Somente leitura: um provedor recebe um retrato ANONIMIZADO e devolve sugestões. Não existe caminho de escrita:
//     nenhuma sugestão altera estoque, financeiro ou remessas. As únicas "ações" permitidas abrem uma tela para uma pessoa revisar.
//  2. Anonimização: o retrato não contém nomes, endereços, e-mails, telefones, carteiras, códigos de rastreio, notas ou
//     referências de pedidos. Só identificadores internos, status, datas, números e códigos de país.
//  3. A resposta de qualquer provedor (inclusive um modelo externo no futuro) passa por `sanitizeInsights`, que descarta
//     tudo o que não segue o formato e o vocabulário fixos.
// Hoje existe um único provedor, `rulesProvider`, que usa regras locais. Não há modelo de IA conectado.
import type { AppData, Shipment } from './types'
import { ACTIVE_STATUSES, MOVING_STATUSES, dateOf, round2 } from './logistics'
import { freightTotal } from './freight'
import { countryCode } from './international'
import { incomingByProduct, lastActivityDate } from './analytics'

export interface SnapshotShipment {
  id: string
  direction: Shipment['direction']
  status: Shipment['status']
  carrierId?: string
  lane: string
  createdOn: string
  estimatedDelivery?: string
  deliveredOn?: string
  lastActivityOn: string
  weightKg: number
  cost: number
  estimatedCost?: number
  currency: string
  declaredValue: number
  itemCount: number
  hadProblem: boolean
}

export interface SnapshotProduct {
  id: string
  stock: number
  minStock: number
  incoming: number
}

export interface LogisticsSnapshot {
  generatedOn: string
  shipments: SnapshotShipment[]
  products: SnapshotProduct[]
}

/** Retrato anonimizado e mínimo dos dados de logística. */
export function buildSnapshot(d: AppData, today: string): LogisticsSnapshot {
  const incoming = incomingByProduct(d)
  return {
    generatedOn: today,
    shipments: d.shipments.map((s) => ({
      id: s.id,
      direction: s.direction,
      status: s.status,
      carrierId: s.carrierId,
      lane: `${countryCode(s.origin.country) || '?'}>${countryCode(s.destination.country) || '?'}`,
      createdOn: dateOf(s.createdAt),
      estimatedDelivery: s.estimatedDelivery,
      deliveredOn: s.deliveredAt,
      lastActivityOn: lastActivityDate(s),
      weightKg: round2(s.packages.reduce((sum, p) => sum + p.weightKg, 0)),
      cost: freightTotal(s),
      estimatedCost: s.freight?.estimated,
      currency: s.currency,
      declaredValue: s.declaredValue,
      itemCount: s.items.length,
      hadProblem: s.status === 'delayed' || s.status === 'exception' || s.events.some((e) => e.kind === 'status' && (e.toStatus === 'delayed' || e.toStatus === 'exception')),
    })),
    products: d.products.map((p) => ({ id: p.id, stock: p.stock, minStock: p.minStock, incoming: incoming.get(p.id) ?? 0 })),
  }
}

export type InsightCode = 'overdue' | 'stalled' | 'cost_over_estimate' | 'carrier_ranking' | 'reorder'
export type InsightSeverity = 'info' | 'warning' | 'critical'
/** Únicas ações possíveis: abrir uma tela para revisão humana. Nenhuma altera dados. */
export type InsightAction = 'review_shipment' | 'review_product' | 'none'

export interface LogisticsInsight {
  code: InsightCode
  severity: InsightSeverity
  /** Valores para o texto (números e códigos curtos). O texto em si é montado pela interface, no idioma do usuário. */
  params: Record<string, string | number>
  action: InsightAction
  targetId?: string
}

export interface LogisticsAiProvider {
  id: string
  name: string
  /** Verdadeiro quando os dados saem do app (modelo externo). O provedor atual é local. */
  external: boolean
  analyze(snapshot: LogisticsSnapshot): Promise<unknown>
}

const CODES: readonly InsightCode[] = ['overdue', 'stalled', 'cost_over_estimate', 'carrier_ranking', 'reorder']
const SEVERITIES: readonly InsightSeverity[] = ['info', 'warning', 'critical']
const ACTIONS: readonly InsightAction[] = ['review_shipment', 'review_product', 'none']
const MAX_INSIGHTS = 50

/** Aceita só o formato e o vocabulário fixos. Qualquer outra coisa (ações de escrita, HTML, campos extras) é descartada. */
export function sanitizeInsights(raw: unknown): LogisticsInsight[] {
  if (!Array.isArray(raw)) return []
  const out: LogisticsInsight[] = []
  for (const item of raw.slice(0, MAX_INSIGHTS)) {
    if (typeof item !== 'object' || item === null) continue
    const x = item as Record<string, unknown>
    if (!CODES.includes(x.code as InsightCode) || !SEVERITIES.includes(x.severity as InsightSeverity) || !ACTIONS.includes(x.action as InsightAction)) continue
    const params: Record<string, string | number> = {}
    if (typeof x.params === 'object' && x.params !== null) {
      for (const [k, v] of Object.entries(x.params as Record<string, unknown>).slice(0, 8)) {
        if (!/^[a-zA-Z]{1,20}$/.test(k)) continue
        if (typeof v === 'number' && Number.isFinite(v)) params[k] = v
        else if (typeof v === 'string') params[k] = v.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40)
      }
    }
    const targetId = typeof x.targetId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.targetId) ? x.targetId : undefined
    out.push({ code: x.code as InsightCode, severity: x.severity as InsightSeverity, params, action: x.action as InsightAction, targetId })
  }
  return out
}

const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** Provedor local de regras. Mostra o fluxo completo (retrato anonimizado → insights) sem nenhum modelo de IA. */
export const rulesProvider: LogisticsAiProvider = {
  id: 'rules',
  name: 'Regras locais',
  external: false,
  analyze(snap) {
    const out: LogisticsInsight[] = []
    for (const s of snap.shipments) {
      if (ACTIVE_STATUSES.includes(s.status) && s.status !== 'ready' && s.estimatedDelivery && s.estimatedDelivery < snap.generatedOn) {
        out.push({ code: 'overdue', severity: 'critical', params: { id: s.id, days: dayDiff(s.estimatedDelivery, snap.generatedOn) }, action: 'review_shipment', targetId: s.id })
      } else if ((MOVING_STATUSES.includes(s.status) || s.status === 'delayed') && dayDiff(s.lastActivityOn, snap.generatedOn) >= 3) {
        out.push({ code: 'stalled', severity: 'warning', params: { id: s.id, days: dayDiff(s.lastActivityOn, snap.generatedOn) }, action: 'review_shipment', targetId: s.id })
      }
      if (s.estimatedCost && s.estimatedCost > 0 && s.cost > s.estimatedCost * 1.2 && s.status !== 'cancelled') {
        out.push({ code: 'cost_over_estimate', severity: 'warning', params: { id: s.id, percent: Math.round(((s.cost - s.estimatedCost) / s.estimatedCost) * 100) }, action: 'review_shipment', targetId: s.id })
      }
    }
    // Comparação de transportadoras: precisa de pelo menos 3 entregas com data prevista em cada uma.
    const perCarrier = new Map<string, { on: number; n: number }>()
    for (const s of snap.shipments) {
      if (s.status !== 'delivered' || !s.carrierId || !s.estimatedDelivery || !s.deliveredOn) continue
      const c = perCarrier.get(s.carrierId) ?? { on: 0, n: 0 }
      perCarrier.set(s.carrierId, { on: c.on + (s.deliveredOn <= s.estimatedDelivery ? 1 : 0), n: c.n + 1 })
    }
    const ranked = [...perCarrier.entries()].filter(([, v]) => v.n >= 3).map(([id, v]) => ({ id, rate: Math.round((v.on / v.n) * 100) })).sort((a, b) => b.rate - a.rate)
    const best = ranked[0]
    const worst = ranked[ranked.length - 1]
    if (best && worst && best.id !== worst.id && best.rate !== worst.rate) out.push({ code: 'carrier_ranking', severity: 'info', params: { best: best.id, bestRate: best.rate, worst: worst.id, worstRate: worst.rate }, action: 'none' })
    for (const p of snap.products) {
      if (p.minStock > 0 && p.stock + p.incoming < p.minStock) out.push({ code: 'reorder', severity: 'warning', params: { id: p.id, stock: p.stock, incoming: p.incoming, min: p.minStock }, action: 'review_product', targetId: p.id })
    }
    const weight: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 }
    return Promise.resolve(out.sort((a, b) => weight[a.severity] - weight[b.severity]))
  },
}

/** Executa um provedor e valida a resposta. Erros do provedor nunca quebram a tela. */
export async function runInsights(provider: LogisticsAiProvider, snapshot: LogisticsSnapshot): Promise<LogisticsInsight[]> {
  try {
    return sanitizeInsights(await provider.analyze(snapshot))
  } catch {
    return []
  }
}

