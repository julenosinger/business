// Interface para eventos de rastreio enviados por transportadoras (fase 1D). Módulo puro.
//
// IMPORTANTE: não há integração real com nenhuma transportadora aqui. Este módulo define o contrato que um backend futuro
// (com credenciais e respostas verificadas) deve seguir:
//  1. A transportadora envia um webhook assinado (HMAC-SHA256 com segredo compartilhado, mais carimbo de tempo).
//  2. O servidor confere a assinatura com `verifyWebhook` e converte o corpo com um `CarrierWebhookAdapter` do provedor.
//  3. Os eventos normalizados entram por `ingestCarrierEvents`, que é idempotente e NUNCA muda o status da remessa
//     (mudar status continua sendo uma decisão humana, com auditoria) nem inventa entregas ou posições.
// Enquanto não existir um servidor, nada chama estas funções além dos testes.
import type { AppData, ShipmentEvent } from './types'
import { TRACKABLE, clean, fail, replace, trackingKey, uid, type Outcome } from './logistics'

export interface NormalizedCarrierEvent {
  /** Identificador único do evento na transportadora. */
  externalId: string
  trackingNumber: string
  /** Quando ocorreu (ISO). */
  occurredAt: string
  location: string
  description: string
}

/** Conversor do corpo bruto de um provedor para eventos normalizados. Cada integração futura implementa um. */
export interface CarrierWebhookAdapter {
  providerId: string
  parse(rawBody: string): NormalizedCarrierEvent[]
}

const enc = new TextEncoder()
const toHex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Assinatura HMAC-SHA256 em hexadecimal. Com `timestamp`, assina `timestamp.corpo` (protege contra reenvio). */
export async function signWebhook(secret: string, body: string, timestamp?: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const payload = timestamp === undefined ? body : `${timestamp}.${body}`
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)))
}

/** Comparação em tempo constante de duas strings hexadecimais do mesmo tamanho. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface VerifyOptions {
  secret: string
  body: string
  signature: string
  /** Carimbo de tempo (ms) enviado pela transportadora. Quando informado, entra na assinatura e precisa estar dentro da tolerância. */
  timestamp?: number
  now?: number
  toleranceMs?: number
}

/** Confere a assinatura de um webhook. Segredo vazio, assinatura malformada ou carimbo fora da tolerância são recusados. */
export async function verifyWebhook(o: VerifyOptions): Promise<boolean> {
  if (!o.secret || !/^[0-9a-f]{64}$/i.test(o.signature)) return false
  if (o.timestamp !== undefined) {
    const now = o.now ?? Date.now()
    if (!Number.isFinite(o.timestamp) || Math.abs(now - o.timestamp) > (o.toleranceMs ?? 5 * 60_000)) return false
  }
  const expected = await signWebhook(o.secret, o.body, o.timestamp)
  return safeEqual(expected, o.signature.toLowerCase())
}

export interface IngestResult {
  applied: number
  duplicates: number
  /** Sem remessa correspondente (código desconhecido, outra transportadora ou remessa ainda não despachada). */
  unmatched: number
  rejected: number
}

const norm = (s: string): string => s.trim().toLowerCase()

/**
 * Registra eventos de uma transportadora na linha do tempo (origem 'carrier'). Idempotente: o mesmo `externalId` ou o mesmo
 * fato (hora, local e texto) nunca entra duas vezes. Não altera o status, o estoque nem o financeiro.
 */
export function ingestCarrierEvents(d: AppData, carrierId: string, events: readonly NormalizedCarrierEvent[], now: string): Outcome<IngestResult> {
  const carrier = d.carriers.find((c) => c.id === carrierId)
  if (!carrier) return fail('unknown_carrier')
  const result: IngestResult = { applied: 0, duplicates: 0, unmatched: 0, rejected: 0 }
  let next = d

  for (const raw of events) {
    const externalId = clean(raw.externalId, 80)
    const trackingNumber = clean(raw.trackingNumber, 40)
    const description = clean(raw.description, 300)
    const location = clean(raw.location, 80)
    const ts = Date.parse(raw.occurredAt)
    if (!externalId || !trackingNumber || description.length < 3 || Number.isNaN(ts) || ts > Date.parse(now) + 5 * 60_000) {
      result.rejected++
      continue
    }
    const occurredAt = new Date(ts).toISOString()
    const ship = next.shipments.find((s) => s.carrierId === carrierId && norm(s.trackingNumber) === norm(trackingNumber) && TRACKABLE.includes(s.status))
    if (!ship) {
      result.unmatched++
      continue
    }
    const key = trackingKey(occurredAt, location, description)
    if (ship.events.some((e) => (e.externalId && e.externalId === externalId) || (e.kind === 'tracking' && e.occurredAt && trackingKey(e.occurredAt, e.location ?? '', e.description) === key))) {
      result.duplicates++
      continue
    }
    const ev: ShipmentEvent = { id: uid(), kind: 'tracking', at: now, occurredAt, location, description, source: 'carrier', externalId, actor: `carrier:${clean(carrier.name, 40)}` }
    next = replace(next, { ...ship, events: [...ship.events, ev], updatedAt: now })
    result.applied++
  }
  return { ok: true, data: next, value: result }
}
