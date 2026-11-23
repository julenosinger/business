import { describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

try {
  GlobalRegistrator.register()
} catch {
  // Já registrado em outro arquivo de teste do mesmo processo.
}

const { initChatRuntime, aiConfigured, fetchChatStatus, aiBackendUrl } = await import('../src/lib/ai-runtime')

describe('runtime de IA (inicialização automática)', () => {
  test('initChatRuntime é idempotente e, sem configuração, o chat fica indisponível', async () => {
    initChatRuntime()
    initChatRuntime() // idempotente
    expect(aiConfigured()).toBe(false)
    expect(aiBackendUrl()).toBeUndefined()
    expect(await fetchChatStatus()).toEqual({ kind: 'not_configured' })
  })
})
