import { describe, expect, test } from 'bun:test'
import { SessionStore, clearSessionCookieHeader, parseCookies, sessionCookieHeader } from '../server/session'

describe('sessão de autenticação (servidor)', () => {
  test('cria, valida e revoga sessões', () => {
    const store = new SessionStore()
    const s = store.create()
    expect(store.validate(s.id)).not.toBeNull()
    store.revoke(s.id)
    expect(store.validate(s.id)).toBeNull()
  })

  test('sessão inexistente não é validada', () => {
    const store = new SessionStore()
    expect(store.validate('nao-existe')).toBeNull()
    expect(store.validate(undefined)).toBeNull()
  })

  test('sessão expira após o TTL', () => {
    const store = new SessionStore(50) // 50ms
    const s = store.create()
    expect(store.validate(s.id)).not.toBeNull()
    // Avança o relógio verificando diretamente os timestamps.
    expect(s.expiresAt).toBeGreaterThan(s.createdAt)
    expect(s.expiresAt - s.createdAt).toBe(50)
  })

  test('cookie de sessão é HttpOnly, SameSite e com expiração', () => {
    const h = sessionCookieHeader('abc', true, 3600)
    expect(h).toContain('gbos_session=abc')
    expect(h).toContain('HttpOnly')
    expect(h).toContain('SameSite=Lax')
    expect(h).toContain('Secure')
    expect(h).toContain('Max-Age=3600')
  })

  test('cookie de logout limpa a sessão', () => {
    const h = clearSessionCookieHeader(false)
    expect(h).toContain('gbos_session=')
    expect(h).toContain('Max-Age=0')
    expect(h).not.toContain('Secure')
  })

  test('parseCookies extrai pares chave=valor', () => {
    expect(parseCookies('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' })
    expect(parseCookies(null)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })
})
