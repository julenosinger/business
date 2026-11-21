import { Download, Receipt } from 'lucide-react'
import { Badge, Button, Empty } from '@/components/ui'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { freightReport } from '@/lib/freight'
import { downloadCsv, fmtDate } from '@/lib/format'
import { t } from '@/lib/i18n'
import { isFreightPosted } from '@/lib/logistics'
import type { Shipment } from '@/lib/types'
import { useStore } from '@/lib/store'
import { formatAmount } from './labels'

/** Relatório de custos de frete do período: por remessa, por transportadora e estimado contra real. Moedas nunca são misturadas. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function FreightReport({ shipments, from, periodText, onOpen }: { shipments: Shipment[]; from: string; periodText: string; onOpen: (id: string) => void }) {
  const { data } = useStore()
  const rep = freightReport(shipments, from)
  const currencies = Object.keys(rep.totals)

  const exportCsv = () =>
    downloadCsv('logistics-costs.csv', [
      [t('Remessa', 'Shipment'), t('Transportadora', 'Carrier'), t('Moeda', 'Currency'), t('Frete', 'Freight'), t('Seguro', 'Insurance'), t('Taxas', 'Fees'), t('Total', 'Total'), t('Estimado', 'Estimated'), t('Variação', 'Variance'), t('Criada em', 'Created')],
      ...rep.rows.map(({ shipment: s, total, variance }) => [s.id, s.carrier, s.currency, s.freightCost, s.freight?.insurance ?? 0, (s.freight?.fees ?? []).reduce((x, f) => x + f.amount, 0), total, s.freight?.estimated ?? '', variance ?? '', s.createdAt.slice(0, 10)]),
    ])

  if (rep.rows.length === 0)
    return (
      <TCard className="p-4">
        <Empty icon={<Receipt size={22} />} title={t('Nenhum custo de frete registrado', 'No freight costs recorded')} text={`${t('Remessas criadas', 'Shipments created')} ${periodText} ${t('com frete, seguro ou taxas aparecem aqui.', 'with freight, insurance or fees appear here.')}`} />
      </TCard>
    )

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {currencies.map((cur) => {
          const x = rep.totals[cur]
          if (!x) return null
          const variance = x.withEstimate ? x.totalWithEstimate - x.estimated : null
          return (
            <TCard key={cur} className="p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-subtle">{t('Custo total', 'Total cost')} · {cur}</p>
              <p className="display num mt-1 text-2xl font-semibold">{formatAmount(x.total, cur)}</p>
              <p className="mt-1 text-xs text-muted">
                {count(rep.rows.filter((r) => r.shipment.currency === cur).length, t('remessa', 'shipment'), t('remessas', 'shipments'))} · {periodText}
              </p>
              {x.withEstimate ? (
                <p className="mt-1 text-xs text-muted">
                  {t('Estimado', 'Estimated')} {formatAmount(x.estimated, cur)} ({x.withEstimate} {t('com estimativa', 'with estimate')})
                  {variance !== null ? ` · ${t('diferença', 'difference')} ${variance > 0 ? '+' : ''}${formatAmount(variance, cur)}` : ''}
                </p>
              ) : (
                <p className="mt-1 text-xs text-subtle">{t('Nenhuma estimativa informada.', 'No estimates entered.')}</p>
              )}
            </TCard>
          )
        })}
      </div>

      <TCard className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:px-5">
          <PanelTitle icon={<Receipt size={18} />} title={t('Custo por transportadora', 'Cost per carrier')} subtitle={periodText} />
          <Button small variant="ghost" onClick={exportCsv}>
            <Download size={14} /> CSV
          </Button>
        </div>
        <ul className="divide-y divide-line">
          {rep.byCarrier.map((c) => (
            <li key={`${c.carrier}|${c.currency}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm sm:px-5">
              <span className="min-w-0 font-medium">{c.carrier || t('Sem transportadora', 'No carrier')}</span>
              <span className="num text-muted">
                {count(c.count, t('remessa', 'shipment'), t('remessas', 'shipments'))} · {t('média', 'avg')} {formatAmount(c.average, c.currency)} · <b className="text-ink">{formatAmount(c.total, c.currency)}</b>
              </span>
            </li>
          ))}
        </ul>
      </TCard>

      <TCard className="overflow-hidden">
        <div className="border-b border-line p-4 sm:px-5">
          <PanelTitle icon={<Receipt size={18} />} title={t('Custo por remessa', 'Cost per shipment')} subtitle={count(rep.rows.length, t('remessa', 'shipment'), t('remessas', 'shipments'))} />
        </div>
        <ul className="divide-y divide-line">
          {rep.rows.map(({ shipment: s, total, variance }) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm sm:px-5">
              <span className="min-w-0">
                <button type="button" className="mono font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => onOpen(s.id)}>
                  {s.id}
                </button>{' '}
                <span className="text-muted">{s.carrier || '—'}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {variance !== null ? <span className={`num text-xs ${variance > 0 ? 'text-bad' : 'text-ok'}`}>{variance > 0 ? '+' : ''}{formatAmount(variance, s.currency)} {t('vs. estimado', 'vs. estimate')}</span> : null}
                {isFreightPosted(data, s) ? <Badge tone="ok">{t('Lançado', 'Posted')}</Badge> : <Badge tone="neutral">{t('Não lançado', 'Not posted')}</Badge>}
                <span className="num font-semibold">{formatAmount(total, s.currency)}</span>
                <span className="text-xs text-subtle">{fmtDate(s.createdAt.slice(0, 10))}</span>
              </span>
            </li>
          ))}
        </ul>
      </TCard>
    </div>
  )
}
