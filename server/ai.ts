/**
 * Adaptador de provedor de IA (fase UI 2.4) — executa EXCLUSIVAMENTE no servidor.
 *
 * Chaves de API vivem apenas em variáveis de ambiente; nunca são enviadas ao bundle do frontend.
 * Sem provedor configurado, `resolveProvider` devolve `null` (o endpoint de chat responde "indisponível",
 * sem simular respostas). Nenhuma credencial ou endpoint é inventado: os endpoints usados são as APIs
 * públicas documentadas de cada provedor (substituíveis por `GBOS_AI_BASE_URL` para gateways compatíveis).
 *
 * Configuração (variáveis de ambiente):
 * - GBOS_AI_PROVIDER   'openai' | 'anthropic' (ausente = indisponível)
 * - GBOS_AI_API_KEY    chave do provedor (obrigatória para disponibilizar)
 * - GBOS_AI_MODEL      modelo (ex.: 'gpt-4o-mini' | 'claude-3-5-haiku-latest')
 * - GBOS_AI_BASE_URL   opcional: sobrescreve o endpoint base (gateways compatíveis).
 */

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatProvider {
  readonly id: string
  readonly model: string
  /** Gera uma resposta de texto. Lança em falha do provedor (o endpoint traduz para erro recuperável). */
  generate(messages: AiMessage[]): Promise<string>
}

export interface ProviderConfig {
  provider?: string
  apiKey?: string
  model?: string
  baseUrl?: string
}

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'
const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com/v1'

/** Timeout da chamada ao provedor (evita requisições penduradas). */
const PROVIDER_TIMEOUT_MS = 30_000
/** Tamanho máximo da resposta (evita consumo/custo descontrolado). */
const MAX_RESPONSE_CHARS = 8_000

function clip(text: string): string {
  return text.length > MAX_RESPONSE_CHARS ? `${text.slice(0, MAX_RESPONSE_CHARS)}\n…` : text
}

async function openAiGenerate(base: string, apiKey: string, model: string, messages: AiMessage[]): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 1000 }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`provider_error:${res.status}`)
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = body.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('provider_empty_response')
  return clip(text)
}

async function anthropicGenerate(base: string, apiKey: string, model: string, messages: AiMessage[]): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
  const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }))
  const res = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1000, system: system || undefined, messages: rest }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`provider_error:${res.status}`)
  const body = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = body.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim()
  if (!text) throw new Error('provider_empty_response')
  return clip(text)
}

/** Resolve o provedor a partir da configuração. `null` = indisponível (não há simulação). */
export function resolveProvider(cfg: ProviderConfig): ChatProvider | null {
  const provider = cfg.provider?.trim().toLowerCase()
  const apiKey = cfg.apiKey?.trim()
  if (!provider || !apiKey) return null
  if (provider === 'openai') {
    const model = cfg.model?.trim() || 'gpt-4o-mini'
    const base = (cfg.baseUrl?.trim() || DEFAULT_OPENAI_BASE).replace(/\/+$/, '')
    return { id: 'openai', model, generate: (m) => openAiGenerate(base, apiKey, model, m) }
  }
  if (provider === 'anthropic') {
    const model = cfg.model?.trim() || 'claude-3-5-haiku-latest'
    const base = (cfg.baseUrl?.trim() || DEFAULT_ANTHROPIC_BASE).replace(/\/+$/, '')
    return { id: 'anthropic', model, generate: (m) => anthropicGenerate(base, apiKey, model, m) }
  }
  return null
}
