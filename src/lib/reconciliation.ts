/**
 * Coordenação de reconciliação automática (fase 2.6).
 *
 * Funções puras para backoff exponencial com jitter, usadas pelo coordenador de polling limitado.
 * Evita polling agressivo que desperdiça créditos de RPC.
 */

/** Backoff exponencial com jitter (±25%). `rand` é injetável para testes determinísticos. */
export function backoffDelay(attempt: number, baseMs = 30_000, maxMs = 300_000, rand: () => number = Math.random): number {
  const n = Math.max(0, Math.floor(attempt))
  const exp = Math.min(baseMs * 2 ** n, maxMs)
  const jitter = 0.75 + rand() * 0.5 // 0.75..1.25
  return Math.round(exp * jitter)
}

/** Operações pendentes que podem ser reconciliadas automaticamente (somente `pending`, sem revisão humana). */
export const isAutoReconcilable = (status: string | undefined): boolean => status === 'pending'
