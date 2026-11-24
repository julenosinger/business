import { useMemo, useState } from 'react'
import { CalendarClock, Lock, LockOpen, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty, Field, Modal, TableWrap, inputCls, td, th } from '@/components/ui'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { explainLedger } from './messages'
import { useStore } from '@/lib/store'
import { useNetwork } from '@/lib/network'
import { periodKeyOf, periodStatusOf } from '@/lib/accounting/engine'
import type { PeriodStatus } from '@/lib/accounting/types'
import { monthKey, monthTitle, today } from '@/lib/format'
import { t } from '@/lib/i18n'

const STATUS_META: Record<PeriodStatus, { label: () => string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  open: { label: () => t('Aberto', 'Open'), tone: 'ok' },
  review: { label: () => t('Revisão de fechamento', 'Closing review'), tone: 'warn' },
  closed: { label: () => t('Fechado', 'Closed'), tone: 'bad' },
}

function ReopenModal({ period, onClose }: { period: string | null; onClose: () => void }) {
  const { reopenAccountingPeriod } = useStore()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const submit = () => {
    if (!period) return
    const r = reopenAccountingPeriod(period, reason.trim())
    if (!r.ok) {
      setError(explainLedger(r.errors))
      return
    }
    toast.success(t('Período reaberto para ajuste. A reabertura fica registrada na auditoria.', 'Period reopened for adjustment. The reopening is recorded in the audit trail.'))
    setReason('')
    setError('')
    onClose()
  }
  return (
    <Modal open={period !== null} onClose={onClose} title={t('Reabrir período', 'Reopen period')}>
      <p className="text-sm text-muted text-pretty">
        {t('Reabrir um período fechado é uma ação excepcional, usada para ajustes. O motivo fica registrado na trilha de auditoria.', 'Reopening a closed period is an exceptional action used for adjustments. The reason is recorded in the audit trail.')}
      </p>
      <div className="mt-3">
        <Field label={t('Motivo da reabertura', 'Reopen reason')}>
          <textarea className={`${inputCls} min-h-20 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-bad">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t('Cancelar', 'Cancel')}</Button>
        <Button disabled={reason.trim().length < 3} onClick={submit}>{t('Reabrir', 'Reopen')}</Button>
      </div>
    </Modal>
  )
}

export function PeriodsTab() {
  const { data, closeAccountingPeriod, setAccountingPeriodReview } = useStore()
  const network = useNetwork()
  const [reopen, setReopen] = useState<string | null>(null)

  const months = useMemo(() => {
    const keys = new Set<string>()
    const add = (date?: string) => {
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) keys.add(periodKeyOf(date))
    }
    const env = <T extends { environment?: string }>(list: T[]): T[] => list.filter((x) => x.environment === network)
    for (const j of env(data.ledger.journal)) add(j.accountingDate)
    for (const e of env(data.ledger.events)) add(e.accountingDate)
    for (const p of data.ledger.periods.filter((x) => x.environment === network)) keys.add(p.key)
    for (const e of env(data.entries)) add(e.date)
    for (const s of env(data.sales)) add(s.date)
    for (const p of env(data.purchases)) add(p.date)
    for (const a of env(data.accounts)) {
      add(a.dueDate)
      add(a.paidAt)
    }
    return [...keys].sort().reverse()
  }, [data, network])

  const postingsIn = (key: string): number => data.ledger.journal.filter((j) => j.environment === network && periodKeyOf(j.accountingDate) === key).length

  const doClose = (key: string) => {
    const r = closeAccountingPeriod(key)
    if (!r.ok) toast.error(explainLedger(r.errors))
    else toast.success(t(`Período ${monthTitle(key)} fechado. Lançamentos e estornos neste mês estão bloqueados.`, `Period ${monthTitle(key)} closed. Postings and reversals in this month are now blocked.`))
  }
  const doReview = (key: string) => {
    const r = setAccountingPeriodReview(key)
    if (!r.ok) toast.error(explainLedger(r.errors))
    else toast.success(t(`Período ${monthTitle(key)} marcado para revisão de fechamento.`, `Period ${monthTitle(key)} marked for closing review.`))
  }

  const currentMonth = monthKey(today())

  return (
    <TCard className="overflow-hidden">
      <div className="border-b border-line p-4 sm:p-5">
        <PanelTitle
          icon={<CalendarClock size={18} />}
          title={t('Períodos contábeis', 'Accounting periods')}
          subtitle={t('Feche um mês para bloquear novos lançamentos e estornos nele. Fechamento é sempre uma decisão sua, nunca automática.', 'Close a month to block new postings and reversals in it. Closing is always your decision, never automatic.')}
        />
      </div>
      {months.length === 0 ? (
        <Empty icon={<CalendarClock size={22} />} title={t('Nenhum período ainda', 'No periods yet')} text={t('Os meses aparecem aqui conforme você lança vendas, compras e movimentos.', 'Months appear here as you record sales, purchases and movements.')} />
      ) : (
        <>
          <div className="hidden md:block">
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>{t('Mês', 'Month')}</th>
                  <th className={th}>{t('Lançamentos', 'Postings')}</th>
                  <th className={th}>{t('Situação', 'Status')}</th>
                  <th className={`${th} text-right`}>{t('Ações', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {months.map((key) => {
                  const status = periodStatusOf(data.ledger, key, network)
                  const meta = STATUS_META[status]
                  return (
                    <tr key={key} className="transition hover:bg-fill/5">
                      <td className={`${td} font-medium`}>
                        {monthTitle(key)}
                        {key === currentMonth ? <span className="ml-2 text-xs text-subtle">{t('(atual)', '(current)')}</span> : null}
                      </td>
                      <td className={`${td} num`}>{postingsIn(key)}</td>
                      <td className={td}><Badge tone={meta.tone}>{meta.label()}</Badge></td>
                      <td className={`${td} text-right`}>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {status === 'open' ? (
                            <Button small variant="ghost" onClick={() => doReview(key)}><ShieldCheck size={14} /> {t('Revisão', 'Review')}</Button>
                          ) : null}
                          {status !== 'closed' ? (
                            <Button small variant="subtle" onClick={() => doClose(key)}><Lock size={14} /> {t('Fechar', 'Close')}</Button>
                          ) : (
                            <Button small variant="ghost" onClick={() => setReopen(key)}><LockOpen size={14} /> {t('Reabrir', 'Reopen')}</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </TableWrap>
          </div>

          <ul className="divide-y divide-line md:hidden">
            {months.map((key) => {
              const status = periodStatusOf(data.ledger, key, network)
              const meta = STATUS_META[status]
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {monthTitle(key)} {key === currentMonth ? <span className="text-xs text-subtle">{t('(atual)', '(current)')}</span> : null}
                    </div>
                    <div className="mt-1"><Badge tone={meta.tone}>{meta.label()}</Badge> <span className="num text-xs text-subtle">· {postingsIn(key)} {t('lançamentos', 'postings')}</span></div>
                  </div>
                  <div className="flex gap-1.5">
                    {status === 'open' ? <Button small variant="ghost" onClick={() => doReview(key)}><ShieldCheck size={14} /> {t('Revisão', 'Review')}</Button> : null}
                    {status !== 'closed' ? <Button small variant="subtle" onClick={() => doClose(key)}><Lock size={14} /> {t('Fechar', 'Close')}</Button> : <Button small variant="ghost" onClick={() => setReopen(key)}><LockOpen size={14} /> {t('Reabrir', 'Reopen')}</Button>}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <ReopenModal period={reopen} onClose={() => setReopen(null)} />
    </TCard>
  )
}
