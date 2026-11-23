import { afterEach, describe, expect, test } from 'bun:test'
import { lookupCep, lookupCnpj } from '../src/lib/lookup'

const g = globalThis as unknown as Record<string, unknown>
const origFetch = g.fetch

afterEach(() => {
  g.fetch = origFetch
})

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('lookupCep (ViaCEP)', () => {
  test('sucesso preenche logradouro/bairro/cidade/estado', async () => {
    g.fetch = async () => jsonResponse({ logradouro: 'Rua A', bairro: 'Centro', localidade: 'São Paulo', uf: 'SP' })
    const r = await lookupCep('01001-000')
    expect(r.street).toBe('Rua A')
    expect(r.neighborhood).toBe('Centro')
    expect(r.city).toBe('São Paulo')
    expect(r.state).toBe('SP')
  })

  test('CEP não encontrado (erro:true) lança erro', async () => {
    g.fetch = async () => jsonResponse({ erro: true })
    await expect(lookupCep('00000-000')).rejects.toThrow()
  })

  test('CEP incompleto não chama o serviço', async () => {
    let called = false
    g.fetch = async () => {
      called = true
      return jsonResponse({})
    }
    await expect(lookupCep('123')).rejects.toThrow('invalid_cep')
    expect(called).toBe(false)
  })

  test('falha HTTP lança erro (não impede cadastro manual)', async () => {
    g.fetch = async () => new Response('erro', { status: 500 })
    await expect(lookupCep('01001-000')).rejects.toThrow()
  })

  test('sinal de cancelamento (abort) rejeita sem dados', async () => {
    g.fetch = async (_url: string, opts?: RequestInit) => {
      if ((opts?.signal as AbortSignal | undefined)?.aborted) throw new DOMException('Aborted', 'AbortError')
      return jsonResponse({ logradouro: 'Rua X' })
    }
    const controller = new AbortController()
    controller.abort()
    await expect(lookupCep('01001-000', controller.signal)).rejects.toThrow()
  })
})

describe('lookupCnpj (BrasilAPI)', () => {
  test('sucesso mapeia razão social, nome fantasia e endereço', async () => {
    g.fetch = async () => jsonResponse({ razao_social: 'Empresa LTDA', nome_fantasia: 'Empresa', logradouro: 'Rua B', numero: '10', complemento: 'Sala 1', bairro: 'Centro', municipio: 'Rio de Janeiro', uf: 'RJ', cep: '20000-000' })
    const r = await lookupCnpj('11.222.333/0001-81')
    expect(r.legalName).toBe('Empresa LTDA')
    expect(r.tradeName).toBe('Empresa')
    expect(r.city).toBe('Rio de Janeiro')
    expect(r.state).toBe('RJ')
    expect(r.cep).toBe('20000000')
  })

  test('CNPJ incompleto não chama o serviço', async () => {
    let called = false
    g.fetch = async () => {
      called = true
      return jsonResponse({})
    }
    await expect(lookupCnpj('11.222')).rejects.toThrow('invalid_cnpj')
    expect(called).toBe(false)
  })

  test('falha do provedor lança erro (não impede cadastro manual)', async () => {
    g.fetch = async () => new Response('erro', { status: 503 })
    await expect(lookupCnpj('11.222.333/0001-81')).rejects.toThrow()
  })
})
