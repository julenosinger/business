import { useState } from 'react'
import { BarChart3, Wallet } from 'lucide-react'
import { clsx } from 'clsx'
import { Hint } from '@/components/ui'
import { C } from '@/components/charts'
import { usdcFmt } from '@/lib/format'
import { locale, t } from '@/lib/i18n'
import type { PaymentRequest, TreasuryOp } from '@/lib/types'
import { DAY_MS, PERIODS, inLastDays, sameAddress, type Period } from './shared'
import { PanelTitle, TCard } from '@/components/ds/Panel'

interface Props {
  ops: TreasuryOp[]
  requests: PaymentRequest[]
  own?: string
  period: Period
  onPeriod: (p: Period) => void
}

interface Bucket {
  start: number
  inflow: number
  outflow: number
}

export function Analytics({ ops, requests, own, period, onPeriod }: Props) {
  const [now] = useState(() => Date.now())
  // Entradas: cobranças em USDC já recebidas. Saídas: envios para outras carteiras.
  // Depósitos e transferências para a própria carteira são movimentos internos e não entram.
  const received = requests.filter((r) => r.status === 'paid' && r.paidAt && inLastDays(r.paidAt, period, now))
  const sent = ops.filter((o) => o.kind === 'spend' && !sameAddress(o.recipient, own) && inLastDays(o.date, period, now))
  const inflow = received.reduce((s, r) => s + Number(r.amount), 0)
  const outflow = sent.reduce((s, o) => s + Number(o.amount), 0)

  const count = period === 7 ? 7 : period === 30 ? 15 : 13
  const size = (period * DAY_MS) / count
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({ start: now - (count - i) * size, inflow: 0, outflow: 0 }))
  const place = (iso: string, key: 'inflow' | 'outflow', value: number) => {
    const age = now - new Date(iso).getTime()
    const idx = count - 1 - Math.min(count - 1, Math.floor(age / size))
    const b = buckets[idx]
    if (b) b[key] += value
  }
  received.forEach((r) => place(r.paidAt ?? '', 'inflow', Number(r.amount)))
  sent.forEach((o) => place(o.date, 'outflow', Number(o.amount)))

  const peak = Math.max(0, ...buckets.flatMap((b) => [b.inflow, b.outflow]))
  const hasData = received.length + sent.length > 0
  const W = 560
  const H = 150
  const padB = 20
  const slot = W / count
  const barW = Math.max(3, Math.min(14, slot / 2.6))
  const y = (v: number) => (peak > 0 ? ((H - padB - 6) * v) / peak : 0)
  const dateLabel = (ts: number) => new Date(ts).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })

  return (
    <TCard className="flex h-full flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PanelTitle
          icon={<BarChart3 size={18} />}
          title={t('Movimentação de USDC', 'USDC movement')}
          subtitle={t('Entradas e saídas na tesouraria', 'Inflows and outflows in the treasury')}
        />
        <div className="flex items-center gap-2">
          <Hint
            text={t(
              'Entradas: cobranças em USDC recebidas. Saídas: envios para outras carteiras. Depósitos e transferências para a sua própria carteira não contam como entrada nem saída.',
              'Inflows: USDC payment requests received. Outflows: transfers to other wallets. Deposits and transfers to your own wallet count as neither.',
            )}
          />
        <div className="inline-flex gap-1.5" role="group" aria-label={t('Período', 'Period')}>
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => onPeriod(p)}
              aria-pressed={period === p}
              className={clsx('min-h-8 rounded-full border px-3.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60', period === p ? 'border-violet/70 bg-violet/25 text-ink' : 'border-line text-muted hover:text-ink')}
            >
              {t(`${p} dias`, `${p}d`)}
            </button>
          ))}
        </div>
        </div>
      </div>

      {!hasData ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-8 text-center">
          <Wallet size={34} className="mb-1 text-subtle" strokeWidth={1.4} />
          <p className="text-sm font-semibold">{t('Sem movimentações no período', 'No movements in this period')}</p>
          <p className="text-xs text-subtle">{t('As operações realizadas aparecerão aqui.', 'Completed operations will appear here.')}</p>
        </div>
      ) : (
        <>
          <dl className="mb-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="label flex items-center gap-1.5">
                <i className="size-2 rounded-full bg-ok" /> {t('Recebido', 'Received')}
              </dt>
              <dd className="num mt-0.5 font-semibold text-ok">{usdcFmt(inflow)}</dd>
            </div>
            <div>
              <dt className="label flex items-center gap-1.5">
                <i className="size-2 rounded-full bg-bad" /> {t('Enviado', 'Sent')}
              </dt>
              <dd className="num mt-0.5 font-semibold text-bad">{usdcFmt(outflow)}</dd>
            </div>
            <div>
              <dt className="label">{t('Operações', 'Operations')}</dt>
              <dd className="num mt-0.5 font-semibold">{received.length + sent.length}</dd>
            </div>
          </dl>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('Entradas e saídas de USDC no período', 'USDC inflows and outflows in the period')}>
            <line x1="0" x2={W} y1={H - padB} y2={H - padB} style={{ stroke: C.grid }} />
            {buckets.map((b, i) => {
              const cx = i * slot + slot / 2
              return (
                <g key={i}>
                  <title>
                    {`${dateLabel(b.start)}: ${t('recebido', 'received')} ${usdcFmt(b.inflow)} · ${t('enviado', 'sent')} ${usdcFmt(b.outflow)} USDC`}
                  </title>
                  <rect x={cx - barW - 1} y={H - padB - y(b.inflow)} width={barW} height={y(b.inflow)} rx="2" style={{ fill: C.ok }} />
                  <rect x={cx + 1} y={H - padB - y(b.outflow)} width={barW} height={y(b.outflow)} rx="2" style={{ fill: C.bad }} />
                </g>
              )
            })}
            <text x="0" y={H - 5} fontSize="10" style={{ fill: C.text }}>
              {dateLabel(now - period * DAY_MS)}
            </text>
            <text x={W} y={H - 5} fontSize="10" textAnchor="end" style={{ fill: C.text }}>
              {dateLabel(now)}
            </text>
          </svg>
        </>
      )}
    </TCard>
  )
}
