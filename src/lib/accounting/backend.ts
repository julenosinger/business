/**
 * Persistência transacional do razão (fases 2.2 → 2.4) — backend real.
 *
 * O app hoje persiste em `localStorage` (um navegador, sem multiusuário). Este módulo define o CONTRATO
 * REST de um backend transacional e o transporte real (`fetch`), pronto para quando o servidor existir.
 *
 * REGRAS DE SEGURANÇA:
 * - A integração remota é DESLIGADA por padrão e NUNCA simula persistência bem-sucedida. Sem URL/token/orgId,
 *   `resolveBackend` devolve um backend remoto `available: false` com o motivo exato (não há fallback que
 *   "finja" ter gravado).
 * - O transporte é um `fetch` real contra uma API documentada; NÃO há métodos que lançam "not implemented".
 * - Idempotência, atomicidade, isolamento por `orgId` e autorização por papel são impostos no SERVIDOR
 *   (ver docs/phase-2.2.md). O cliente apenas envia o `orgId`, o `draft` e o `actor`.
 *
 * Contrato REST (a implementar no servidor):
 * - `POST {url}/api/ledger/events`  body `{ orgId, draft, actor }` → `PostResult` (JSON). Idempotente por
 *   `draft.idempotencyKey` dentro do `orgId` (restrição UNIQUE no banco), atômico (evento + journal + auditoria).
 * - `GET  {url}/api/ledger?orgId=...`  → `LedgerState` (JSON, cópia profunda, somente leitura).
 * - Autenticação: header `Authorization: Bearer <token>`.
 */

import type { Actor, EventDraft, LedgerState } from './types'
import type { PostResult } from './engine'

const API_EVENTS_PATH = '/api/ledger/events'
const API_LEDGER_PATH = '/api/ledger'

export interface BackendConfig {
  /** URL do backend (ex.: https://api.exemplo.com). Vazio = backend remoto desabilitado. */
  url: string
  /** Token de autenticação do servidor. Nunca persista no localStorage. */
  token: string
  /** Identificador da organização (isola os dados). */
  orgId: string
}

export type RemoteLedgerBackend =
  | {
      readonly kind: 'remote'
      readonly available: true
      /** Posta um evento no servidor com idempotência (atomicidade + isolamento por organização). */
      postEvent(draft: EventDraft, actor: Actor): Promise<PostResult>
      /** Consulta o estado do razão (somente leitura, cópia profunda). */
      fetch(): Promise<LedgerState>
    }
  | {
      readonly kind: 'remote'
      readonly available: false
      readonly reason: string
    }

export interface LocalLedgerBackend {
  readonly kind: 'local'
  readonly available: true
  reason?: undefined
}

export type LedgerBackend = LocalLedgerBackend | RemoteLedgerBackend

/** Backend local (comportamento atual do app): sempre disponível, sem servidor. */
export const localBackend: LocalLedgerBackend = { kind: 'local', available: true }

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let message = `Backend request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      // corpo não-JSON: mantém a mensagem genérica.
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

/** Cria o backend remoto com transporte HTTP real (fetch). */
export function createRemoteBackend(cfg: Required<BackendConfig>): RemoteLedgerBackend {
  const base = cfg.url.replace(/\/+$/, '')
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` }
  return {
    kind: 'remote',
    available: true,
    async postEvent(draft, actor) {
      return requestJson<PostResult>(`${base}${API_EVENTS_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ orgId: cfg.orgId, draft, actor }),
      })
    },
    async fetch() {
      return requestJson<LedgerState>(`${base}${API_LEDGER_PATH}?orgId=${encodeURIComponent(cfg.orgId)}`, { headers })
    },
  }
}

/**
 * Resolve o backend a partir da configuração. Sem credenciais completas, devolve um backend remoto
 * `available: false` com o motivo exato (nenhuma persistência é simulada).
 */
export function resolveBackend(cfg?: Partial<BackendConfig>): LedgerBackend {
  const url = cfg?.url?.trim()
  const token = cfg?.token?.trim()
  const orgId = cfg?.orgId?.trim()
  if (!url || !token || !orgId) {
    return {
      kind: 'remote',
      available: false,
      reason: !url ? 'missing_url' : !token ? 'missing_token' : 'missing_org_id',
    }
  }
  return createRemoteBackend({ url, token, orgId })
}

export const isRemoteAvailable = (b: LedgerBackend): b is RemoteLedgerBackend => b.kind === 'remote' && b.available
