/**
 * Sessão de autenticação do chat (fase UI 2.4.2) — servidor, em memória.
 *
 * O navegador NÃO recebe segredos: recebe um cookie HttpOnly com um ID de sessão opaco. O servidor
 * valida o ID a cada requisição e mantém o registro (criação/expiração) em memória — adequado ao
 * deploy de instância única; para múltiplas instâncias seria necessário um armazenamento compartilhado.
 *
 * Segurança:
 * - Cookie HttpOnly (JavaScript não lê), SameSite=Lax, Secure em produção, com expiração.
 * - Sessão criada somente após autenticação válida (login com segredo do dono).
 * - Revogação por logout e limpeza automática de sessões expiradas.
 */

export interface SessionRecord {
  id: string
  createdAt: number
  expiresAt: number
}

export const SESSION_COOKIE = 'gbos_session'
/** Cabeçalho exigido em POSTs autenticados (defesa CSRF: não definível em requisições cross-site sem preflight). */
export const CSRF_HEADER = 'x-gbos-csrf'

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000 // 8 horas

export class SessionStore {
  private sessions = new Map<string, SessionRecord>()

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  create(): SessionRecord {
    const id = crypto.randomUUID()
    const now = Date.now()
    const rec: SessionRecord = { id, createdAt: now, expiresAt: now + this.ttlMs }
    this.sessions.set(id, rec)
    this.cleanup()
    return rec
  }

  validate(id: string | undefined): SessionRecord | null {
    if (!id) return null
    const rec = this.sessions.get(id)
    if (!rec) return null
    if (rec.expiresAt <= Date.now()) {
      this.sessions.delete(id)
      return null
    }
    return rec
  }

  revoke(id: string): void {
    this.sessions.delete(id)
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [id, rec] of this.sessions) if (rec.expiresAt <= now) this.sessions.delete(id)
  }
}

export function sessionCookieHeader(id: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [`${SESSION_COOKIE}=${id}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAgeSeconds}`, 'SameSite=Lax']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookieHeader(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'Max-Age=0', 'SameSite=Lax']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
  }
  return out
}
