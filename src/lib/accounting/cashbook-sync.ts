/**
 * Ponte entre o Livro-Caixa (que continua sendo a fonte do caixa) e o razão contábil.
 *
 * - NÃO cria, edita nem apaga registros do Livro-Caixa; apenas acompanha o que o usuário faz.
 * - Falhas do razão nunca interrompem o Livro-Caixa: o chamador aplica o resultado junto da alteração de caixa
 *   em uma única atualização de estado, e erros ficam registrados como eventos rejeitados na auditoria.
 * - Registros antigos (sem lançamento no razão) NÃO são reclassificados nem lançados retroativamente.
 * - A moeda de um lançamento existente é preservada em edições (nunca reinterpretada pela moeda atual do app).
 */
import type { CurrencyCode } from '../types'
import { activeEntryForCashEntry, latestCashBookRevision, postEvent, reverseEntry, type Ctx } from './engine'
import { cashBookEvent, isAdapterEnabled, type CashBookRow } from './adapters'
import type { LedgerState } from './types'

export interface SyncCtx extends Ctx {
  /** Moeda do app no momento do registro (só vale para lançamentos NOVOS). */
  currency: CurrencyCode
}

const FINANCIAL_FIELDS = ['type', 'amount', 'date', 'category'] as const

export function syncAdded(ledger: LedgerState, entry: CashBookRow, ctx: SyncCtx): LedgerState {
  if (!isAdapterEnabled(ledger, 'cashBook')) return ledger
  const res = cashBookEvent(ledger, entry, { currency: ctx.currency, revision: 0 })
  if (!res.ok) return ledger
  return postEvent(ledger, res.draft, ctx).ledger
}

export function syncUpdated(ledger: LedgerState, before: CashBookRow, after: CashBookRow, ctx: SyncCtx): LedgerState {
  if (!isAdapterEnabled(ledger, 'cashBook')) return ledger
  const active = activeEntryForCashEntry(ledger, before.id)
  if (!active) return ledger // histórico/legado: intocado
  if (FINANCIAL_FIELDS.every((k) => before[k] === after[k])) return ledger // só descrição etc.: nada financeiro mudou
  const reversed = reverseEntry(ledger, active.id, 'Livro-Caixa: lançamento editado', ctx)
  if (!reversed.ok) return reversed.ledger
  const revision = latestCashBookRevision(reversed.ledger, before.id) + 1
  const res = cashBookEvent(reversed.ledger, after, { currency: active.currency, revision })
  if (!res.ok) return reversed.ledger
  return postEvent(reversed.ledger, res.draft, ctx).ledger
}

export function syncRemoved(ledger: LedgerState, entry: CashBookRow, ctx: SyncCtx): LedgerState {
  if (!isAdapterEnabled(ledger, 'cashBook')) return ledger
  const active = activeEntryForCashEntry(ledger, entry.id)
  if (!active) return ledger
  return reverseEntry(ledger, active.id, 'Livro-Caixa: lançamento removido', ctx).ledger
}
