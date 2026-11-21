// Custos de frete (fase 1C). Módulo puro.
// O frete base continua em `Shipment.freightCost`. O custo total é frete + seguro + taxas adicionais.
// O lançamento em contas a pagar é feito uma única vez por remessa e só na moeda do app (sem conversão inventada).
import type { Account, AppData, FreightFee, Shipment } from './types'
import { CAT_LOGISTICS } from './types'
import { clean, event, fail, isFreightPosted, replace, round2, uid, type Outcome } from './logistics'

const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** Custo total da remessa: frete + seguro + taxas. */
export const freightTotal = (s: Pick<Shipment, 'freightCost' | 'freight'>): number =>
  round2(s.freightCost + (s.freight?.insurance ?? 0) + (s.freight?.fees ?? []).reduce((sum, f) => sum + f.amount, 0))

/** Diferença entre o custo total e o estimado. Null quando não há estimativa. */
export const freightVariance = (s: Pick<Shipment, 'freightCost' | 'freight'>): number | null => (s.freight?.estimated === undefined ? null : round2(freightTotal(s) - s.freight.estimated))

export interface FreightInput {
  freightCost: number
  estimated?: number
  insurance: number
  fees: { label: string; amount: number }[]
}

/** Atualiza os custos de uma remessa (qualquer status, menos cancelada). Bloqueado depois de lançado em contas a pagar. */
export function setFreight(d: AppData, id: string, input: FreightInput, now: string, actor: string): Outcome<{ total: number }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (cur.status === 'cancelled') return fail('locked')
  if (isFreightPosted(d, cur)) return fail('freight_posted')
  if (!isMoney(input.freightCost) || !isMoney(input.insurance) || (input.estimated !== undefined && !isMoney(input.estimated)) || input.fees.some((f) => !isMoney(f.amount))) return fail('invalid_number')
  const fees: FreightFee[] = input.fees.filter((f) => f.label.trim() || f.amount > 0).map((f) => ({ id: uid(), label: clean(f.label, 60), amount: round2(f.amount) }))
  if (fees.some((f) => !f.label)) return fail('invalid_name')

  const next: Shipment = {
    ...cur,
    freightCost: round2(input.freightCost),
    freight: { ...cur.freight, estimated: input.estimated === undefined ? undefined : round2(input.estimated), insurance: round2(input.insurance), fees },
    events: [...cur.events, event({ kind: 'edit', at: now, description: '', fields: ['freight'], actor: clean(actor, 60) })],
    updatedAt: now,
  }
  return { ok: true, data: replace(d, next), value: { total: freightTotal(next) } }
}

const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

/**
 * Lança o custo total da remessa como conta a pagar (categoria Logística), uma única vez.
 * Exige a mesma moeda do app: não há conversão cambial. O pagamento segue pelo financeiro normal.
 */
export function postFreight(d: AppData, id: string, input: { dueDate: string }, now: string, appCurrency: string, actor: string): Outcome<{ accountId: string; amount: number }> {
  const cur = d.shipments.find((s) => s.id === id)
  if (!cur) return fail('not_found')
  if (cur.status === 'draft' || cur.status === 'cancelled') return fail('not_allowed')
  if (isFreightPosted(d, cur)) return fail('already_posted')
  if (cur.currency !== appCurrency) return fail('currency_mismatch')
  const amount = freightTotal(cur)
  if (amount <= 0) return fail('nothing_to_post')
  if (!isDate(input.dueDate)) return fail('invalid_date')

  const account: Account = {
    id: uid(),
    kind: 'payable',
    description: `${cur.id} · ${cur.carrier || '—'}`,
    contactName: cur.carrier || '—',
    amount,
    dueDate: input.dueDate,
    category: CAT_LOGISTICS,
    status: 'open',
    source: 'manual',
  }
  const next: Shipment = {
    ...cur,
    freight: { insurance: 0, fees: [], ...cur.freight, postedAccountId: account.id, postedAt: now },
    events: [...cur.events, event({ kind: 'freight', at: now, description: '', fields: [account.id], actor: clean(actor, 60) })],
    updatedAt: now,
  }
  return { ok: true, data: { ...replace(d, next), accounts: [account, ...d.accounts] }, value: { accountId: account.id, amount } }
}

// ---------- Relatório de custos ----------

export interface FreightRow {
  shipment: Shipment
  total: number
  variance: number | null
}

export interface CarrierCost {
  carrier: string
  currency: string
  count: number
  total: number
  average: number
}

export interface FreightReport {
  rows: FreightRow[]
  byCarrier: CarrierCost[]
  /** Totais por moeda (moedas nunca são misturadas). */
  totals: Record<string, { total: number; estimated: number; withEstimate: number; /** Custo total só das remessas que têm estimativa (base justa para comparar). */ totalWithEstimate: number }>
}

/** Custos das remessas criadas no período (sem canceladas e sem custo zerado). */
export function freightReport(shipments: readonly Shipment[], from: string): FreightReport {
  const rows = shipments
    .filter((s) => s.status !== 'cancelled' && (!from || s.createdAt.slice(0, 10) >= from) && freightTotal(s) > 0)
    .map((shipment) => ({ shipment, total: freightTotal(shipment), variance: freightVariance(shipment) }))
    .sort((a, b) => b.shipment.createdAt.localeCompare(a.shipment.createdAt))
  const map = new Map<string, CarrierCost>()
  const totals: FreightReport['totals'] = {}
  for (const { shipment: s, total } of rows) {
    const key = `${s.carrier}|${s.currency}`
    const cur = map.get(key) ?? { carrier: s.carrier, currency: s.currency, count: 0, total: 0, average: 0 }
    map.set(key, { ...cur, count: cur.count + 1, total: round2(cur.total + total) })
    const t = totals[s.currency] ?? { total: 0, estimated: 0, withEstimate: 0, totalWithEstimate: 0 }
    totals[s.currency] = {
      total: round2(t.total + total),
      estimated: s.freight?.estimated === undefined ? t.estimated : round2(t.estimated + s.freight.estimated),
      withEstimate: t.withEstimate + (s.freight?.estimated === undefined ? 0 : 1),
      totalWithEstimate: s.freight?.estimated === undefined ? t.totalWithEstimate : round2(t.totalWithEstimate + total),
    }
  }
  const byCarrier = [...map.values()].map((c) => ({ ...c, average: round2(c.total / c.count) })).sort((a, b) => b.total - a.total)
  return { rows, byCarrier, totals }
}
