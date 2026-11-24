import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Globe2, Search, BookText, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { Badge, Button, Empty, Field, Modal, inputCls } from '@/components/ui'
import { DateField } from '@/components/DateField'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { EntryDrawer } from './EntryDrawer'
import { SOURCE_LABELS, TYPE_LABELS, explainLedger } from './messages'
import { useStore } from '@/lib/store'
import { useNetwork } from '@/lib/network'
import { glCsvHeader, glCsvRows, glRows, type GlRow, type GlStatus } from '@/lib/accounting/gl'
import { formatDecimal, SUPPORTED_CURRENCIES, parseMinor } from '@/lib/accounting/money'
import { convertForReporting } from '@/lib/accounting/reviews'
import { RULES } from '@/lib/accounting/rules'
import type { EventType, SourceModule } from '@/lib/accounting/types'
import { downloadCsv, formatCurrency, fmtDate, iso, today } from '@/lib/format'
import { t, getLang } from '@/lib/i18n'
import type { CurrencyCode } from '@/lib/types'

const PAGE = 25
const MODULES: SourceModule[] = ['cashbook', 'sales', 'purchases', 'payables', 'receivables', 'payroll', 'logistics', 'treasury', 'fees', 'adjustment']

const amountText = (v: string, c: CurrencyCode): string => (v === '' ? '' : formatCurrency(Number(v), c))

function StatusBadge({ s }: { s: GlStatus }) {
  if (s === 'reversal') return <Badge tone="neutral">{t('Estorno', 'Reversal')}</Badge>
  if (s === 'reversed') return <Badge tone="warn">{t('Estornado', 'Reversed')}</Badge>
  return <Badge tone="ok">{t('Lançado', 'Posted')}</Badge>
}

/** Modal para registrar/consultar taxas de câmbio informadas (fonte + horário). Nunca aplicadas sozinhas. */
function FxModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, recordLedgerFxRate } = useStore()
  const [from, setFrom] = useState<CurrencyCode>('BRL')
  const [to, setTo] = useState<CurrencyCode>('USDC')
  const [rate, setRate] = useState('')
  const [source, setSource] = useState('')
  const [date, setDate] = useState(today)
  const [error, setError] = useState('')
  const submit = () => {
    const r = recordLedgerFxRate({ from, to, rate: rate.trim().replace(',', '.'), source, at: `${date}T12:00:00.000Z` })
    if (!r.ok) setError(explainLedger(r.errors))
    else {
      setError('')
      setRate('')
      setSource('')
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('Taxas de câmbio informadas', 'Recorded exchange rates')}>
      <p className="mb-3 text-xs text-subtle text-pretty">{t('Usadas somente para mostrar valores na moeda de relatório. O app não converte nada sem uma taxa registrada com fonte e data, e nunca altera os lançamentos.', 'Used only to display values in the reporting currency. The app converts nothing without a rate recorded with source and date, and never changes the entries.')}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('De', 'From')}>
          <select className={inputCls} value={from} onChange={(e) => setFrom(e.target.value as CurrencyCode)}>
            {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={t('Para', 'To')}>
          <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value as CurrencyCode)}>
            {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={t('Taxa (1 unidade de origem = ? destino)', 'Rate (1 source unit = ? target)')}>
          <input className={inputCls} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.18" />
        </Field>
        <Field label={t('Data da taxa', 'Rate date')}>
          <DateField value={date} onChange={setDate} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label={t('Fonte da taxa', 'Rate source')}>
          <input className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} placeholder={t('Ex.: banco, provedor, cotação manual', 'E.g. bank, provider, manual quote')} />
        </Field>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-bad">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t('Fechar', 'Close')}</Button>
        <Button onClick={submit}>{t('Registrar taxa', 'Record rate')}</Button>
      </div>
      {data.ledger.fxRates.length > 0 ? (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line text-sm">
          {[...data.ledger.fxRates].reverse().map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span className="num">{r.from} → {r.to} · {r.rate}</span>
              <span className="text-xs text-subtle">{r.source} · {r.at.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}

export function GeneralLedgerTab({ initialQuery, onConsume }: { initialQuery?: string; onConsume?: () => void } = {}) {
  const { data } = useStore()
  const network = useNetwork()
  const ledger = data.ledger
  const lang = getLang()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [account, setAccount] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode | ''>('')
  const [type, setType] = useState<EventType | ''>('')
  const [module, setModule] = useState<SourceModule | ''>('')
  const [status, setStatus] = useState<GlStatus | ''>('')
  const [q, setQ] = useState(initialQuery ?? '')
  const [reporting, setReporting] = useState<CurrencyCode | ''>('')
  const [page, setPage] = useState(0)
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const [fxOpen, setFxOpen] = useState(false)
  const [appliedQuery, setAppliedQuery] = useState<string | null>(initialQuery ?? null)

  // Aplica o foco vindo do "Ver no razão" (padrão de seed, sem setState em efeito).
  if (initialQuery && initialQuery !== appliedQuery) {
    setAppliedQuery(initialQuery)
    setQ(initialQuery)
    setPage(0)
  }
  useEffect(() => {
    if (initialQuery) onConsume?.()
  }, [initialQuery, onConsume])

  const rows = useMemo(
    () =>
      glRows(ledger, {
        environment: network,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(account ? { account } : {}),
        ...(currency ? { currency } : {}),
        ...(type ? { type } : {}),
        ...(module ? { module } : {}),
        ...(status ? { status } : {}),
        ...(q ? { q } : {}),
      }),
    [ledger, network, from, to, account, currency, type, module, status, q],
  )
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const shown = rows.slice(cur * PAGE, cur * PAGE + PAGE)

  const scopedJournal = useMemo(() => ledger.journal.filter((j) => j.environment === network), [ledger.journal, network])
  const scopedEvents = useMemo(() => ledger.events.filter((e) => e.environment === network), [ledger.events, network])
  const currencies = useMemo(() => [...new Set(scopedJournal.map((j) => j.currency))].sort(), [scopedJournal])
  const types = useMemo(() => (Object.keys(RULES) as EventType[]).filter((tp) => scopedEvents.some((e) => e.type === tp)), [scopedEvents])
  const unassignedCount = useMemo(() => ledger.journal.filter((j) => !j.environment || j.environment === 'unassigned').length, [ledger.journal])
  const totals = useMemo(() => {
    const m = new Map<CurrencyCode, { d: bigint; c: bigint }>()
    for (const r of rows) {
      const s = m.get(r.currency) ?? { d: 0n, c: 0n }
      s.d += r.debit ? (parseMinor(r.debit, r.currency) ?? 0n) : 0n
      s.c += r.credit ? (parseMinor(r.credit, r.currency) ?? 0n) : 0n
      m.set(r.currency, s)
    }
    return [...m.entries()]
  }, [rows])

  const reportingCell = (r: GlRow): string => {
    if (!reporting) return ''
    if (r.currency === reporting) return amountText(r.debit || r.credit, r.currency)
    const v = r.debit || r.credit
    const minor = parseMinor(v, r.currency)
    const conv = minor === null ? null : convertForReporting(ledger, minor, r.currency, reporting, r.date)
    return conv ? formatCurrency(Number(formatDecimal(conv.amountMinor, reporting)), reporting) : t('indisponível', 'unavailable')
  }

  const reset = (fn: () => void) => () => {
    fn()
    setPage(0)
  }
  const exportCsv = () => {
    downloadCsv(`general-ledger-${iso(new Date())}.csv`, [[...glCsvHeader], ...glCsvRows(rows, lang)])
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <TCard className="p-4 sm:p-5">
        <PanelTitle
          icon={<BookText size={18} />}
          title={t('Razão Geral', 'General ledger')}
          subtitle={t(`${rows.length} ${rows.length === 1 ? 'linha' : 'linhas'} · ${scopedJournal.length} ${scopedJournal.length === 1 ? 'lançamento' : 'lançamentos'} (${network})`, `${rows.length} ${rows.length === 1 ? 'line' : 'lines'} · ${scopedJournal.length} ${scopedJournal.length === 1 ? 'entry' : 'entries'} (${network})`)}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setFxOpen(true)}>
                <Globe2 size={16} /> {t('Câmbio', 'FX rates')}
              </Button>
              <Button variant="ghost" onClick={exportCsv} disabled={rows.length === 0}>
                <Download size={16} /> CSV
              </Button>
            </div>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('De', 'From')}>
            <DateField value={from} onChange={(v) => { setFrom(v); setPage(0) }} />
          </Field>
          <Field label={t('Até', 'To')}>
            <DateField value={to} onChange={(v) => { setTo(v); setPage(0) }} />
          </Field>
          <Field label={t('Conta', 'Account')}>
            <select className={inputCls} value={account} onChange={(e) => reset(() => setAccount(e.target.value))()}>
              <option value="">{t('Todas', 'All')}</option>
              {ledger.chart.filter((c) => c.subtype !== 'group').map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.name[lang]}</option>
              ))}
            </select>
          </Field>
          <Field label={t('Moeda', 'Currency')}>
            <select className={inputCls} value={currency} onChange={(e) => reset(() => setCurrency(e.target.value as CurrencyCode | ''))()}>
              <option value="">{t('Todas', 'All')}</option>
              {currencies.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label={t('Tipo de transação', 'Transaction type')}>
            <select className={inputCls} value={type} onChange={(e) => reset(() => setType(e.target.value as EventType | ''))()}>
              <option value="">{t('Todos', 'All')}</option>
              {types.map((tp) => <option key={tp} value={tp}>{TYPE_LABELS[tp]()}</option>)}
            </select>
          </Field>
          <Field label={t('Origem', 'Source')}>
            <select className={inputCls} value={module} onChange={(e) => reset(() => setModule(e.target.value as SourceModule | ''))()}>
              <option value="">{t('Todas', 'All')}</option>
              {MODULES.map((m) => <option key={m} value={m}>{SOURCE_LABELS[m]()}</option>)}
            </select>
          </Field>
          <Field label={t('Situação', 'Status')}>
            <select className={inputCls} value={status} onChange={(e) => reset(() => setStatus(e.target.value as GlStatus | ''))()}>
              <option value="">{t('Todas', 'All')}</option>
              <option value="posted">{t('Lançado', 'Posted')}</option>
              <option value="reversed">{t('Estornado', 'Reversed')}</option>
              <option value="reversal">{t('Estorno', 'Reversal')}</option>
            </select>
          </Field>
          <Field label={t('Moeda de relatório', 'Reporting currency')} hint={t('Só converte com taxa registrada.', 'Converts only with a recorded rate.')}>
            <select className={inputCls} value={reporting} onChange={(e) => setReporting(e.target.value as CurrencyCode | '')}>
              <option value="">{t('Original (sem conversão)', 'Original (no conversion)')}</option>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div className="relative mt-3">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            className={clsx(inputCls, 'pl-9')}
            value={q}
            onChange={(e) => reset(() => setQ(e.target.value))()}
            placeholder={t('Buscar por lançamento, descrição, conta, valor ou vínculo', 'Search by entry, description, account, amount or link')}
            aria-label={t('Buscar no razão', 'Search the ledger')}
          />
        </div>
        {totals.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2 text-xs">
            {totals.map(([c, s]) => (
              <li key={c} className="num rounded-full border border-line px-3 py-1">
                {c}: {t('débitos', 'debits')} {formatCurrency(Number(formatDecimal(s.d, c)), c)} · {t('créditos', 'credits')} {formatCurrency(Number(formatDecimal(s.c, c)), c)}
              </li>
            ))}
          </ul>
        ) : null}
      </TCard>

      <TCard className="overflow-hidden">
        {unassignedCount > 0 ? (
          <p className="flex items-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2 text-xs text-warn">
            <AlertTriangle size={14} />
            {t(`${unassignedCount} lançamento(s) sem ambiente definido ficam fora desta visão.`, `${unassignedCount} entry(ies) without a defined environment are excluded from this view.`)}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <Empty
            icon={<BookText size={22} />}
            title={scopedJournal.length === 0 ? t('Nenhum lançamento no razão ainda', 'No ledger entries yet') : t('Nenhuma linha com estes filtros', 'No lines match these filters')}
            text={scopedJournal.length === 0 ? t('Crie um lançamento no Livro-Caixa ou ligue um lançamento automático na aba Conciliação.', 'Create a Cash Book entry or turn on automatic posting in the Reconciliation tab.') : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-subtle">
                    <th className="px-3 py-2 font-medium">{t('Data', 'Date')}</th>
                    <th className="px-3 py-2 font-medium">{t('Lançamento', 'Entry')}</th>
                    <th className="px-3 py-2 font-medium">{t('Origem', 'Source')}</th>
                    <th className="px-3 py-2 font-medium">{t('Descrição', 'Description')}</th>
                    <th className="px-3 py-2 font-medium">{t('Conta', 'Account')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('Débito', 'Debit')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('Crédito', 'Credit')}</th>
                    {reporting ? <th className="px-3 py-2 text-right font-medium">{t('Em', 'In')} {reporting}</th> : null}
                    <th className="px-3 py-2 font-medium">{t('Moeda', 'Cur.')}</th>
                    <th className="px-3 py-2 font-medium">{t('Situação', 'Status')}</th>
                    <th className="px-3 py-2 font-medium">{t('Transação', 'Transaction')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((r) => (
                    <tr key={r.key} onClick={() => setOpenEntry(r.entryId)} className="cursor-pointer hover:bg-fill/5">
                      <td className="num whitespace-nowrap px-3 py-2">{fmtDate(r.date)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpenEntry(r.entryId) }} className="num rounded text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{r.entryId}</button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{r.module === 'unknown' ? '—' : SOURCE_LABELS[r.module]()}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-muted" title={r.memo}>{r.memo}</td>
                      <td className="min-w-[180px] px-3 py-2"><span className="num text-subtle">{r.accountCode}</span> {r.accountName[lang]}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-ok">{amountText(r.debit, r.currency)}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-bad">{amountText(r.credit, r.currency)}</td>
                      {reporting ? <td className="num whitespace-nowrap px-3 py-2 text-right">{reportingCell(r)}</td> : null}
                      <td className="num whitespace-nowrap px-3 py-2">{r.currency}</td>
                      <td className="whitespace-nowrap px-3 py-2"><StatusBadge s={r.status} /></td>
                      <td className="num max-w-[160px] truncate px-3 py-2 text-xs text-subtle" title={r.related}>{r.related}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {shown.map((r) => (
                <li key={r.key}>
                  <button type="button" onClick={() => setOpenEntry(r.entryId)} className="block w-full px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-sm text-accent">{r.entryId}</span>
                      <StatusBadge s={r.status} />
                    </div>
                    <div className="mt-0.5 truncate text-sm text-muted">{r.memo}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-sm">
                      <span><span className="num text-subtle">{r.accountCode}</span> {r.accountName[lang]}</span>
                      <span className={clsx('num font-medium', r.debit ? 'text-ok' : 'text-bad')}>{r.debit ? `D ${amountText(r.debit, r.currency)}` : `C ${amountText(r.credit, r.currency)}`}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-subtle">{fmtDate(r.date)} · {r.module === 'unknown' ? '—' : SOURCE_LABELS[r.module]()} · {r.related}</div>
                    {reporting ? <div className="num mt-0.5 text-xs text-muted">{t('Em', 'In')} {reporting}: {reportingCell(r)}</div> : null}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
              <span className="num text-muted">
                {cur * PAGE + 1}–{Math.min(rows.length, cur * PAGE + PAGE)} {t('de', 'of')} {rows.length}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0} aria-label={t('Página anterior', 'Previous page')}>
                  <ChevronLeft size={16} />
                </Button>
                <span className="num text-muted">{cur + 1}/{pages}</span>
                <Button variant="ghost" onClick={() => setPage(Math.min(pages - 1, cur + 1))} disabled={cur >= pages - 1} aria-label={t('Próxima página', 'Next page')}>
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          </>
        )}
      </TCard>

      <EntryDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
      <FxModal open={fxOpen} onClose={() => setFxOpen(false)} />
    </div>
  )
}
