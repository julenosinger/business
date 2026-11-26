/**
 * Servidor HTTP do backend (fase 2.9 → 2.4.2) — bootstrap.
 *
 * Configuração (variáveis de ambiente — nunca no frontend):
 * - GBOS_API_TOKEN     (obrigatório) — segredo de autenticação de dono único (ledger; nunca vai ao navegador).
 * - GBOS_LOGIN_SECRET  (opcional)    — segredo usado APENAS para o login do navegador (vira sessão cookie).
 * - GBOS_ALLOWED_ORIGIN(opcional)    — origem permitida para CORS (ex.: http://localhost:5173).
 * - GBOS_COOKIE_SECURE (opcional '1')— envia cookie com Secure (produção sob HTTPS).
 * - GBOS_ORG_ID / GBOS_DB_PATH / GBOS_ALLOW_MEMORY / PORT — persistência e execução.
 *
 * IA (opcional): GBOS_AI_PROVIDER, GBOS_AI_API_KEY, GBOS_AI_MODEL, GBOS_AI_BASE_URL.
 */
import { createApi } from './api'
import { createChatApi } from './chat'
import { resolveProvider } from './ai'
import { LedgerDb } from './db'
import { SessionStore } from './session'
import { createHandler } from './handler'

const token = process.env.GBOS_API_TOKEN
const orgId = process.env.GBOS_ORG_ID ?? 'local'
const dbPath = process.env.GBOS_DB_PATH
const allowMemory = process.env.GBOS_ALLOW_MEMORY === '1'
const port = Number(process.env.PORT ?? 8787)
const loginSecret = process.env.GBOS_LOGIN_SECRET
const allowedOrigin = process.env.GBOS_ALLOWED_ORIGIN?.trim()
const cookieSecure = process.env.GBOS_COOKIE_SECURE === '1'

if (!token) {
  console.error('GBOS_API_TOKEN is required (single-owner auth secret). Refusing to start without authentication.')
  process.exit(1)
}
if (!dbPath && !allowMemory) {
  console.error('GBOS_DB_PATH is required for a persistent backend (e.g. /data/gbos.sqlite). Set GBOS_ALLOW_MEMORY=1 only for development/tests.')
  process.exit(1)
}

const db = new LedgerDb(dbPath ?? ':memory:')
const api = createApi(db, { token, orgId })
const sessions = new SessionStore()
const provider = resolveProvider({
  provider: process.env.GBOS_AI_PROVIDER,
  apiKey: process.env.GBOS_AI_API_KEY,
  model: process.env.GBOS_AI_MODEL,
  baseUrl: process.env.GBOS_AI_BASE_URL,
})
const chat = createChatApi({ sessions, provider })

if (!provider) console.log('AI chat is unavailable: set GBOS_AI_PROVIDER and GBOS_AI_API_KEY to enable real responses.')
if (!loginSecret) console.log('Browser login disabled: set GBOS_LOGIN_SECRET to allow authenticated chat from the browser.')

Bun.serve({
  port,
  fetch: createHandler({ api, chat, sessions, db, loginSecret, allowedOrigin, cookieSecure, sessionMaxAge: 8 * 60 * 60 }),
})

console.log(`Global Business OS backend listening on :${port} (org ${orgId}, db ${dbPath ?? ':memory:'})`)
