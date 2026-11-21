import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Filter, Plus, Search, Truck, X } from 'lucide-react'
import { Badge, Button, Empty, inputCls } from '@/components/ui'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { ALL_STATUSES, DIRECTIONS, counterparty, freightBreakdown, isOverdue, punctuality, sortShipments, type KpiKey, type SortKey } from '@/lib/logistics'
import { fmtDate } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Shipment, ShipmentDirection, ShipmentStatus } from '@/lib/types'
import { DirectionBadge, StatusBadge, dateTimeText, directionLabel, formatAmount, routeText, statusLabel } from './labels'
import { kpiCopy } from './kpi-copy'

const awaitingReceipt = (s: { direction: string; status: string; receiptId?: string; returnId?: string }): boolean => s.direction === 'inbound' && s.status === 'delivered' && !s.receiptId && !s.returnId

export interface ResultFilters {
  q: string
  status: ShipmentStatus | 'all'
  dir: ShipmentDirection | 'all'
}

const PAGE_SIZE = 10

interface Props {
  /** Remessas do indicador selecionado (ou todas, sem seleção), antes de busca e filtros. */
  base: Shipment[]
  kpi: KpiKey | null
  /** Ex.: "nos últimos 30 dias". */
  periodText: string
  filters: ResultFilters
  today: string
  onFilters: (f: Partial<ResultFilters>) => void
  onClearKpi: () => void
  onClearFilters: () => void
  onOpen: (id: string) => void
  onNew: () => void
}

const matches = (s: Shipment, f: ResultFilters): boolean => {
  const needle = f.q.trim().toLowerCase()
  return (
    (f.status === 'all' || s.status === f.status) &&
    (f.dir === 'all' || s.direction === f.dir) &&
    (!needle || [s.id, s.trackingNumber, s.recipientName, s.senderName, s.carrier, s.destination.city, s.origin.city].some((v) => v.toLowerCase().includes(needle)))
  )
}

export function ShipmentResults({ base, kpi, periodText, filters, today, onFilters, onClearKpi, onClearFilters, onOpen, onNew }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'updated', dir: 'desc' })
  const [pageState, setPageState] = useState({ key: '', page: 0 })

  const copy = kpiCopy(kpi, periodText)
  const filtered = sortShipments(
    base.filter((s) => matches(s, filters)),
    sort.key,
    sort.dir,
  )
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // A página volta para a primeira sempre que o indicador, os filtros, a ordenação ou o tamanho da lista mudam.
  const resetKey = `${kpi}|${filters.q}|${filters.status}|${filters.dir}|${sort.key}${sort.dir}|${base.length}`
  const page = Math.min(pageState.key === resetKey ? pageState.page : 0, pages - 1)
  const rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const go = (p: number) => setPageState({ key: resetKey, page: Math.max(0, Math.min(pages - 1, p)) })

  const narrowed = filters.q.trim() !== '' || filters.status !== 'all' || filters.dir !== 'all'
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'updated' ? 'desc' : 'asc' }))

  const freight = kpi === 'freight' ? freightBreakdown(filtered) : null
  const punct = kpi === 'onTime' ? filtered.map(punctuality).filter((p): p is NonNullable<typeof p> => p !== null) : null
  const lateCount = punct ? punct.filter((p) => !p.onTime).length : 0

  const extraHead = kpi === 'freight' ? t('Frete', 'Freight') : kpi === 'delivered' ? t('Entregue em', 'Delivered on') : kpi === 'onTime' ? t('Pontualidade', 'Punctuality') : null
  const extraCell = (s: Shipment) => {
    if (kpi === 'freight') return s.freightCost ? formatAmount(s.freightCost, s.currency) : '—'
    if (kpi === 'delivered') return s.deliveredAt ? fmtDate(s.deliveredAt) : '—'
    if (kpi === 'onTime') {
      const p = punctuality(s)
      if (!p) return '—'
      return p.onTime ? <Badge tone="ok">{t('No prazo', 'On time')}</Badge> : <Badge tone="bad">{t(`${p.daysLate} dia(s) de atraso`, `${p.daysLate} day(s) late`)}</Badge>
    }
    return null
  }

  const head = (k: SortKey, label: string) => (
    <th key={k} className="px-3 py-2.5" aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 rounded text-[11px] font-semibold uppercase tracking-wider text-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60">
        {label}
        {sort.key === k ? sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" /> : null}
      </button>
    </th>
  )

  const idButton = (s: Shipment) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen(s.id)
      }}
      className="mono rounded text-left text-sm font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {s.id}
    </button>
  )

  return (
    <TCard id="shipment-results" className="scroll-mt-20 overflow-hidden">
      <div className="space-y-3 border-b border-line p-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PanelTitle icon={<Truck size={18} />} title={copy.title} subtitle={copy.description} />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted" aria-live="polite">
              {filtered.length}
              {narrowed || filtered.length !== base.length ? ` / ${base.length}` : ''} {filtered.length === 1 ? t('remessa', 'shipment') : t('remessas', 'shipments')}
            </span>
            {kpi ? (
              <Button small variant="ghost" onClick={onClearKpi}>
                <X size={14} /> {t('Ver todas as remessas', 'View all shipments')}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-line bg-fill/5 px-3 focus-within:ring-2 focus-within:ring-violet/50">
            <Search size={15} className="text-subtle" />
            <input aria-label={t('Buscar remessas', 'Search shipments')} placeholder={t('Código, rastreio, cliente…', 'ID, tracking, customer…')} value={filters.q} onChange={(e) => onFilters({ q: e.target.value })} className="min-h-10 w-44 bg-transparent text-sm outline-none placeholder:text-subtle" />
          </label>
          <select aria-label={t('Filtrar por status', 'Filter by status')} className={`${inputCls} !min-h-10 !w-auto`} value={filters.status} onChange={(e) => onFilters({ status: e.target.value as ShipmentStatus | 'all' })}>
            <option value="all">{t('Todos os status', 'All statuses')}</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <select aria-label={t('Filtrar por tipo', 'Filter by type')} className={`${inputCls} !min-h-10 !w-auto`} value={filters.dir} onChange={(e) => onFilters({ dir: e.target.value as ShipmentDirection | 'all' })}>
            <option value="all">{t('Todos os tipos', 'All types')}</option>
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {directionLabel(d)}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 md:hidden">
            <select
              aria-label={t('Ordenar por', 'Sort by')}
              className={`${inputCls} !min-h-10 !w-auto`}
              value={sort.key}
              onChange={(e) => setSort((s) => ({ ...s, key: e.target.value as SortKey }))}
            >
              <option value="updated">{t('Atualização', 'Last update')}</option>
              <option value="id">{t('Código', 'ID')}</option>
              <option value="counterparty">{t('Cliente / fornecedor', 'Customer / supplier')}</option>
              <option value="eta">{t('Previsão', 'ETA')}</option>
              <option value="status">Status</option>
            </select>
            <Button small variant="ghost" onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))} aria-label={sort.dir === 'asc' ? t('Ordem crescente', 'Ascending order') : t('Ordem decrescente', 'Descending order')}>
              {sort.dir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            </Button>
          </div>
          {narrowed ? (
            <Button small variant="ghost" onClick={onClearFilters}>
              <Filter size={14} /> {t('Limpar filtros', 'Clear filters')}
            </Button>
          ) : null}
        </div>

        {freight && Object.keys(freight.byCurrency).length > 0 ? (
          <div className="rounded-xl border border-line bg-fill/5 p-3">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              {Object.entries(freight.byCurrency).map(([c, v]) => (
                <span key={c} className="num text-sm">
                  <span className="text-muted">{c}: </span>
                  <span className="font-semibold">{formatAmount(v, c)}</span>
                </span>
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
              {freight.byCarrier.slice(0, 5).map((c) => (
                <li key={`${c.carrier}|${c.currency}`}>
                  {c.carrier || t('Sem transportadora', 'No carrier')}: <span className="num font-semibold text-ink">{formatAmount(c.total, c.currency)}</span> ({c.count})
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {punct && punct.length > 0 ? (
          <p className="rounded-xl border border-line bg-fill/5 px-3 py-2 text-sm">
            <span className="font-semibold">{`${Math.round(((punct.length - lateCount) / punct.length) * 100)}%`}</span> {t('no prazo', 'on time')} ({punct.length - lateCount}/{punct.length}) · {lateCount} {t('com atraso', 'late')}
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        base.length === 0 && kpi ? (
          <Empty
            icon={<Truck size={22} />}
            title={copy.emptyTitle}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="ghost" onClick={onClearKpi}>
                  {t('Ver todas as remessas', 'View all shipments')}
                </Button>
                {copy.offerNew ? (
                  <Button onClick={onNew}>
                    <Plus size={16} /> {t('Nova remessa', 'New shipment')}
                  </Button>
                ) : null}
              </div>
            }
          />
        ) : (
          <Empty
            icon={<Search size={22} />}
            title={t('Nenhuma remessa encontrada com estes filtros.', 'No shipments match these filters.')}
            text={t('Ajuste a busca ou limpe os filtros.', 'Adjust the search or clear the filters.')}
            action={
              <Button variant="ghost" onClick={onClearFilters}>
                {t('Limpar filtros', 'Clear filters')}
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] border-collapse [&_tbody_tr]:border-t [&_tbody_tr]:border-line">
              <thead>
                <tr className="text-left">
                  {head('id', t('Código / tipo', 'ID / type'))}
                  {head('counterparty', t('Cliente / fornecedor', 'Customer / supplier'))}
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Origem → destino', 'Origin → destination')}</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Transportadora / rastreio', 'Carrier / tracking')}</th>
                  {head('eta', t('Previsão', 'ETA'))}
                  {head('status', 'Status')}
                  {extraHead ? <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{extraHead}</th> : null}
                  {head('updated', t('Atualizada', 'Updated'))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} onClick={() => onOpen(s.id)} className="cursor-pointer transition hover:bg-fill/5">
                    <td className="px-3 py-3">
                      {idButton(s)}
                      <div className="mt-1">
                        <DirectionBadge direction={s.direction} />
                      </div>
                    </td>
                    <td className="max-w-[160px] px-3 py-3 text-sm">
                      <div className="truncate">{counterparty(s) || '—'}</div>
                    </td>
                    <td className="max-w-[200px] px-3 py-3 text-sm">
                      <div className="truncate">{routeText(s)}</div>
                    </td>
                    <td className="px-3 py-3 text-sm">
                      <div>{s.carrier || <span className="text-subtle">—</span>}</div>
                      {s.trackingNumber ? <div className="mono text-xs text-subtle">{s.trackingNumber}</div> : null}
                    </td>
                    <td className="num whitespace-nowrap px-3 py-3 text-sm">
                      {s.estimatedDelivery ? fmtDate(s.estimatedDelivery) : '—'}
                      {isOverdue(s, today) ? <span className="ml-1.5 text-xs text-bad">{t('vencida', 'overdue')}</span> : null}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={s.status} />
                        {awaitingReceipt(s) ? <Badge tone="warn">{t('A conferir', 'To check')}</Badge> : null}
                      </div>
                    </td>
                    {extraHead ? <td className="num whitespace-nowrap px-3 py-3 text-sm">{extraCell(s)}</td> : null}
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">{dateTimeText(s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-line md:hidden">
            {rows.map((s) => (
              <li key={s.id} onClick={() => onOpen(s.id)} className="cursor-pointer space-y-1.5 p-4 active:bg-fill/5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    {idButton(s)}
                    <DirectionBadge direction={s.direction} />
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-1">
                    <StatusBadge status={s.status} />
                    {awaitingReceipt(s) ? <Badge tone="warn">{t('A conferir', 'To check')}</Badge> : null}
                  </span>
                </div>
                <p className="text-sm">{counterparty(s) || '—'}</p>
                <p className="text-xs text-muted">{routeText(s)}</p>
                <p className="text-xs text-subtle">
                  {s.carrier || '—'}
                  {s.trackingNumber ? ` · ${s.trackingNumber}` : ''}
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                  <span>
                    {t('Previsão', 'ETA')}: {s.estimatedDelivery ? fmtDate(s.estimatedDelivery) : '—'}
                  </span>
                  <span>
                    {t('Atualizada', 'Updated')}: {dateTimeText(s.updatedAt)}
                  </span>
                  {extraHead ? (
                    <span className="inline-flex items-center gap-1">
                      {extraHead}: <span className="num font-semibold text-ink">{extraCell(s)}</span>
                    </span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <nav aria-label={t('Paginação', 'Pagination')} className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
              <span className="text-xs text-muted" aria-live="polite">
                {page * PAGE_SIZE + 1}–{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} {t('de', 'of')} {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <Button small variant="ghost" onClick={() => go(page - 1)} disabled={page === 0} aria-label={t('Página anterior', 'Previous page')}>
                  <ChevronLeft size={16} />
                </Button>
                <span className="num text-xs text-muted">
                  {page + 1}/{pages}
                </span>
                <Button small variant="ghost" onClick={() => go(page + 1)} disabled={page >= pages - 1} aria-label={t('Próxima página', 'Next page')}>
                  <ChevronRight size={16} />
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </TCard>
  )
}
