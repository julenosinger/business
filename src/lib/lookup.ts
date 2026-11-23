/**
 * Consultas externas OPCIONAIS (sem chave de API): ViaCEP (CEP) e BrasilAPI (CNPJ).
 * São chamadas apenas sob demanda do usuário; falhas/timeouts nunca impedem o cadastro.
 */

export interface CepResult {
  cep: string
  street: string
  neighborhood: string
  city: string
  state: string
}

export interface CnpjResult {
  legalName: string
  tradeName: string
  cep: string
  street: string
  number: string
  complement: string
  neighborhood: string
  city: string
  state: string
}

const TIMEOUT_MS = 8000

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Consulta um CEP brasileiro no ViaCEP. Lança erro em CEP inválido, indisponível ou timeout. */
export async function lookupCep(cep: string, signal?: AbortSignal): Promise<CepResult> {
  const digits = cep.replace(/\D/g, '')
  if (digits.length !== 8) throw new Error('invalid_cep')
  const data = await fetchJson<{ logradouro?: string; bairro?: string; localidade?: string; uf?: string; erro?: boolean }>(
    `https://viacep.com.br/ws/${digits}/json/`,
    signal,
  )
  if (data.erro) throw new Error('not_found')
  return {
    cep: digits,
    street: data.logradouro ?? '',
    neighborhood: data.bairro ?? '',
    city: data.localidade ?? '',
    state: data.uf ?? '',
  }
}

/** Consulta dados empresariais de um CNPJ na BrasilAPI. Lança erro em CNPJ inválido, indisponível ou timeout. */
export async function lookupCnpj(cnpj: string, signal?: AbortSignal): Promise<CnpjResult> {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) throw new Error('invalid_cnpj')
  const data = await fetchJson<{
    razao_social?: string
    nome_fantasia?: string
    logradouro?: string
    numero?: string
    complemento?: string
    bairro?: string
    municipio?: string
    uf?: string
    cep?: string
  }>(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, signal)
  return {
    legalName: data.razao_social ?? '',
    tradeName: data.nome_fantasia ?? '',
    cep: (data.cep ?? '').replace(/\D/g, ''),
    street: data.logradouro ?? '',
    number: data.numero ?? '',
    complement: data.complemento ?? '',
    neighborhood: data.bairro ?? '',
    city: data.municipio ?? '',
    state: data.uf ?? '',
  }
}
