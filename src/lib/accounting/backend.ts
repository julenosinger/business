/**
 * Persistência transacional do razão (fase 2.2) — contrato de backend.
 *
 * O app hoje persiste tudo em `localStorage` (um navegador, sem transações entre abas, sem multiusuário).
 * Este módulo define o CONTRATO de um backend transacional e a resolução de configuração.
 *
 * REGRA DE SEGURANÇA: a integração remota é DESLIGADA por padrão e NUNCA simula persistência bem-sucedida.
 * Sem URL/token/orgId configurados, `resolveBackend` devolve `{ kind: 'local', available: true }` (o
 * comportamento atual) e o backend remoto fica indisponível. Não há fallback silencioso que "finja" ter
 * gravado no servidor: a persistência local continua sendo a única fonte de verdade enquanto não houver
 * infraestrutura.
 *
 * Para produção (ver docs/phase-2.2.md):
 * - Banco transacional com restrição UNIQUE na chave de idempotência (`idempotencyKey`, por `orgId`).
 * - Lançamento atômico de (evento + journal + auditoria) em uma única transação.
 * - Isolamento por `orgId` em TODAS as consultas e escritas.
 * - Autenticação por usuário (nunca `localStorage`) e autorização por papel (ver `auth.ts`).
 * - Trilha de auditoria append-only no servidor.
 */

import type { Actor, EventDraft, LedgerState } from './types'
import type { PostResult } from './engine'

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

/**
 * Resolve o backend a partir da configuração. Sem credenciais completas, devolve o backend local e
 * NÃO cria um backend remoto (nenhuma persistência é simulada).
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
  // Infraestrutura disponível: cria o backend remoto (o transporte real fica fora do escopo desta fase;
  // os métodos `postEvent`/`fetch` devem ser implementados contra a API do servidor ao provisionar o backend).
  return {
    kind: 'remote',
    available: true,
    async postEvent() {
      throw new Error('Remote backend transport not implemented: configure the server API (see docs/phase-2.2.md).')
    },
    async fetch() {
      throw new Error('Remote backend transport not implemented: configure the server API (see docs/phase-2.2.md).')
    },
  }
}

export const isRemoteAvailable = (b: LedgerBackend): b is RemoteLedgerBackend => b.kind === 'remote' && b.available
