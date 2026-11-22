import { describe, expect, test, beforeEach } from 'bun:test'

// Stubs de DOM/localStorage antes dos imports dinâmicos (store de teste isolado por arquivo).
const g = globalThis as unknown as Record<string, unknown>
const storage = new Map<string, string>()
g.localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
}
g.navigator = { language: 'pt-BR' }
g.document = { documentElement: { lang: '' } }

const { SPECIALTIES, specialtyLabel, addAgent, removeAgent } = await import('../src/lib/agents')
const { agentTemplates, specialtyIcon } = await import('../src/components/agents/catalog')
const { chatStore } = await import('../src/lib/chat')

beforeEach(() => {
  storage.clear()
})

describe('catálogo de templates de agentes (dados estáticos)', () => {
  test('expõe exatamente 6 templates, um por especialidade', () => {
    const templates = agentTemplates()
    expect(templates).toHaveLength(6)
    const keys = templates.map((t) => t.specialty)
    expect(keys.sort()).toEqual([...SPECIALTIES].sort())
  })

  test('cada template tem nome, descrição e ícone', () => {
    for (const t of agentTemplates()) {
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(0)
      expect(specialtyIcon(t.specialty)).toBeTruthy()
    }
  })

  test('specialtyLabel cobre todas as especialidades', () => {
    for (const s of SPECIALTIES) {
      expect(specialtyLabel(s).length).toBeGreaterThan(0)
    }
  })
})

describe('agentes criados (configuração preliminar, sem execução)', () => {
  test('addAgent persiste um agente pausado e removeAgent o exclui', () => {
    const id = addAgent({ name: 'Financeiro', description: 'Observa contas', specialty: 'finance' })
    const afterAdd = JSON.parse(storage.get('gbos:agents') ?? '[]') as { id: string; status: string }[]
    expect(afterAdd).toHaveLength(1)
    expect(afterAdd[0]!.id).toBe(id)
    expect(afterAdd[0]!.status).toBe('paused')

    removeAgent(id)
    const afterRemove = JSON.parse(storage.get('gbos:agents') ?? '[]')
    expect(afterRemove).toHaveLength(0)
  })
})

describe('chat (sem backend de IA)', () => {
  test('chatStore.send armazena apenas mensagens do usuário — nenhuma resposta fictícia', () => {
    chatStore.newConversation()
    chatStore.send('Show upcoming payments')

    const convs = JSON.parse(storage.get('gbos:chat') ?? '[]') as { id: string; messages: { role: string }[] }[]
    expect(convs).toHaveLength(1)
    expect(convs[0]!.messages).toHaveLength(1)
    expect(convs[0]!.messages.every((m) => m.role === 'user')).toBe(true)

    chatStore.removeConversation(convs[0]!.id)
    expect(JSON.parse(storage.get('gbos:chat') ?? '[]')).toHaveLength(0)
  })
})
