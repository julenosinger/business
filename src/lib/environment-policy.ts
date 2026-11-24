/**
 * Motor de políticas por ambiente (fase FIN-01.2) — fonte única das políticas operacionais.
 *
 * - Arc Mainnet (5042) → `production`: preserva todas as validações atuais.
 * - Arc Testnet (5042002) → `sandbox`: permite dados fictícios/incompletos para experimentação,
 *   sem comprometer integridade estrutural (tipos, tamanhos, referências, débito/crédito, moedas).
 * - Ambiente desconhecido/não classificado → política restritiva (`production`), nunca sandbox.
 *
 * NÃO espalha condicionais por componentes: os formulários e o Store consultam este módulo.
 */
import type { NetworkId } from './network'
import { docErrorStatus, docValidForSubmit, onlyDigits } from './documents'

export type EnvironmentMode = 'production' | 'sandbox'

export function environmentMode(network: NetworkId | undefined): EnvironmentMode {
  return network === 'testnet' ? 'sandbox' : 'production'
}

export const isSandbox = (network: NetworkId | undefined): boolean => network === 'testnet'

export interface DocumentPolicy {
  /** Permite documento completo com dígitos verificadores fictícios (dado de teste). */
  allowFictitious: boolean
  /** Permite documento incompleto como dado experimental. */
  allowIncomplete: boolean
}

export function documentPolicy(network: NetworkId | undefined): DocumentPolicy {
  return isSandbox(network)
    ? { allowFictitious: true, allowIncomplete: true }
    : { allowFictitious: false, allowIncomplete: false }
}

/**
 * Validação FINAL de documento conforme a política do ambiente — unificada entre formulário e Store.
 * - Produção: validação rigorosa (`docValidForSubmit`).
 * - Sandbox: permite incompleto/fictício, respeitando o tamanho máximo (CPF 11, CNPJ 14).
 */
export function docAllowedForSubmit(raw: string, personType: 'fisica' | 'juridica', network: NetworkId | undefined): boolean {
  if (!isSandbox(network)) return docValidForSubmit(raw, personType)
  return onlyDigits(raw).length <= (personType === 'fisica' ? 11 : 14)
}

export type DocUiStatus = { kind: 'none' | 'incomplete' | 'invalid' | 'test'; digits: number; expected: number }

/**
 * Estado do documento para a interface, considerando a política do ambiente.
 * `test` = documento fictício/incompleto permitido no sandbox (exibido como aviso discreto, não erro).
 */
export function docUiStatus(raw: string, personType: 'fisica' | 'juridica', network: NetworkId | undefined): DocUiStatus {
  const strict = docErrorStatus(raw, personType)
  if (!isSandbox(network)) return strict
  const d = onlyDigits(raw)
  const expected = personType === 'fisica' ? 11 : 14
  if (d.length > expected) return { kind: 'invalid', digits: d.length, expected }
  if (strict.kind !== 'none') return { kind: 'test', digits: strict.digits, expected }
  return { kind: 'none', digits: d.length, expected }
}
