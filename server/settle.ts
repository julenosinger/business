/**
 * Liquidação financeira atômica no servidor (fases 3.0 → 3.1).
 *
 * - A obrigação (valor + moeda) e o saldo em aberto são DERIVADOS DO RAZÃO (nunca do cliente), considerando
 *   estornos/reversões (`isReversed`).
 * - A evidência on-chain é verificada server-side e sua identidade canônica (chain, hash, destinatário, valor)
 *   é usada para impedir reutilização da mesma transferência em operações diferentes.
 * - Liquidação + lançamento + registro + auditoria rodam em UMA transação SQLite (rollback integral em falha).
 * - Idempotência com detecção de conflito: retry idêntico devolve o resultado original; payload divergente é
 *   `duplicate_conflict`; mesma evidência com outro op é `evidence_reused`.
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
  | 'evidence_reused'

export type SettleResult =
  | { ok: true; duplicate: boolean; entryId: string | null; allocatedMinor: string; excessMinor: string }
  | { ok: false; error: SettleError }

type VerifyFn = (i: { chainId: number; txHash: string; expectedTo?: string; expectedAmountMinor?: bigint }) => Promise<{ state: 'confirmed' | 'failed' | 'pending' | 'ambiguous'; transfers?: { from: string; to: string; amountMinor: bigint }[] }>

function isActivePosted(ledger: LedgerState, e: { status: string; journalEntryId?: string }): boolean {
  return e.status === 'posted' && (!e.journalEntryId || !isReversed(ledger, e.journalEntryId))
}

function obligationOutstandingMinor(ledger: LedgerState, accountId: string): bigint {
  let created = 0n
  let settled = 0n
  for (const e of ledger.events) {
    if (e.payload.accountId !== accountId || !isActivePosted(ledger, e)) continue
    if (OBLIGATION_TYPES.includes(e.type)) created += BigInt(e.amountMinor)
    if (SETTLEMENT_TYPES.includes(e.type)) settled += BigInt(e.amountMinor)
  }
  return created - settled
}

function settlementTypeOf(ledger: LedgerState, accountId: string): EventType | null {
  const obligation = ledger.events.find((e) => OBLIGATION_TYPES.includes(e.type) && e.payload.accountId === accountId && isActivePosted(ledger, e) && !!e.journalEntryId)
  if (!obligation) return null
  if (obligation.source.module === 'payroll') return 'payroll.paid'
  if (obligation.type === 'sale.recorded' || obligation.type === 'receivable.created') return 'receivable.settled'
  return 'payable.settled'
}

const OWNER_ACTOR = { id: 'owner', kind: 'user' as const, role: 'owner' as const }

export async function settleOperation(db: LedgerDb, orgId: string, input: SettleInput, verify: VerifyFn = verifyUsdcReceipt): Promise<SettleResult> {
  const amountMinor = parseMinor(input.amount.trim(), 'USDC')
  if (amountMinor === null || amountMinor <= 0n) return { ok: false, error: 'invalid_amount' }
  if (!input.recipient) return { ok: false, error: 'unverified' } // pagamento exige destinatário (P0.2)
  const chainKey = input.destChainKey ?? input.chainKey
  const chainId = gatewayChainIdOf(chainKey)
  if (chainId === undefined) return { ok: false, error: 'unknown_chain' }

  // 1. Verificação server-side da evidência (fora da transação: I/O de rede).
  const verification = await verify({ chainId, txHash: input.txHash, expectedTo: input.recipient, expectedAmountMinor: amountMinor })
  if (verification.state !== 'confirmed') return { ok: false, error: 'unverified' }
  const transfer = verification.transfers?.[0]
  if (!transfer) return { ok: false, error: 'unverified' }
  const transferTo = transfer.to
  const transferAmountMinor = transfer.amountMinor.toString()

  // 2. Liquidação atômica.
  const now = new Date().toISOString()
  const run = db.db.transaction((): SettleResult => {
    // P1.1: idempotência por opId com detecção de conflito.
    const existing = db.getSettlementByOp(orgId, input.opId)
    if (existing) {
      const sameEvidence =
        existing.chainId === chainId && existing.txHash === input.txHash && existing.transferTo === transferTo && existing.amountMinor === transferAmountMinor
      if (sameEvidence) {
        // Retry idêntico: retorna o resultado original persistido (nunca zeros fictícios).
        return { ok: true, duplicate: true, entryId: existing.entryId, allocatedMinor: existing.allocatedMinor, excessMinor: existing.excessMinor }
      }
      return { ok: false, error: 'duplicate_conflict' }
    }
    // P0.1: a mesma evidência on-chain não pode liquidar outra operação.
    const reused = db.getSettlementByEvidence(orgId, chainId, input.txHash, transferTo, transferAmountMinor)
    if (reused) return { ok: false, error: 'evidence_reused' }

    const ledger = db.loadLedger(orgId) ?? emptyLedger(orgId)
    const settleType = settlementTypeOf(ledger, input.accountId)
    if (!settleType) return { ok: false, error: 'obligation_missing' }
    const obligation = ledger.events.find((e) => OBLIGATION_TYPES.includes(e.type) && e.payload.accountId === input.accountId && isActivePosted(ledger, e) && !!e.journalEntryId)!
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
    const payload = JSON.stringify({ accountId: input.accountId, txHash: input.txHash, chainKey, transferTo, allocatedMinor: plan.amountMinor.toString(), excessMinor: plan.excessMinor.toString(), currency })
    db.insertSettlement(orgId, {
      opId: input.opId,
      settlementId: `stl-${input.opId}`,
      accountId: input.accountId,
      entryId: result.entryId,
      allocatedMinor: plan.amountMinor.toString(),
      excessMinor: plan.excessMinor.toString(),
      currency,
      chainId,
      txHash: input.txHash,
      transferTo,
      amountMinor: transferAmountMinor,
      payload,
      createdAt: now,
    })
    const newAudit = result.ledger.audit.slice(ledger.audit.length)
    if (newAudit.length > 0) db.insertAudit(orgId, newAudit)
    db.saveLedger(orgId, result.ledger, now)
    return { ok: true, duplicate: false, entryId: result.entryId, allocatedMinor: plan.amountMinor.toString(), excessMinor: plan.excessMinor.toString() }
  })
  return run()
}
