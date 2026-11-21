import { useCallback, useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Gauge, LineChart, ListChecks, PackageCheck, PackagePlus, PieChart, Plus, RefreshCw, Search, Truck, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty, inputCls } from '@/components/ui'
import { Bar, C, Donut } from '@/components/charts'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { CountBars } from '@/components/logistics/CountBars'
import { ShipmentDrawer } from '@/components/logistics/ShipmentDrawer'
import { ShipmentForm } from '@/components/logistics/ShipmentForm'
import { DirectionBadge, StatusBadge, dateTimeText, eventDetail, eventTitle, formatAmount, routeText, statusColor, statusLabel } from '@/components/logistics/labels'
import { useStore } from '@/lib/store'
import { ALL_STATUSES, DIRECTIONS, MOVING_STATUSES, alerts, eventFeed, isOverdue, kpis, statusCounts, upcoming, type AlertReason } from '@/lib/logistics'
import { addDays, fmtDate, num, today } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Shipment, ShipmentDirection, ShipmentStatus } from '@/lib/types'

type PeriodId = '7' | '30' | '90' | 'all'

const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

const alertText = (r: AlertReason): string =>
  ({
    exception: t('Exceção em andamento', 'Exception in progress'),
    delayed: t('Remessa atrasada', 'Delayed shipment'),
    overdue: t('Previsão de entrega vencida', 'Estimated delivery date passed'),
    no_tracking: t('Despachada sem código de rastreio', 'Dispatched without a tracking number'),
  })[r]

export function Logistics() {
  const { data } = useStore()
  const [period, setPeriod] = useState<PeriodId>('30')
  const [, refresh] = useState(0)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | 'all'>('all')
  const [dirFilter, setDirFilter] = useState<ShipmentDirection | 'all'>('all')
  const [limit, setLimit] = useState(15)
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState<Shipment | 'new' | null>(null)

  const shipments = data.shipments
  const todayStr = today()
  const days = period === 'all' ? 90 : Number(period)
  const from = period === 'all' ? '' : addDays(todayStr, -days)
  const k = kpis(shipments, { from }, todayStr)
  const counts = statusCounts(shipments)
  const feed = eventFeed(shipments, 8)
  const next = upcoming(shipments, 5)
  const alertList = alerts(shipments, todayStr)
  const drafts = counts.draft
  const openShipment = shipments.find((s) => s.id === openId) ?? null

  // Série para o gráfico: remessas criadas e entregues por intervalo.
  const buckets = days === 7 ? 7 : days === 30 ? 10 : 13
  const size = days / buckets
  const slot = (date: string): number => {
    const age = dayDiff(date, todayStr)
    return age < 0 || age >= days ? -1 : buckets - 1 - Math.floor(age / size)
  }
  const created = Array.from({ length: buckets }, () => 0)
  const delivered = Array.from({ length: buckets }, () => 0)
  for (const s of shipments) {
    const c = slot(s.createdAt.slice(0, 10))
    if (c >= 0) created[c] = (created[c] ?? 0) + 1
    const d = s.deliveredAt ? slot(s.deliveredAt) : -1
    if (d >= 0) delivered[d] = (delivered[d] ?? 0) + 1
  }
  const labels = Array.from({ length: buckets }, (_, i) => fmtDate(addDays(todayStr, -Math.round((buckets - 1 - i) * size))).slice(0, 5))
  const chartEmpty = created.every((n) => n === 0) && delivered.every((n) => n === 0)

  const movingList = shipments.filter((s) => MOVING_STATUSES.includes(s.status))
  const trackedMoving = movingList.filter((s) => s.trackingNumber).length

  const freightCurrency = k.freightByCurrency[data.settings.currency] !== undefined ? data.settings.currency : Object.keys(k.freightByCurrency)[0]
  const otherFreight = Object.entries(k.freightByCurrency).filter(([c]) => c !== freightCurrency)

  const needle = q.trim().toLowerCase()
  const list = shipments.filter(
    (s) =>
      (statusFilter === 'all' || s.status === statusFilter) &&
      (dirFilter === 'all' || s.direction === dirFilter) &&
      (!needle || [s.id, s.trackingNumber, s.recipientName, s.carrier, s.destination.city, s.origin.city].some((v) => v.toLowerCase().includes(needle))),
  )
  const shown = list.slice(0, limit)

  const onClose = useCallback(() => setOpenId(null), [])
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  const openRow = (s: Shipment) => (
    <button type="button" onClick={() => setOpenId(s.id)} className="mono text-left text-sm font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
      {s.id}
    </button>
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title={t('Logística Global', 'Global Logistics')}
        subtitle={t('Remessas, rastreamento e entregas em um só lugar. Os eventos de rastreio são informados manualmente.', 'Shipments, tracking and deliveries in one place. Tracking events are entered manually.')}
        actions={
          <>
            <PillTabs
              label={t('Período', 'Period')}
              value={period}
              onChange={(p) => {
                setPeriod(p)
              }}
              items={[
                { id: '7', label: t('7 dias', '7 days') },
                { id: '30', label: t('30 dias', '30 days') },
                { id: '90', label: t('90 dias', '90 days') },
                { id: 'all', label: t('Tudo', 'All') },
              ]}
            />
            <Button
              variant="ghost"
              onClick={() => {
                refresh((n) => n + 1)
                toast.success(t('Indicadores recalculados.', 'Indicators recalculated.'))
              }}
            >
              <RefreshCw size={16} /> {t('Atualizar', 'Refresh')}
            </Button>
            <Button onClick={() => setForm('new')}>
              <Plus size={16} /> {t('Nova remessa', 'New shipment')}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiTile tone="sky" icon={<PackageCheck size={20} />} label={t('Remessas ativas', 'Active shipments')} value={String(k.active)} sub={count(drafts, t('rascunho', 'draft'), t('rascunhos', 'drafts'))} />
        <KpiTile tone="violet" icon={<Truck size={20} />} label={t('Em trânsito', 'In transit')} value={String(k.moving)} sub={t('despachadas ou a caminho', 'dispatched or on the way')} />
        <KpiTile tone="ok" icon={<CheckCircle2 size={20} />} label={t('Entregues', 'Delivered')} value={String(k.delivered)} sub={period === 'all' ? t('em todo o histórico', 'all time') : t(`nos últimos ${days} dias`, `in the last ${days} days`)} />
        <KpiTile tone="bad" icon={<AlertTriangle size={20} />} label={t('Atrasos e exceções', 'Delays and exceptions')} value={String(k.problems)} valueTone={k.problems ? 'bad' : undefined} sub={k.problems ? t('precisam de atenção', 'need attention') : t('Nada pendente', 'Nothing pending')} />
        <KpiTile
          tone="warn"
          icon={<Wallet size={20} />}
          label={t('Custo de frete', 'Freight costs')}
          value={freightCurrency ? formatAmount(k.freightByCurrency[freightCurrency] ?? 0, freightCurrency) : '—'}
          sub={otherFreight.length ? otherFreight.map(([c, v]) => formatAmount(v, c)).join(' · ') : freightCurrency ? t('remessas criadas no período', 'shipments created in the period') : t('Sem frete registrado', 'No freight recorded')}
        />
        <KpiTile
          tone="ok"
          icon={<Gauge size={20} />}
          label={t('Entregas no prazo', 'On-time delivery')}
          value={k.onTimeRate === null ? '—' : `${num(k.onTimeRate)}%`}
          sub={k.onTimeRate === null ? t('Sem entregas com data prevista', 'No deliveries with an estimated date') : count(k.onTimeSample, t('entrega avaliada', 'delivery measured'), t('entregas avaliadas', 'deliveries measured'))}
        />
      </div>

      {shipments.length === 0 ? (
        <TCard className="p-4 sm:p-5">
          <Empty
            icon={<PackagePlus size={22} />}
            title={t('Nenhuma remessa ainda', 'No shipments yet')}
            text={t('Crie a primeira remessa para acompanhar envios, entregas e atrasos. Você também pode carregar os dados de demonstração em Configurações.', 'Create your first shipment to track deliveries and delays. You can also load the demo data in Settings.')}
            action={
              <Button onClick={() => setForm('new')}>
                <Plus size={16} /> {t('Nova remessa', 'New shipment')}
              </Button>
            }
          />
        </TCard>
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="space-y-4 sm:space-y-5">
              <TCard className="p-4 sm:p-5">
                <PanelTitle
                  icon={<LineChart size={18} />}
                  title={t('Visão das remessas', 'Shipment overview')}
                  subtitle={t('Criadas e entregues no período', 'Created and delivered in the period')}
                  action={
                    <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
                      <span className="flex items-center gap-1.5">
                        <i className="size-2 rounded-full" style={{ background: C.accent }} /> {t('Criadas', 'Created')}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <i className="size-2 rounded-full" style={{ background: C.ok }} /> {t('Entregues', 'Delivered')}
                      </span>
                    </span>
                  }
                />
                <div className="mt-3">
                  {chartEmpty ? <p className="py-10 text-center text-sm text-subtle">{t('Sem movimentação no período.', 'No activity in this period.')}</p> : <CountBars labels={labels} a={created} b={delivered} aLabel={t('Criadas', 'Created')} bLabel={t('Entregues', 'Delivered')} />}
                </div>
              </TCard>

              <TCard className="p-4 sm:p-5">
                <PanelTitle icon={<Clock size={18} />} title={t('Rastreamento e entregas', 'Tracking and deliveries')} subtitle={t('Últimos registros de todas as remessas', 'Latest records across all shipments')} />
                <ul className="mt-4 space-y-3">
                  {feed.map((f) => (
                    <li key={f.event.id} className="flex items-start gap-3">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-pretty">
                          {openRow(f.shipment)} <span className="text-muted">·</span> {eventTitle(f.event)}
                        </p>
                        {eventDetail(f.event) ? <p className="text-xs text-muted">{eventDetail(f.event)}</p> : null}
                        <p className="text-xs text-subtle">
                          {dateTimeText(f.when)} · {t('Manual', 'Manual')} · {f.event.actor}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </TCard>

              <TCard className="p-4 sm:p-5">
                <PanelTitle icon={<ListChecks size={18} />} title={t('Desempenho operacional', 'Operational performance')} subtitle={t('Calculado com as remessas registradas', 'Calculated from recorded shipments')} />
                <dl className="mt-4 space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <dt className="text-muted">{t('Entregas no prazo', 'On-time deliveries')}</dt>
                      <dd className="num font-semibold">{k.onTimeRate === null ? '—' : `${num(k.onTimeRate)}%`}</dd>
                    </div>
                    <Bar value={k.onTimeRate ?? 0} max={100} color={C.ok} />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <dt className="text-muted">{t('Em movimento com código de rastreio', 'In motion with a tracking number')}</dt>
                      <dd className="num font-semibold">{movingList.length ? `${trackedMoving}/${movingList.length}` : '—'}</dd>
                    </div>
                    <Bar value={trackedMoving} max={Math.max(movingList.length, 1)} color={C.accent} />
                  </div>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <dt className="text-muted">{t('Tempo médio entre despacho e entrega', 'Average time from dispatch to delivery')}</dt>
                    <dd className="num font-semibold">{k.avgTransitDays === null ? '—' : `${num(k.avgTransitDays)} ${t('dias', 'days')}`}</dd>
                  </div>
                </dl>
              </TCard>
            </div>

            <div className="space-y-4 sm:space-y-5">
              <TCard className="p-4 sm:p-5">
                <PanelTitle icon={<PieChart size={18} />} title={t('Distribuição por status', 'Status distribution')} subtitle={count(shipments.length, t('remessa registrada', 'recorded shipment'), t('remessas registradas', 'recorded shipments'))} />
                <div className="mt-4 flex flex-wrap items-center justify-center gap-5">
                  <Donut segments={ALL_STATUSES.filter((s) => counts[s] > 0).map((s) => ({ label: statusLabel(s), value: counts[s], color: statusColor(s) }))} size={140} thickness={20}>
                    <span className="text-[11px] text-subtle">Total</span>
                    <span className="display num text-lg font-semibold">{shipments.length}</span>
                  </Donut>
                  <ul className="min-w-[160px] flex-1 space-y-1 text-sm">
                    {ALL_STATUSES.filter((s) => counts[s] > 0).map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          onClick={() => {
                            setStatusFilter(s)
                            setLimit(15)
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1 text-left hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                          aria-label={`${t('Filtrar por', 'Filter by')} ${statusLabel(s)}`}
                        >
                          <span className="flex items-center gap-2 text-muted">
                            <i className="size-2 rounded-full" style={{ background: statusColor(s) }} /> {statusLabel(s)}
                          </span>
                          <span className="num font-semibold">{counts[s]}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </TCard>

              <TCard className="p-4 sm:p-5">
                <PanelTitle icon={<CalendarClock size={18} />} title={t('Próximas entregas', 'Upcoming deliveries')} subtitle={t('Por data prevista', 'By estimated date')} />
                {next.length === 0 ? (
                  <p className="mt-4 text-sm text-subtle">{t('Nenhuma entrega em andamento com data prevista.', 'No shipments in progress with an estimated date.')}</p>
                ) : (
                  <ul className="mt-3 divide-y divide-line">
                    {next.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          {openRow(s)}
                          <p className="truncate text-xs text-muted">
                            {s.recipientName} · {s.destination.city}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="num text-sm font-semibold">{fmtDate(s.estimatedDelivery ?? '')}</p>
                          {isOverdue(s, todayStr) ? <Badge tone="bad">{t('Vencida', 'Overdue')}</Badge> : <StatusBadge status={s.status} />}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TCard>

              <TCard tint={alertList.length ? 'warn' : undefined} className="p-4 sm:p-5">
                <PanelTitle icon={<AlertTriangle size={18} />} title={t('Alertas críticos', 'Critical alerts')} subtitle={alertList.length ? count(alertList.length, t('alerta', 'alert'), t('alertas', 'alerts')) : undefined} />
                {alertList.length === 0 ? (
                  <p className="mt-4 text-sm text-subtle">{t('Nenhum alerta. Atrasos, exceções e previsões vencidas aparecem aqui.', 'No alerts. Delays, exceptions and missed estimates show up here.')}</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {alertList.slice(0, 6).map((a) => (
                      <li key={`${a.shipment.id}-${a.reason}`} className="flex items-start gap-2.5 rounded-xl bg-fill/5 px-3 py-2">
                        <AlertTriangle size={15} className={a.reason === 'exception' ? 'mt-0.5 shrink-0 text-bad' : 'mt-0.5 shrink-0 text-warn'} />
                        <div className="min-w-0 text-sm">
                          {openRow(a.shipment)}
                          <p className="text-xs text-muted">{alertText(a.reason)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TCard>
            </div>
          </div>

          <TCard className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:px-5">
              <PanelTitle icon={<Truck size={18} />} title={t('Remessas', 'Shipments')} subtitle={count(list.length, t('remessa', 'shipment'), t('remessas', 'shipments'))} />
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-xl border border-line bg-fill/5 px-3 focus-within:ring-2 focus-within:ring-violet/50">
                  <Search size={15} className="text-subtle" />
                  <input
                    aria-label={t('Buscar remessas', 'Search shipments')}
                    placeholder={t('Código, rastreio, destinatário…', 'ID, tracking, recipient…')}
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value)
                      setLimit(15)
                    }}
                    className="min-h-10 w-44 bg-transparent text-sm outline-none placeholder:text-subtle"
                  />
                </label>
                <select
                  aria-label={t('Filtrar por status', 'Filter by status')}
                  className={`${inputCls} !min-h-10 !w-auto`}
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as ShipmentStatus | 'all')
                    setLimit(15)
                  }}
                >
                  <option value="all">{t('Todos os status', 'All statuses')}</option>
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('Filtrar por tipo', 'Filter by type')}
                  className={`${inputCls} !min-h-10 !w-auto`}
                  value={dirFilter}
                  onChange={(e) => {
                    setDirFilter(e.target.value as ShipmentDirection | 'all')
                    setLimit(15)
                  }}
                >
                  <option value="all">{t('Todos os tipos', 'All types')}</option>
                  {DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d === 'inbound' ? t('Entrada', 'Inbound') : d === 'outbound' ? t('Saída', 'Outbound') : t('Transferência', 'Transfer')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {list.length === 0 ? (
              <Empty icon={<Search size={22} />} title={t('Nada encontrado', 'Nothing found')} text={t('Ajuste a busca ou os filtros.', 'Adjust the search or filters.')} />
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] border-collapse [&_tbody_tr]:border-t [&_tbody_tr]:border-line">
                    <thead>
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-subtle">
                        <th className="px-4 py-2.5">{t('Código', 'ID')}</th>
                        <th className="px-3 py-2.5">{t('Rota', 'Route')}</th>
                        <th className="px-3 py-2.5">{t('Transportadora', 'Carrier')}</th>
                        <th className="px-3 py-2.5">{t('Previsão', 'ETA')}</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-right">{t('Frete', 'Freight')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((s) => (
                        <tr key={s.id} className="transition hover:bg-fill/5">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {openRow(s)}
                              <DirectionBadge direction={s.direction} />
                            </div>
                          </td>
                          <td className="max-w-[220px] px-3 py-3 text-sm">
                            <div className="truncate">{routeText(s)}</div>
                            <div className="truncate text-xs text-subtle">{s.recipientName}</div>
                          </td>
                          <td className="px-3 py-3 text-sm">
                            <div>{s.carrier || <span className="text-subtle">—</span>}</div>
                            {s.trackingNumber ? <div className="mono text-xs text-subtle">{s.trackingNumber}</div> : null}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-3 text-sm">
                            {s.estimatedDelivery ? fmtDate(s.estimatedDelivery) : '—'}
                            {isOverdue(s, todayStr) ? <span className="ml-1.5 text-xs text-bad">{t('vencida', 'overdue')}</span> : null}
                          </td>
                          <td className="px-3 py-3">
                            <StatusBadge status={s.status} />
                          </td>
                          <td className="num whitespace-nowrap px-4 py-3 text-right text-sm">{s.freightCost ? formatAmount(s.freightCost, s.currency) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y divide-line md:hidden">
                  {shown.map((s) => (
                    <li key={s.id} className="space-y-1.5 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          {openRow(s)}
                          <DirectionBadge direction={s.direction} />
                        </span>
                        <StatusBadge status={s.status} />
                      </div>
                      <p className="text-sm">{routeText(s)}</p>
                      <p className="text-xs text-subtle">
                        {s.recipientName}
                        {s.carrier ? ` · ${s.carrier}` : ''}
                        {s.estimatedDelivery ? ` · ${t('previsão', 'ETA')} ${fmtDate(s.estimatedDelivery)}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
                {list.length > shown.length ? (
                  <div className="border-t border-line p-3 text-center">
                    <Button variant="ghost" small onClick={() => setLimit((l) => l + 15)}>
                      {t('Ver mais', 'View more')} ({list.length - shown.length})
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </TCard>
        </>
      )}

      <ShipmentDrawer
        shipment={openShipment}
        onClose={onClose}
        onEdit={(s) => {
          setOpenId(null)
          setForm(s)
        }}
      />
      <ShipmentForm target={form} onClose={() => setForm(null)} onSaved={(id) => setOpenId(id)} />
    </div>
  )
}
