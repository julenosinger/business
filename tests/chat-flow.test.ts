import { beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

try {
  GlobalRegistrator.register()
} catch {
  // Já registrado em outro arquivo de teste do mesmo processo.
}

const { chatStore, configureChatTransport, getChatState } = await import('../src/lib/chat')

function resetChat(): void {
  const { conversations } = getChatState()
  for (const c of [...conversations]) chatStore.removeConversation(c.id)
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
  configureChatTransport(null)
  resetChat()
})

describe('fluxo de chat (envio real → resposta)', () => {
  test('envio com transporte devolve resposta real (assistente concluído)', async () => {
    let captured: { msg: string; ctx: unknown } | null = null
    configureChatTransport(async (msg, ctx) => {
      captured = { msg, ctx }
      return { ok: true, text: 'Vendemos R$ 1.000,00 neste mês.' }
    })
    chatStore.newConversation()
    chatStore.send('Quanto vendemos?', { sales: { total: 1000 } })
    await flush()
    const conv = getChatState().conversations[0]!
    expect(conv.messages).toHaveLength(2)
    expect(conv.messages[0]!.role).toBe('user')
    expect(conv.messages[1]!.status).toBe('done')
    expect(conv.messages[1]!.text).toBe('Vendemos R$ 1.000,00 neste mês.')
    expect(captured).toEqual({ msg: 'Quanto vendemos?', ctx: { sales: { total: 1000 } } })
  })

  test('transporte indisponível → assistente indisponível (sem simulação)', async () => {
    configureChatTransport(async () => ({ ok: true, unavailable: true, reason: 'not_configured', instructions: 'Configure o provedor.' }))
    chatStore.newConversation()
    chatStore.send('oi')
    await flush()
    const conv = getChatState().conversations[0]!
    expect(conv.messages[1]!.status).toBe('unavailable')
    expect(conv.messages[1]!.text).toBe('Configure o provedor.')
  })

  test('erro de transporte → assistente com erro (sem falso sucesso)', async () => {
    configureChatTransport(async () => {
      throw new Error('network')
    })
    chatStore.newConversation()
    chatStore.send('oi')
    await flush()
    const conv = getChatState().conversations[0]!
    expect(conv.messages[1]!.status).toBe('error')
    expect(conv.messages[1]!.text.length).toBeGreaterThan(0)
  })

  test('sem transporte configurado → indisponível com instrução', async () => {
    chatStore.newConversation()
    chatStore.send('oi')
    await flush()
    const conv = getChatState().conversations[0]!
    expect(conv.messages[1]!.status).toBe('unavailable')
  })

  test('envio duplicado é ignorado enquanto há resposta em andamento', async () => {
    let calls = 0
    let resolve!: (r: { ok: true; text: string }) => void
    configureChatTransport(async () => {
      calls += 1
      return new Promise((r) => {
        resolve = r
      })
    })
    chatStore.newConversation()
    chatStore.send('primeiro')
    chatStore.send('segundo') // ignorado
    expect(calls).toBe(1)
    resolve({ ok: true, text: 'resposta' })
    await flush()
    const conv = getChatState().conversations[0]!
    expect(conv.messages).toHaveLength(2)
    expect(conv.messages[0]!.text).toBe('primeiro')
    expect(conv.messages[1]!.text).toBe('resposta')
  })

  test('troca de conversa durante a resposta preserva a resposta original', async () => {
    let resolve!: (r: { ok: true; text: string }) => void
    configureChatTransport(async () => new Promise((r) => { resolve = r }))
    chatStore.newConversation()
    chatStore.send('pergunta')
    chatStore.newConversation() // troca para uma nova conversa antes da resposta
    resolve({ ok: true, text: 'resposta original' })
    await flush()
    const convs = getChatState().conversations
    expect(convs).toHaveLength(1)
    expect(convs[0]!.messages[1]!.text).toBe('resposta original')
  })
})
