import { describe, expect, test } from 'bun:test'
import { createChatApi } from '../server/chat'
import { resolveProvider } from '../server/ai'
import { UnauthorizedError } from '../server/api'
import { SessionStore } from '../server/session'
import type { ChatProvider } from '../server/ai'

const mockProvider = (impl?: (messages: { role: string; content: string }[]) => Promise<string>): ChatProvider => ({
  id: 'mock',
  model: 'mock-1',
  generate: impl ?? (async () => 'resposta real'),
})

function setup(provider: ChatProvider | null, rateLimit?: { max: number; windowMs: number }) {
  const sessions = new SessionStore()
  const session = sessions.create()
  const api = createChatApi({ sessions, provider, rateLimit })
  return { api, sessions, session }
}

describe('endpoint de chat (backend seguro, autenticado por sessão)', () => {
  test('sem sessão válida → 401 (nenhuma identidade confiável inventada)', async () => {
    const { api } = setup(mockProvider())
    await expect(api.chat(undefined, { message: 'oi' })).rejects.toThrow(UnauthorizedError)
    await expect(api.chat('sessao-invalida', { message: 'oi' })).rejects.toThrow(UnauthorizedError)
  })

  test('sessão válida é aceita (mestre nunca vai ao navegador)', async () => {
    const { api, session } = setup(mockProvider())
    expect((await api.chat(session.id, { message: 'oi' })).ok).toBe(true)
  })

  test('sessão revogada deixa de funcionar', async () => {
    const { api, sessions, session } = setup(mockProvider())
    sessions.revoke(session.id)
    await expect(api.chat(session.id, { message: 'oi' })).rejects.toThrow(UnauthorizedError)
  })

  test('sem provedor configurado → indisponível com instrução (não simula)', async () => {
    const { api, session } = setup(null)
    const r = await api.chat(session.id, { message: 'Quanto vendemos?' })
    expect(r).toEqual({ ok: true, unavailable: true, reason: 'not_configured', instructions: expect.any(String) })
  })

  test('com provedor → resposta real usando a mensagem', async () => {
    let seen = ''
    const { api, session } = setup(mockProvider(async (m) => { seen = m[m.length - 1].content; return 'resposta' }))
    const r = await api.chat(session.id, { message: 'olá', context: { currency: 'BRL' } })
    expect(r).toEqual({ ok: true, text: 'resposta' })
    expect(seen).toBe('olá')
  })

  test('validação de payload: mensagem vazia e muito longa', async () => {
    const { api, session } = setup(mockProvider())
    expect(await api.chat(session.id, { message: '   ' })).toEqual({ ok: false, error: 'empty_message' })
    expect(await api.chat(session.id, { message: 'x'.repeat(5000) })).toEqual({ ok: false, error: 'message_too_long' })
  })

  test('erro do provedor vira erro recuperável (sem falso sucesso)', async () => {
    const { api, session } = setup(mockProvider(async () => { throw new Error('provider_error:500') }))
    expect(await api.chat(session.id, { message: 'oi' })).toEqual({ ok: false, error: 'provider_error' })
  })

  test('rate limiting por identidade (sessão) recusa excesso na janela', async () => {
    const { api, session } = setup(mockProvider(), { max: 2, windowMs: 60_000 })
    expect(await api.chat(session.id, { message: '1' })).toEqual({ ok: true, text: 'resposta real' })
    expect(await api.chat(session.id, { message: '2' })).toEqual({ ok: true, text: 'resposta real' })
    expect(await api.chat(session.id, { message: '3' })).toEqual({ ok: false, error: 'rate_limited' })
  })

  test('rate limiting é isolado entre sessões', async () => {
    const sessions = new SessionStore()
    const a = sessions.create()
    const b = sessions.create()
    const api = createChatApi({ sessions, provider: mockProvider(), rateLimit: { max: 1, windowMs: 60_000 } })
    expect((await api.chat(a.id, { message: 'a' })).ok).toBe(true)
    expect(await api.chat(a.id, { message: 'a2' })).toEqual({ ok: false, error: 'rate_limited' })
    expect((await api.chat(b.id, { message: 'b' })).ok).toBe(true)
  })

  test('resolver provedor: ausente e com configuração', () => {
    expect(resolveProvider({})).toBeNull()
    expect(resolveProvider({ provider: 'openai' })).toBeNull() // sem chave
    const p = resolveProvider({ provider: 'openai', apiKey: 'k', model: 'm' })
    expect(p?.id).toBe('openai')
    expect(p?.model).toBe('m')
  })

  test('contexto não confiável: rejeita não-objeto e circular', async () => {
    const { api, session } = setup(mockProvider())
    expect(await api.chat(session.id, { message: 'oi', context: 'texto' })).toEqual({ ok: false, error: 'context_invalid' })
    expect(await api.chat(session.id, { message: 'oi', context: [1, 2] })).toEqual({ ok: false, error: 'context_invalid' })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(await api.chat(session.id, { message: 'oi', context: circular })).toEqual({ ok: false, error: 'context_invalid' })
  })

  test('status expõe apenas o id do provedor e a autenticação (sem credenciais)', () => {
    const { api, session } = setup(mockProvider())
    expect(api.status(session.id)).toEqual({ provider: 'mock', authenticated: true })
    expect(api.status(undefined)).toEqual({ provider: 'mock', authenticated: false })
    const unauthenticated = createChatApi({ sessions: new SessionStore(), provider: null })
    expect(unauthenticated.status(undefined)).toEqual({ provider: null, authenticated: false })
  })
})
