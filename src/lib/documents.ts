/**
 * Máscaras e validações de documentos (CPF/CNPJ) e email — usados nos cadastros (fase UI 2.0).
 * Validações são proporcionais: só valem quando o campo foi preenchido (nada é exigido por padrão).
 */

export const onlyDigits = (v: string): string => v.replace(/\D/g, '')

/** Máscara de CPF: 000.000.000-00. */
export function maskCpf(raw: string): string {
  const d = onlyDigits(raw).slice(0, 11)
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

/** Máscara de CNPJ: 00.000.000/0000-00. */
export function maskCnpj(raw: string): string {
  const d = onlyDigits(raw).slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

/** Dígito verificador de CPF (os 2 últimos). */
function cpfCheckDigits(d: string): string {
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i)
  const d1 = (sum * 10) % 11 % 10
  sum = 0
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i)
  const d2 = (sum * 10) % 11 % 10
  return `${d1}${d2}`
}

/** CPF válido (11 dígitos, dígitos verificadores corretos e não-repetido). */
export function isValidCpf(raw: string): boolean {
  const d = onlyDigits(raw)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  return cpfCheckDigits(d) === d.slice(9)
}

/** Dígito verificador de CNPJ (os 2 últimos). */
function cnpjCheckDigits(d: string): string {
  const calc = (len: number): number => {
    let sum = 0
    let pos = len - 7
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * pos--
      if (pos < 2) pos = 9
    }
    return (sum % 11) < 2 ? 0 : 11 - (sum % 11)
  }
  return `${calc(12)}${calc(13)}`
}

/** CNPJ válido (14 dígitos, dígitos verificadores corretos e não-repetido). */
export function isValidCnpj(raw: string): boolean {
  const d = onlyDigits(raw)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  return cnpjCheckDigits(d) === d.slice(12)
}

/** Valida o documento conforme o tipo de pessoa. Vazio ou incompleto → true (campo opcional/em digitação). */
export function isDocValid(raw: string, personType: 'fisica' | 'juridica'): boolean {
  const d = onlyDigits(raw)
  if (d.length === 0) return true
  const len = personType === 'fisica' ? 11 : 14
  if (d.length < len) return true
  return personType === 'fisica' ? isValidCpf(d) : isValidCnpj(d)
}

/**
 * Validação FINAL (para salvamento): documento vazio é opcional; se preenchido, deve estar
 * completo e com dígitos verificadores corretos. Usada no formulário e no store.
 */
export function docValidForSubmit(raw: string, personType: 'fisica' | 'juridica'): boolean {
  const d = onlyDigits(raw)
  if (d.length === 0) return true
  return personType === 'fisica' ? isValidCpf(d) : isValidCnpj(d)
}

/** true quando o documento está completo porém inválido (para exibir erro próximo ao campo). */
export function docInvalidError(raw: string, personType: 'fisica' | 'juridica'): boolean {
  const d = onlyDigits(raw)
  if (d.length === 0) return false
  const len = personType === 'fisica' ? 11 : 14
  if (d.length < len) return false
  return personType === 'fisica' ? !isValidCpf(d) : !isValidCnpj(d)
}

/** Normaliza um documento (somente dígitos) para comparação de duplicidade. */
export const normalizeDoc = onlyDigits

/** Normaliza um email (minúsculas, sem espaços) para comparação. Vazio permanece vazio. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Email válido (formato simples). Vazio → true (campo opcional). */
export function isEmailValid(email: string): boolean {
  const e = email.trim()
  if (e.length === 0) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}
