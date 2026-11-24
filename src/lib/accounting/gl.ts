/**
 * Consultas do Razão Geral (somente leitura): linhas, filtros, detalhe do lançamento e exportação.
 * Funções puras; a interface só apresenta o resultado.
 */
import { formatDecimal } from './money'
import { isReversed } from './engine'
import type { AuditRecord, EventType, FeeRecord, FinancialEvent, JournalEntry, LedgerState, SourceModule } from './types'
import type { CurrencyCode, Environment } from '../types'

export type GlStatus = 'posted' | 'reversed' | 'reversal'

export interface GlRow {
  key: string
  entryId: string
  date: string
  module: SourceModule | 'unknown'
  type: EventType | 'unknown'
  memo: string
  accountCode: string
  accountName: { pt: string; en: string }
  /** Valores como string decimal canônica (todas as casas da moeda); vazio quando não há. */
  debit: string
  credit: string
  currency: CurrencyCode
  status: GlStatus
  related: string
}

export interface GlFilter {
  from?: string
  to?: string
  account?: string
  currency?: CurrencyCode
  type?: EventType
  module?: SourceModule
  status?: GlStatus
  q?: string
  /** Isolamento por ambiente: só partidas do ambiente indicado (exclui `unassigned`). */
  environment?: Environment
}

export const entryStatus = (ledger: LedgerState, j: JournalEntry): GlStatus => (j.reversalOf ? 'reversal' : isReversed(ledger, j.id) ? 'reversed' : 'posted')

/** Registro de origem legível (para rastreabilidade): primeiro vínculo conhecido. */
export function relatedLabel(j: JournalEntry): string {
  const l = j.links
  if (l.cashEntryId) return `cash:${l.cashEntryId}`
  if (l.saleId) return `sale:${l.saleId}`
  if (l.purchaseId) return `purchase:${l.purchaseId}`
  if (l.accountId) return `account:${l.accountId}`
  if (l.opId) return `treasury:${l.opId}`
  if (l.reversalOf) return `reversal:${l.reversalOf}`
  return l.sourceRecord ? `${l.sourceModule ?? 'src'}:${l.sourceRecord}` : ''
}

export function glRows(ledger: LedgerState, f: GlFilter = {}): GlRow[] {
  const events = new Map(ledger.events.map((e) => [e.id, e]))
  const names = new Map(ledger.chart.map((c) => [c.code, c.name]))
  const q = f.q?.trim().toLowerCase()
  const rows: GlRow[] = []
  for (const j of ledger.journal) {
    if (j.orgId !== ledger.orgId) continue
    if (f.environment && j.environment !== f.environment) continue
    if (f.from && j.accountingDate < f.from) continue
    if (f.to && j.accountingDate > f.to) continue
    if (f.currency && j.currency !== f.currency) continue
    const ev = events.get(j.eventId)
    if (f.type && ev?.type !== f.type) continue
    if (f.module && ev?.source.module !== f.module) continue
    const status = entryStatus(ledger, j)
    if (f.status && status !== f.status) continue
    const related = relatedLabel(j)
    j.lines.forEach((line, idx) => {
      if (f.account && line.accountCode !== f.account) return
      const name = names.get(line.accountCode) ?? { pt: line.accountCode, en: line.accountCode }
      const amount = formatDecimal(BigInt(line.amountMinor), j.currency)
      const row: GlRow = {
        key: `${j.id}:${idx}`,
        entryId: j.id,
        date: j.accountingDate,
        module: ev?.source.module ?? 'unknown',
        type: ev?.type ?? 'unknown',
        memo: j.memo,
        accountCode: line.accountCode,
        accountName: name,
        debit: line.side === 'debit' ? amount : '',
        credit: line.side === 'credit' ? amount : '',
        currency: j.currency,
        status,
        related,
      }
      if (q) {
        const hay = `${j.id} ${j.memo} ${line.accountCode} ${name.pt} ${name.en} ${related} ${amount}`.toLowerCase()
        if (!hay.includes(q)) return
      }
      rows.push(row)
    })
  }
  // Mais recentes primeiro; dentro do mesmo dia, pela ordem de lançamento (maior número primeiro).
  return rows.sort((a, b) => (a.date === b.date ? (a.key < b.key ? 1 : -1) : a.date < b.date ? 1 : -1))
}

export interface EntryDetail {
  entry: JournalEntry
  event: FinancialEvent | undefined
  status: GlStatus
  original?: JournalEntry
  reversedBy?: JournalEntry
  fees: FeeRecord[]
  audit: AuditRecord[]
}

export function entryDetail(ledger: LedgerState, entryId: string): EntryDetail | null {
  const entry = ledger.journal.find((j) => j.id === entryId)
  if (!entry) return null
  const event = ledger.events.find((e) => e.id === entry.eventId)
  const original = entry.reversalOf ? ledger.journal.find((j) => j.id === entry.reversalOf) : undefined
  const reversedBy = ledger.journal.find((j) => j.reversalOf === entry.id)
  const fees = ledger.fees.filter((f) => `fee:${f.dedupeKey}` === entry.idempotencyKey || (!!entry.links.opId && f.source.recordId === entry.links.opId) || (!!entry.links.txHash && f.relatedRef === entry.links.txHash))
  const audit = ledger.audit.filter((a) => a.entryId === entry.id || (event !== undefined && a.eventId === event.id))
  return { entry, event, status: entryStatus(ledger, entry), ...(original ? { original } : {}), ...(reversedBy ? { reversedBy } : {}), fees, audit }
}

export const glCsvHeader = ['date', 'entry', 'source', 'type', 'description', 'account', 'account_name', 'debit', 'credit', 'currency', 'status', 'related'] as const

export function glCsvRows(rows: GlRow[], lang: 'pt' | 'en'): string[][] {
  return rows.map((r) => [r.date, r.entryId, r.module, r.type, r.memo, r.accountCode, r.accountName[lang], r.debit, r.credit, r.currency, r.status, r.related])
}
