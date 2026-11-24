import { describe, expect, test } from 'bun:test'
import { docAllowedForSubmit, docUiStatus, documentPolicy, environmentMode, isSandbox } from '../src/lib/environment-policy'

describe('motor de políticas por ambiente (production × sandbox)', () => {
  test('environmentMode: testnet → sandbox; mainnet/desconhecido → production (restritivo)', () => {
    expect(environmentMode('testnet')).toBe('sandbox')
    expect(environmentMode('mainnet')).toBe('production')
    expect(environmentMode(undefined)).toBe('production')
    expect(isSandbox('testnet')).toBe(true)
    expect(isSandbox('mainnet')).toBe(false)
    expect(isSandbox(undefined)).toBe(false)
  })

  test('documentPolicy: sandbox permite fictício/incompleto; produção não', () => {
    expect(documentPolicy('testnet')).toEqual({ allowFictitious: true, allowIncomplete: true })
    expect(documentPolicy('mainnet')).toEqual({ allowFictitious: false, allowIncomplete: false })
  })

  test('docAllowedForSubmit: Mainnet rigoroso; Testnet permite CNPJ fictício e incompleto', () => {
    const valido = '11.222.333/0001-81'
    const ficticio = '11.222.333/0001-82' // completo, dígito verificador errado
    const incompleto = '11.222.333/0001' // 12 dígitos
    // Mainnet
    expect(docAllowedForSubmit(valido, 'juridica', 'mainnet')).toBe(true)
    expect(docAllowedForSubmit(ficticio, 'juridica', 'mainnet')).toBe(false)
    expect(docAllowedForSubmit(incompleto, 'juridica', 'mainnet')).toBe(false)
    expect(docAllowedForSubmit('', 'juridica', 'mainnet')).toBe(true) // opcional
    // Testnet
    expect(docAllowedForSubmit(valido, 'juridica', 'testnet')).toBe(true)
    expect(docAllowedForSubmit(ficticio, 'juridica', 'testnet')).toBe(true)
    expect(docAllowedForSubmit(incompleto, 'juridica', 'testnet')).toBe(true)
    expect(docAllowedForSubmit('', 'juridica', 'testnet')).toBe(true)
  })

  test('docAllowedForSubmit: Testnet respeita o tamanho máximo (não aceita estouro)', () => {
    const muitoLongo = '11.222.333/0001-815' // 15 dígitos
    expect(docAllowedForSubmit(muitoLongo, 'juridica', 'testnet')).toBe(false)
  })

  test('docUiStatus: Testnet marca fictício/incompleto como test; Mainnet mantém o erro', () => {
    const ficticio = '11.222.333/0001-82'
    const incompleto = '11.222.333/0001'
    expect(docUiStatus(ficticio, 'juridica', 'testnet').kind).toBe('test')
    expect(docUiStatus(incompleto, 'juridica', 'testnet').kind).toBe('test')
    expect(docUiStatus('', 'juridica', 'testnet').kind).toBe('none')
    expect(docUiStatus(ficticio, 'juridica', 'mainnet').kind).toBe('invalid')
    expect(docUiStatus(incompleto, 'juridica', 'mainnet').kind).toBe('incomplete')
    expect(docUiStatus('', 'juridica', 'mainnet').kind).toBe('none')
  })
})
