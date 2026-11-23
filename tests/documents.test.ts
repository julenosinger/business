import { describe, expect, test } from 'bun:test'
import { isDocValid, isEmailValid, isValidCnpj, isValidCpf, maskCnpj, maskCpf } from '../src/lib/documents'

describe('máscaras de CPF/CNPJ', () => {
  test('maskCpf formata 11 dígitos', () => {
    expect(maskCpf('11144477735')).toBe('111.444.777-35')
    expect(maskCpf('111.444.777-35')).toBe('111.444.777-35')
    expect(maskCpf('12345')).toBe('123.45')
  })

  test('maskCnpj formata 14 dígitos', () => {
    expect(maskCnpj('11222333000181')).toBe('11.222.333/0001-81')
    expect(maskCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81')
  })
})

describe('validação de documentos', () => {
  test('CPF válido e inválido', () => {
    expect(isValidCpf('111.444.777-35')).toBe(true)
    expect(isValidCpf('11144477735')).toBe(true)
    expect(isValidCpf('111.444.777-36')).toBe(false)
    expect(isValidCpf('11111111111')).toBe(false) // dígitos repetidos
  })

  test('CNPJ válido e inválido', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11222333000181')).toBe(true)
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false)
  })

  test('isDocValid: vazio ou incompleto é válido (opcional); completo inválido é rejeitado', () => {
    expect(isDocValid('', 'fisica')).toBe(true)
    expect(isDocValid('111.444', 'fisica')).toBe(true) // incompleto
    expect(isDocValid('111.444.777-35', 'fisica')).toBe(true)
    expect(isDocValid('111.444.777-36', 'fisica')).toBe(false)
    expect(isDocValid('11.222.333/0001-82', 'juridica')).toBe(false)
  })
})

describe('validação de email', () => {
  test('email válido, inválido e vazio', () => {
    expect(isEmailValid('')).toBe(true) // opcional
    expect(isEmailValid('nome@empresa.com')).toBe(true)
    expect(isEmailValid('sem-arroba')).toBe(false)
    expect(isEmailValid('a@b')).toBe(false)
  })
})
