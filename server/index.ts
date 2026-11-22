/**
 * Servidor HTTP do backend (fase 2.9).
 *
 * Configuração (variáveis de ambiente — nunca no frontend):
 * - GBOS_API_TOKEN  (obrigatório) — segredo de autenticação de dono único.
 * - GBOS_ORG_ID     (opcional, default 'local') — identificador da organização.
 * - GBOS_DB_PATH    (opcional, default ':memory:') — caminho do SQLite (ex.: '/data/gbos.sqlite').
 * - PORT            (opcional, default 8787).
 *
 * Executar: `bun run server` (definido em package.json).
 */
import { createApi, UnauthorizedError } from './api'
import { LedgerDb } from './db'

const token = process.env.GBOS_API_TOKEN
const orgId = process.env.GBOS_ORG_ID ?? 'local'
const dbPath = process.env.GBOS_DB_PATH ?? ':memory:'
const port = Number(process.env.PORT ?? 8787)

if (!token) {
  console.error('GBOS_API_TOKEN is required (single-owner auth secret). Refusing to start without authentication.')
  process.exit(1)
}

const db = new LedgerDb(dbPath)
const api = createApi(db, { token, orgId })

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)
    const auth = req.headers.get('authorization') ?? undefined
    try {
      if (req.method === 'GET' && url.pathname === '/api/ledger') return json(api.getLedger(auth))
      if (req.method === 'POST' && url.pathname === '/api/ledger/events') return json(api.postEvent(auth, (await req.json()) as never))
      if (req.method === 'POST' && url.pathname === '/api/ledger/settlements') return json(api.recordSettlement(auth, (await req.json()) as never))
      return json({ error: 'not_found' }, 404)
    } catch (err) {
      if (err instanceof UnauthorizedError) return json({ error: 'unauthorized' }, 401)
      return json({ error: err instanceof Error ? err.message : 'internal_error' }, 400)
    }
  },
})

console.log(`Global Business OS backend listening on :${port} (org ${orgId})`)
