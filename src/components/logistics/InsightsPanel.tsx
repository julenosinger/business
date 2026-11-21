import { useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, Gauge, Lightbulb, PackageSearch, Plug, Route, ShieldCheck, TrendingUp } from 'lucide-react'
import { Badge, Button, Empty, TableWrap, td, th } from '@/components/ui'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { CountBars } from './CountBars'
import { useStore } from '@/lib/store'
import { useNav } from '@/lib/nav'
import { DUE_SOON_DAYS, STALE_DAYS, carrierPerformance, delayRisks, exceptionSummaries, forecast, freightAnalysis, reorderSuggestions, type DelayReason } from '@/lib/analytics'
import { buildSnapshot, rulesProvider, runInsights, type LogisticsInsight } from '@/lib/logistics-ai'
import { addDays, fmtDate, num, today } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Shipment } from '@/lib/types'
import { formatAmount } from './labels'

const reasonLabel = (r: DelayReason): string =>
  ({
    exception: t('Exceção', 'Exception'),
    delayed: t('Atrasada', 'Delayed'),
    overdue: t('Previsão vencida', 'Past due date'),
    stalled: t(`Parada há ${STALE_DAYS}+ dias`, `Idle ${STALE_DAYS}+ days`),
    due_soon: t('Vence em breve', 'Due soon'),
  })[r]

const pct = (n: number | null): string => (n === null ? '—' : `${Math.round(n)}%`)
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const Link = ({ id, onOpen }: { id: string; onOpen: (id: string) => void }) => (
  <button type="button" onClick={() => onOpen(id)} className="mono font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
    {id}
  </button>
)

/**
 * Análises de logística. Tudo é calculado por regras locais a partir dos seus registros: não há IA conectada,
 * as projeções são simples e nada aqui altera estoque, financeiro ou remessas.
 */
export function InsightsPanel({ shipments, from, periodText, onOpen }: { shipments: Shipment[]; from: string; periodText: string; onOpen: (id: string) => void }) {
  const { data } = useStore()
  const { go } = useNav()
  const todayStr = today()
  const [insights, setInsights] = useState<LogisticsInsight[] | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    void runInsights(rulesProvider, buildSnapshot(data, todayStr)).then((r) => {
      if (!ctl.signal.aborted) setInsights(r)
    })
    return () => ctl.abort()
  }, [data, todayStr])

  const carrierName = (id: string): string => data.carriers.find((c) => c.id === id)?.name ?? id
  const productName = (id: string): string => data.products.find((p) => p.id === id)?.name ?? id
  const perf = carrierPerformance(shipments, from)
  const risks = delayRisks(shipments, todayStr)
  const exceptions = exceptionSummaries(shipments, todayStr)
  const fa = freightAnalysis(shipments, from)
  const reorder = reorderSuggestions(data)
  const fc = forecast(shipments, todayStr)

  const text = (i: LogisticsInsight): string => {
    const p = i.params
    switch (i.code) {
      case 'overdue':
        return t(`${p.id}: previsão de entrega vencida há ${p.days} dia(s).`, `${p.id}: delivery date passed ${p.days} day(s) ago.`)
      case 'stalled':
        return t(`${p.id}: sem nenhum registro há ${p.days} dia(s).`, `${p.id}: no activity for ${p.days} day(s).`)
      case 'cost_over_estimate':
        return t(`${p.id}: custo ${p.percent}% acima do estimado.`, `${p.id}: cost ${p.percent}% above the estimate.`)
      case 'carrier_ranking':
        return t(`Melhor pontualidade: ${carrierName(String(p.best))} (${p.bestRate}%). Menor: ${carrierName(String(p.worst))} (${p.worstRate}%).`, `Best on-time rate: ${carrierName(String(p.best))} (${p.bestRate}%). Lowest: ${carrierName(String(p.worst))} (${p.worstRate}%).`)
      case 'reorder':
        return t(`${productName(String(p.id))}: estoque ${p.stock} + ${p.incoming} a caminho, abaixo do mínimo de ${p.min}.`, `${productName(String(p.id))}: stock ${p.stock} + ${p.incoming} incoming, below the minimum of ${p.min}.`)
    }
  }

  // Previsão: 8 semanas de histórico + 4 de projeção, em barras de contagem.
  const labels = [...fc.history.map((_, i) => fmtDate(addDays(todayStr, -7 * (fc.history.length - 1 - i))).slice(0, 5)), ...fc.projection.map((_, i) => fmtDate(addDays(todayStr, 7 * (i + 1))).slice(0, 5))]

  return (
    <div className="space-y-4">
      <TCard className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-violet" />
          <p className="text-sm text-muted text-pretty">
            {t('Estas análises são calculadas por regras locais, a partir dos seus registros, no período', 'These analyses are computed by local rules from your records, for the period')} {periodText}. {t('Nenhuma IA está conectada e nada é alterado automaticamente: as sugestões só abrem telas para você revisar.', 'No AI is connected and nothing is changed automatically: suggestions only open screens for you to review.')}
          </p>
        </div>
      </TCard>

      <TCard className="p-4 sm:p-5">
        <PanelTitle icon={<Lightbulb size={18} />} title={t('Resumo automático', 'Automatic summary')} subtitle={t('Regras locais sobre um retrato anonimizado dos dados', 'Local rules over an anonymized snapshot of your data')} />
        {insights === null ? (
          <p className="mt-3 text-sm text-muted">{t('Calculando…', 'Computing…')}</p>
        ) : insights.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('Nada precisa de atenção agora.', 'Nothing needs attention right now.')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {insights.slice(0, 8).map((i, idx) => (
              <li key={`${i.code}-${i.targetId ?? idx}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Badge tone={i.severity === 'critical' ? 'bad' : i.severity === 'warning' ? 'warn' : 'neutral'}>{i.severity === 'critical' ? t('Crítico', 'Critical') : i.severity === 'warning' ? t('Atenção', 'Warning') : t('Info', 'Info')}</Badge>
                  <span className="min-w-0 text-pretty">{text(i)}</span>
                </span>
                {i.action === 'review_shipment' && i.targetId ? (
                  <Button small variant="ghost" onClick={() => onOpen(i.targetId as string)}>
                    {t('Revisar remessa', 'Review shipment')}
                  </Button>
                ) : i.action === 'review_product' ? (
                  <Button small variant="ghost" onClick={() => go('stock')}>
                    {t('Ver estoque', 'View inventory')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {insights && insights.length > 8 ? <p className="mt-2 text-xs text-subtle">{t(`Mostrando 8 de ${insights.length}. Veja os detalhes nas seções abaixo.`, `Showing 8 of ${insights.length}. See details in the sections below.`)}</p> : null}
      </TCard>

      <TCard className="overflow-hidden">
        <div className="border-b border-line p-4 sm:px-5">
          <PanelTitle icon={<Gauge size={18} />} title={t('Desempenho por transportadora', 'Carrier performance')} subtitle={`${t('Remessas despachadas criadas', 'Dispatched shipments created')} ${periodText}`} />
        </div>
        {perf.length === 0 ? (
          <div className="p-4">
            <Empty icon={<Gauge size={22} />} title={t('Sem remessas despachadas no período', 'No dispatched shipments in the period')} text={t('Os indicadores aparecem depois dos primeiros despachos.', 'Indicators appear after the first dispatches.')} />
          </div>
        ) : (
          <TableWrap>
            <>
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>{t('Transportadora', 'Carrier')}</th>
                  <th className={`${th} text-right`}>{t('Despachadas', 'Dispatched')}</th>
                  <th className={`${th} text-right`}>{t('Entregues', 'Delivered')}</th>
                  <th className={`${th} text-right`}>{t('No prazo', 'On time')}</th>
                  <th className={`${th} text-right`}>{t('Tempo médio', 'Avg transit')}</th>
                  <th className={`${th} text-right`}>{t('Com problema', 'With issues')}</th>
                  <th className={`${th} text-right`}>{t('Custo médio', 'Avg cost')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {perf.map((p) => (
                  <tr key={p.carrier}>
                    <td className={`${td} font-medium`}>{p.carrier || t('Sem transportadora', 'No carrier')}</td>
                    <td className={`${td} num text-right`}>{p.handled}</td>
                    <td className={`${td} num text-right`}>{p.delivered}</td>
                    <td className={`${td} num text-right`} title={p.onTimeSample ? `${p.onTimeSample} ${t('entregas medidas', 'measured deliveries')}` : t('Sem entregas com data prevista', 'No deliveries with an estimated date')}>
                      {pct(p.onTimeRate)}
                    </td>
                    <td className={`${td} num text-right`}>{p.avgTransitDays === null ? '—' : `${num(p.avgTransitDays)} ${t('dias', 'days')}`}</td>
                    <td className={`${td} num text-right`}>{pct(p.problemRate)}</td>
                    <td className={`${td} num text-right`}>{Object.keys(p.avgCost).length ? Object.entries(p.avgCost).map(([cur, v]) => formatAmount(v, cur)).join(' · ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </>
          </TableWrap>
        )}
      </TCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <TCard className="p-4 sm:p-5">
          <PanelTitle icon={<AlertTriangle size={18} />} title={t('Risco de atraso', 'Delay risk')} subtitle={t(`Regras: parada há ${STALE_DAYS}+ dias, previsão em até ${DUE_SOON_DAYS} dia sem sair para entrega, ou já vencida`, `Rules: idle ${STALE_DAYS}+ days, due within ${DUE_SOON_DAYS} day without out-for-delivery, or already past due`)} />
          {risks.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('Nenhuma remessa em risco pelas regras acima.', 'No shipments at risk under the rules above.')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {risks.slice(0, 8).map((r) => (
                <li key={r.shipment.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <Link id={r.shipment.id} onOpen={onOpen} /> <span className="text-muted">{r.shipment.carrier || '—'}</span>
                    {r.shipment.estimatedDelivery ? <span className="ml-1.5 text-xs text-subtle">{t('prev.', 'ETA')} {fmtDate(r.shipment.estimatedDelivery)}</span> : null}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {r.reasons.map((x) => (
                      <Badge key={x} tone={x === 'exception' || x === 'overdue' ? 'bad' : 'warn'}>
                        {reasonLabel(x)}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TCard>

        <TCard className="p-4 sm:p-5">
          <PanelTitle icon={<Route size={18} />} title={t('Resumo de exceções', 'Exception summary')} subtitle={t('Desde quando, motivo informado e último rastreio', 'Since when, reason entered and last tracking')} />
          {exceptions.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('Nenhuma exceção ou atraso em aberto.', 'No open exceptions or delays.')}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {exceptions.slice(0, 6).map((e) => (
                <li key={e.shipment.id} className="rounded-xl border border-line p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link id={e.shipment.id} onOpen={onOpen} />
                    <Badge tone={e.state === 'delayed' ? 'warn' : 'bad'}>{e.state === 'exception' ? t('Exceção', 'Exception') : e.state === 'delayed' ? t('Atrasada', 'Delayed') : t('Previsão vencida', 'Past due date')}</Badge>
                    <span className="text-xs text-subtle">
                      {count(e.daysOpen, t('dia', 'day'), t('dias', 'days'))} {t('desde', 'since')} {fmtDate(e.since)}
                    </span>
                  </p>
                  {e.note ? <p className="mt-1 text-muted">{e.note}</p> : null}
                  {e.lastTracking ? (
                    <p className="mt-0.5 text-xs text-subtle">
                      {t('Último rastreio', 'Last tracking')}: {e.lastTracking}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </TCard>
      </div>

      <TCard className="p-4 sm:p-5">
        <PanelTitle icon={<BarChart3 size={18} />} title={t('Análise de frete', 'Freight analysis')} subtitle={`${t('Custos de remessas criadas', 'Costs of shipments created')} ${periodText}`} />
        {fa.lanes.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('Nenhum custo de frete registrado no período.', 'No freight costs recorded in the period.')}</p>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">{t('Custo por kg', 'Cost per kg')}</h4>
              {fa.perKg.length ? (
                <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                  {fa.perKg.map((x) => (
                    <li key={`${x.carrier}|${x.currency}`} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 truncate">{x.carrier || '—'}</span>
                      <span className="num shrink-0">
                        {formatAmount(x.costPerKg, x.currency)}/kg <span className="text-xs text-subtle">({num(x.kg)} kg)</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t('Informe o peso dos volumes para calcular.', 'Enter package weights to calculate.')}</p>
              )}
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">{t('Rotas com maior custo', 'Highest-cost lanes')}</h4>
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {fa.lanes.slice(0, 5).map((l) => (
                  <li key={`${l.lane}|${l.currency}`} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="mono">{l.lane}</span>
                    <span className="num">
                      {formatAmount(l.total, l.currency)} <span className="text-xs text-subtle">({count(l.shipments, t('remessa', 'shipment'), t('remessas', 'shipments'))})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">{t('Acima do estimado', 'Above estimate')}</h4>
              {fa.overruns.length ? (
                <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                  {fa.overruns.map((o) => (
                    <li key={o.shipment.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <Link id={o.shipment.id} onOpen={onOpen} />
                      <span className="num text-bad">+{formatAmount(o.variance, o.shipment.currency)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t('Nenhuma remessa acima da estimativa.', 'No shipments above the estimate.')}</p>
              )}
              {fa.shareOfValue.length ? (
                <p className="mt-2 text-xs text-subtle">
                  {t('Frete sobre o valor declarado', 'Freight over declared value')}: {fa.shareOfValue.map((s) => `${s.currency} ${num(s.percent)}%`).join(' · ')}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </TCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <TCard className="p-4 sm:p-5">
          <PanelTitle icon={<PackageSearch size={18} />} title={t('Sugestões de reposição', 'Reorder suggestions')} subtitle={t('Meta = 2 × estoque mínimo. Considera compras aguardando recebimento.', 'Target = 2 × minimum stock. Counts purchases awaiting receipt.')} />
          {reorder.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('Nenhum produto abaixo do mínimo.', 'No product below its minimum.')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {reorder.slice(0, 8).map((r) => (
                <li key={r.productId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{r.name}</span> <span className="mono text-xs text-subtle">{r.sku}</span>
                    <span className="block text-xs text-muted">
                      {t('estoque', 'stock')} {num(r.stock)} + {num(r.incoming)} {t('a caminho', 'incoming')} · {t('mínimo', 'minimum')} {num(r.minStock)}
                    </span>
                  </span>
                  <Badge tone="warn">
                    {t('Sugerido', 'Suggested')}: {num(r.suggested)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-end">
            <Button small variant="ghost" onClick={() => go('purchases')}>
              {t('Abrir Compras', 'Open Purchases')}
            </Button>
          </div>
        </TCard>

        <TCard className="p-4 sm:p-5">
          <PanelTitle icon={<TrendingUp size={18} />} title={t('Projeção simples de remessas', 'Simple shipment projection')} subtitle={t('Média móvel das últimas 4 semanas, repetida nas próximas 4', 'Moving average of the last 4 weeks, repeated over the next 4')} />
          {fc.sufficient ? (
            <>
              <div className="mt-3">
                <CountBars labels={labels} a={[...fc.history, ...fc.projection.map(() => 0)]} b={[...fc.history.map(() => 0), ...fc.projection]} aLabel={t('Criadas', 'Created')} bLabel={t('Projeção', 'Projection')} />
              </div>
              <p className="text-xs text-subtle">
                {t(`Média recente: ${num(fc.average)} remessas por semana. Não é uma previsão estatística: serve só como referência de volume.`, `Recent average: ${num(fc.average)} shipments per week. This is not a statistical forecast: it is only a volume reference.`)}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">{t(`Dados insuficientes: são necessárias remessas em pelo menos ${4} semanas diferentes (e 8 no total) das últimas 8 semanas.`, 'Not enough data: shipments are needed in at least 4 different weeks (and 8 in total) of the last 8 weeks.')}</p>
          )}
        </TCard>
      </div>

      <TCard className="p-4 sm:p-5">
        <PanelTitle icon={<Plug size={18} />} title={t('Preparado para integrações e IA', 'Ready for integrations and AI')} subtitle={t('Interfaces prontas no código. Nada abaixo está conectado.', 'Interfaces ready in code. Nothing below is connected.')} />
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
          {[
            { title: t('Rastreio automático por transportadora', 'Automatic carrier tracking'), text: t('Webhooks assinados (HMAC-SHA256, com proteção contra reenvio) e eventos idempotentes que nunca mudam o status sozinhos. Precisa de um servidor e das credenciais de cada transportadora.', 'Signed webhooks (HMAC-SHA256, replay-protected) and idempotent events that never change status on their own. Requires a server and each carrier credentials.') },
            { title: t('Provedor de IA', 'AI provider'), text: t('Interface somente leitura com dados anonimizados (sem nomes, endereços, contatos ou códigos de rastreio) e respostas validadas. Nenhum modelo está conectado.', 'Read-only interface with anonymized data (no names, addresses, contacts or tracking codes) and validated responses. No model is connected.') },
            { title: t('Ações automáticas', 'Automatic actions'), text: t('Não existem. Nenhuma sugestão altera estoque, financeiro ou remessas sem a ação de uma pessoa.', 'None exist. No suggestion changes stock, finances or shipments without a person acting.') },
          ].map((x) => (
            <li key={x.title} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{x.title}</span>
                <span className="block text-xs text-muted text-pretty">{x.text}</span>
              </span>
              <Badge tone="neutral">{t('Inativo', 'Inactive')}</Badge>
            </li>
          ))}
        </ul>
      </TCard>
    </div>
  )
}
