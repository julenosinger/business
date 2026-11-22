/**
 * Liquidação financeira atômica no servidor (fase 3.0 — P0.2/P0.3/P0.4).
 *
 * A obrigação (valor + moeda) e o saldo em aberto são DERIVADOS DO RAZÃO (eventos de obrigação e
 * liquidação), nunca confiados do cliente. A evidência on-chain é verificada server-side
 * (`verifyUsdcReceipt`). A liquidação + o lançamento contábil + o registro de liquidação + a auditoria
 * rodam em UMA transação SQLite (rollback integral em falha). Idempotência por `opId` (UNIQUE).
 */
import { emptyLedger, isReversed, postEvent } from '../src/lib/accounting/engine'
import { allocationMinor, planAllocationMinor } from '../src/lib/settlement-service'
import { verifyUsdcReceipt } from '../src/lib/accounting/verify'
import { parseMinor } from '../src/lib/accounting/money'
import { gatewayChainIdOf } from '../src/lib/network'
import type { EventDraft, EventType, LedgerState } from '../src/lib/accounting/types'
import type { LedgerDb } from './db'

const OBLIGATION_TYPES: EventType[] = ['payable.created', 'receivable.created', 'sale.recorded', 'purchase.recorded', 'payroll.accrued']
const SETTLEMENT_TYPES: EventType[] = ['payable.settled', 'receivable.settled', 'payroll.paid']

export interface SettleInput {
  opId: string
  accountId: string
  txHash: string
  /** Chain onde o hash vive: para spend, a de destino; para depósito, a de origem. */
  chainKey: string
  destChainKey?: string
  recipient?: string
  /** Valor USDC (decimal string). */
  amount: string
  fxDate: string
}

export type SettleError =
  | 'unverified'
  | 'invalid_amount'
  | 'unknown_chain'
  | 'obligation_missing'
  | 'already_settled'
  | 'unknown_currency'
  | 'fx_required'
  | 'period_closed'
  | 'post_failed'
  | 'duplicate_conflict'

export type SettleResult =
  | { ok: true; duplicate: boolean; entryId: string | null; allocatedMinor: string; excessMinor: string }
  | { ok: false; error: SettleError }

function obligationOutstandingMinor(ledger: LedgerState, accountId: string): bigint {
  let created = 0n
  let settled = 0n
  for (const e of ledger.events) {
    if (e.status !== 'posted' || e.payload.accountId !== accountId) continue
    if (OBLIGATION_TYPES.includes(e.type)) created += BigInt(e.amountMinor)
    if (SETTLEMENT_TYPES.includes(e.type)) settled += BigInt(e.amountMinor)
  }
  return created - settled
}

function settlementTypeOf(ledger: LedgerState, accountId: string): EventType | null {
  const obligation = ledger.events.find((e) => OBLIGATION_TYPES.includes(e.type) && e.payload.accountId === accountId && e.status === 'posted' && !!e.journalEntryId && !isReversed(ledger, e.journalEntryId))
  if (!obligation) return null
  if (obligation.source.module === 'payroll') return 'payroll.paid'
  if (obligation.type === 'sale.recorded' || obligation.type === 'receivable.created') return 'receivable.settled'
  return 'payable.settled'
}

const OWNER_ACTOR = { id: 'owner', kind: 'user' as const, role: 'owner' as const }

/**
 * Liquida uma operação de tesouraria contra uma obrigação, de forma atômica e idempotente.
 * Não reenvia transação; só posta a contabilidade. `verify` é injetável para testes (mock).
 */
export async function settleOperation(
  db: LedgerDb,
  orgId: string,
  input: SettleInput,
  verify: (i: { chainId: number; txHash: string; expectedTo?: string; expectedAmountMinor?: bigint }) => Promise<{ state: 'confirmed' | 'failed' | 'pending' | 'ambiguous' }> = verifyUsdcReceipt,
): Promise<SettleResult> {
  // 1. Verificação server-side da evidência on-chain (fora da transação, pois é I/O de rede).
  const amountMinor = parseMinor(input.amount.trim(), 'USDC')
  if (amountMinor === null || amountMinor <= 0n) return { ok: false, error: 'invalid_amount' }
  const chainKey = input.destChainKey ?? input.chainKey
  const chainId = gatewayChainIdOf(chainKey)
  if (chainId === undefined) return { ok: false, error: 'unknown_chain' }
  const verification = await verify({ chainId, txHash: input.txHash, expectedTo: input.recipient, expectedAmountMinor: amountMinor })
  if (verification.state !== 'confirmed') return { ok: false, error: 'unverified' }

  // 2. Liquidação atômica (uma transação SQLite; qualquer falha = rollback integral).
  const now = new Date().toISOString()
  const run = db.db.transaction((): SettleResult => {
    if (db.hasSettlementByOp(orgId, input.opId)) {
      // Mesma operação já liquidada: idempotente.
      return { ok: true, duplicate: true, entryId: null, allocatedMinor: '0', excessMinor: '0' }
    }
    const ledger = db.loadLedger(orgId) ?? emptyLedger(orgId)
    const settleType = settlementTypeOf(ledger, input.accountId)
    if (!settleType) return { ok: false, error: 'obligation_missing' }
    const obligation = ledger.events.find((e) => OBLIGATION_TYPES.includes(e.type) && e.payload.accountId === input.accountId && e.status === 'posted' && !!e.journalEntryId && !isReversed(ledger, e.journalEntryId))!
    const currency = obligation.currency
    const outstandingMinor = obligationOutstandingMinor(ledger, input.accountId)
    const alloc = allocationMinor(ledger, currency, input.amount, input.fxDate)
    if (!alloc.ok) return { ok: false, error: alloc.reason }
    const plan = planAllocationMinor(alloc.amountMinor, outstandingMinor)
    if (plan.amountMinor <= 0n) return { ok: false, error: 'already_settled' }
    const module = settleType === 'payroll.paid' ? 'payroll' : settleType === 'receivable.settled' ? 'receivables' : 'payables'
    const draft: EventDraft = {
      orgId,
      idempotencyKey: `settle:${input.opId}`,
      type: settleType,
      source: { module, recordId: input.accountId },
      occurredAt: now,
      accountingDate: input.fxDate,
      currency,
      amountMinor: plan.amountMinor.toString(),
      payload: { accountId: input.accountId, settleIn: 'usdc_gateway', txRef: input.txHash, verified: true, opId: input.opId },
      confirmation: 'confirmed',
    }
    const result = postEvent(ledger, draft, { now, actor: OWNER_ACTOR })
    if (!result.ok) {
      return { ok: false, error: result.errors.includes('period_closed') ? 'period_closed' : 'post_failed' }
    }
    const payload = JSON.stringify({
      accountId: input.accountId,
      txHash: input.txHash,
      chainKey,
      allocatedMinor: plan.amountMinor.toString(),
      excessMinor: plan.excessMinor.toString(),
      currency,
    })
    db.insertSettlement(orgId, input.opId, `stl-${input.opId}`, payload, now)
    const newAudit = result.ledger.audit.slice(ledger.audit.length)
    if (newAudit.length > 0) db.insertAudit(orgId, newAudit)
    db.saveLedger(orgId, result.ledger, now)
    return { ok: true, duplicate: false, entryId: result.entryId, allocatedMinor: plan.amountMinor.toString(), excessMinor: plan.excessMinor.toString() }
  })
  return run()
}
