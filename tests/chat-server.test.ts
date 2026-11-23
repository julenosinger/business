import { describe, expect, test } from 'bun:test'
import { createChatApi } from '../server/chat'
import { resolveProvider } from '../server/ai'
import { UnauthorizedError } from '../server/api'
import type { ChatProvider } from '../server/ai'

const mockProvider = (impl?: (messages: { role: string; content: string }[]) => Promise<string>): ChatProvider => ({
  id: 'mock',
  model: 'mock-1',
  generate: impl ?? (async () => 'resposta real'),
})

describe('endpoint de chat (backend seguro)', () => {
  test('autenticação de dono único', async () => {
    const api = createChatApi({ token: 'secret', provider: mockProvider() })
    await expect(api.chat(undefined, { message: 'oi' })).rejects.toThrow(UnauthorizedError)
    await expect(api.chat('Bearer errado', { message: 'oi' })).rejects.toThrow(UnauthorizedError)
  })

  test('sem provedor configurado → indisponível com instrução (não simula)', async () => {
    const api = createChatApi({ token: 'secret', provider: null })
    const r = await api.chat('Bearer secret', { message: 'Quanto vendemos?' })
    expect(r).toEqual({ ok: true, unavailable: true, reason: 'not_configured', instructions: expect.any(String) })
  })

  test('com provedor → resposta real usando a mensagem', async () => {
    let seen = ''
    const api = createChatApi({ token: 'secret', provider: mockProvider(async (m) => { seen = m[m.length - 1].content; return 'resposta' }) })
    const r = await api.chat('Bearer secret', { message: 'olá', context: { currency: 'BRL' } })
    expect(r).toEqual({ ok: true, text: 'resposta' })
    expect(seen).toBe('olá')
  })

  test('validação de payload: mensagem vazia e muito longa', async () => {
    const api = createChatApi({ token: 'secret', provider: mockProvider() })
    expect(await api.chat('Bearer secret', { message: '   ' })).toEqual({ ok: false, error: 'empty_message' })
    expect(await api.chat('Bearer secret', { message: 'x'.repeat(5000) })).toEqual({ ok: false, error: 'message_too_long' })
  })

  test('erro do provedor vira erro recuperável (sem falso sucesso)', async () => {
    const api = createChatApi({ token: 'secret', provider: mockProvider(async () => { throw new Error('provider_error:500') }) })
    expect(await api.chat('Bearer secret', { message: 'oi' })).toEqual({ ok: false, error: 'provider_error' })
  })

  test('rate limiting recusa excesso na janela', async () => {
    const api = createChatApi({ token: 'secret', provider: mockProvider(), rateLimit: { max: 2, windowMs: 60_000 } })
    expect(await api.chat('Bearer secret', { message: '1' })).toEqual({ ok: true, text: 'resposta real' })
    expect(await api.chat('Bearer secret', { message: '2' })).toEqual({ ok: true, text: 'resposta real' })
    expect(await api.chat('Bearer secret', { message: '3' })).toEqual({ ok: false, error: 'rate_limited' })
  })

  test('resolver provedor: ausente e com configuração', () => {
    expect(resolveProvider({})).toBeNull()
    expect(resolveProvider({ provider: 'openai' })).toBeNull() // sem chave
    const p = resolveProvider({ provider: 'openai', apiKey: 'k', model: 'm' })
    expect(p?.id).toBe('openai')
    expect(p?.model).toBe('m')
  })
})
