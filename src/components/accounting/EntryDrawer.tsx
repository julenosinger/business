import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Badge } from '@/components/ui'
import { useStore } from '@/lib/store'
import { entryDetail } from '@/lib/accounting/gl'
import { formatDecimal } from '@/lib/accounting/money'
import { formatCurrency, fmtDate } from '@/lib/format'
import { t, getLang } from '@/lib/i18n'
import { SOURCE_LABELS, TYPE_LABELS } from './messages'
import type { CurrencyCode } from '@/lib/types'

const dec = (minor: string, currency: CurrencyCode): string => formatCurrency(Number(formatDecimal(BigInt(minor), currency)), currency)

/** Gaveta com o detalhe de um lançamento: linhas, origem, taxas, vínculos e histórico de auditoria. */
export function EntryDrawer({ entryId, onClose }: { entryId: string | null; onClose: () => void }) {
  const { data } = useStore()
  const ledger = data.ledger
  const detail = entryId ? entryDetail(ledger, entryId) : null
  const closeRef = useRef<HTMLButtonElement>(null)
  const lang = getLang()

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  const open = detail !== null
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [open])

  const name = (code: string): string => {
    const a = ledger.chart.find((c) => c.code === code)
    return a ? a.name[lang] : code
  }
  const statusBadge = detail
    ? detail.status === 'reversal'
      ? <Badge tone="neutral">{t('Estorno', 'Reversal')}</Badge>
      : detail.status === 'reversed'
        ? <Badge tone="warn">{t('Estornado', 'Reversed')}</Badge>
        : <Badge tone="ok">{t('Lançado', 'Posted')}</Badge>
    : null

  return (
    <AnimatePresence>
      {detail ? (
        <motion.div className="!mt-0 fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" aria-label={t('Fechar', 'Close')} tabIndex={-1} className="absolute inset-0 bg-black/60" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={t(`Lançamento ${detail.entry.id}`, `Journal entry ${detail.entry.id}`)}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.2 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-panel p-4 sm:p-5"
          >
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="display num text-lg font-semibold">{detail.entry.id}</h2>
                  {statusBadge}
                </div>
                <p className="mt-1 text-sm text-muted text-pretty">{detail.entry.memo}</p>
              </div>
              <button ref={closeRef} type="button" onClick={onClose} aria-label={t('Fechar', 'Close')} className="rounded-lg p-2 text-muted hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                <X size={18} />
              </button>
            </header>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-subtle">{t('Data contábil', 'Accounting date')}</dt>
                <dd className="num">{fmtDate(detail.entry.accountingDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">{t('Moeda', 'Currency')}</dt>
                <dd className="num">{detail.entry.currency}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">{t('Origem', 'Source')}</dt>
                <dd>{detail.event ? SOURCE_LABELS[detail.event.source.module]() : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">{t('Tipo do evento', 'Event type')}</dt>
                <dd>{detail.event ? TYPE_LABELS[detail.event.type]() : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">{t('Lançado por', 'Posted by')}</dt>
                <dd>{detail.entry.postedBy.id} <span className="text-xs text-subtle">({detail.entry.postedBy.kind})</span></dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">{t('Chave de idempotência', 'Idempotency key')}</dt>
                <dd className="num break-all text-xs">{detail.entry.idempotencyKey}</dd>
              </div>
            </dl>

            <h3 className="mt-5 text-sm font-semibold">{t('Linhas do lançamento', 'Entry lines')}</h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-subtle">
                  <th className="py-1 pr-2 font-medium">{t('Conta', 'Account')}</th>
                  <th className="py-1 pr-2 text-right font-medium">{t('Débito', 'Debit')}</th>
                  <th className="py-1 text-right font-medium">{t('Crédito', 'Credit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {detail.entry.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-2"><span className="num text-subtle">{l.accountCode}</span> {name(l.accountCode)}</td>
                    <td className="num py-1.5 pr-2 text-right">{l.side === 'debit' ? dec(l.amountMinor, detail.entry.currency) : ''}</td>
                    <td className="num py-1.5 text-right">{l.side === 'credit' ? dec(l.amountMinor, detail.entry.currency) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="mt-5 text-sm font-semibold">{t('Operação de origem e vínculos', 'Source operation and links')}</h3>
            {Object.keys(detail.entry.links).length === 0 ? (
              <p className="mt-1 text-sm text-subtle">—</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(detail.entry.links).map(([k, v]) => (
                  <li key={k} className="flex flex-wrap gap-x-2">
                    <span className="text-subtle">{k}</span>
                    <span className="num break-all">{v}</span>
                  </li>
                ))}
              </ul>
            )}
            {detail.original ? (
              <p className="mt-2 text-sm text-muted">{t(`Estorna ${detail.original.id}. Motivo: ${detail.entry.reason ?? ''}`, `Reverses ${detail.original.id}. Reason: ${detail.entry.reason ?? ''}`)}</p>
            ) : null}
            {detail.reversedBy ? (
              <p className="mt-2 text-sm text-muted">{t(`Estornado por ${detail.reversedBy.id}. Motivo: ${detail.reversedBy.reason ?? ''}`, `Reversed by ${detail.reversedBy.id}. Reason: ${detail.reversedBy.reason ?? ''}`)}</p>
            ) : null}

            <h3 className="mt-5 text-sm font-semibold">{t('Taxas relacionadas', 'Related fees')}</h3>
            {detail.fees.length === 0 ? (
              <p className="mt-1 text-sm text-subtle">{t('Nenhuma taxa vinculada.', 'No linked fees.')}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {detail.fees.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{f.kind} <Badge tone={f.status === 'confirmed' ? 'ok' : 'warn'}>{f.status === 'confirmed' ? t('confirmada', 'confirmed') : t('estimada', 'estimated')}</Badge></span>
                    <span className="num">{dec(f.amountMinor, f.currency)}</span>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mt-5 text-sm font-semibold">{t('Histórico de auditoria', 'Audit history')}</h3>
            {detail.audit.length === 0 ? (
              <p className="mt-1 text-sm text-subtle">—</p>
            ) : (
              <ol className="mt-2 space-y-2 border-l border-line pl-3 text-sm">
                {detail.audit.map((a) => (
                  <li key={a.id}>
                    <div className="num text-xs text-subtle">{a.at.replace('T', ' ').slice(0, 16)} · {a.actor.id} ({a.actor.kind})</div>
                    <div>{a.action} <span className="text-muted">{a.detail}</span></div>
                  </li>
                ))}
              </ol>
            )}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
