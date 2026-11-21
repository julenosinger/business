import { useAccount } from 'wagmi'
import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Banknote, Boxes, Database, DownloadCloud, Landmark, TrendingUp, Wallet } from 'lucide-react'
import { Bar, AreaChart, C, Donut } from '@/components/charts'
import { AssistantPanel } from '@/components/AssistantPanel'
import { Badge, Button, Card, CardTitle, Empty, PageHeader, Stat } from '@/components/ui'
import { useStore } from '@/lib/store'
import { useNav } from '@/lib/nav'
import { useGatewayBalances } from '@/lib/gateway'
import { accountTotals, cashBalance, delta, kpis, monthPeriod, monthlySeries, stockValue, upcoming } from '@/lib/selectors'
import { fmtDate, daysUntil, money, moneyCompact, pct, usdcFmt } from '@/lib/format'
import { t } from '@/lib/i18n'
import { daysSinceBackup, exportBackup } from '@/lib/backup'

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-subtle">{t('sem base de comparação', 'no baseline to compare')}</span>
  const up = value >= 0
  return (
    <span className={up ? 'text-ok' : 'text-bad'}>
      {up ? <ArrowUpRight size={12} className="inline" /> : <ArrowDownRight size={12} className="inline" />} {pct(value)} <span className="text-subtle">{t('vs. mês anterior', 'vs. last month')}</span>
    </span>
  )
}

export function Dashboard() {
  const { data, loadDemo } = useStore()
  const { go, requestPay } = useNav()
  const [sinceBackup, setSinceBackup] = useState<number | null>(daysSinceBackup())
  const { address } = useAccount()
  const gw = useGatewayBalances(address)

  const now = monthPeriod(0)
  const prev = monthPeriod(-1)
  const cur = kpis(data, now)
  const old = kpis(data, prev)
  const series = monthlySeries(data, 6)
  const totals = accountTotals(data)
  const next = upcoming(data, 5)
  const hasData = data.sales.length + data.entries.length + data.products.length + data.accounts.length > 0
  const maxAcc = Math.max(totals.receivable, totals.payable, 1)

  return (
    <div>
      <PageHeader
        title={t(`Olá, ${data.settings.owner}!`, `Hello, ${data.settings.owner}!`)}
        subtitle={t(`Visão geral de ${data.settings.company} em ${now.label}.`, `Overview of ${data.settings.company} for ${now.label}.`)}
        actions={
          !hasData ? (
            <Button variant="ghost" onClick={loadDemo}>
              <Database size={16} /> {t('Carregar dados de demonstração', 'Load demo data')}
            </Button>
          ) : undefined
        }
      />

      {hasData && (sinceBackup === null || sinceBackup >= 7) ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm" role="status">
          <DownloadCloud size={18} className="text-warn" />
          <p className="min-w-0 flex-1 text-pretty">
            {sinceBackup === null
              ? t('Seus dados ficam só neste navegador e ainda não há backup.', 'Your data lives only in this browser and there is no backup yet.')
              : t(`Seu último backup foi há ${sinceBackup} dias.`, `Your last backup was ${sinceBackup} days ago.`)}
          </p>
          <Button
            small
            onClick={() => {
              exportBackup(data)
              setSinceBackup(daysSinceBackup())
            }}
          >
            {t('Exportar backup', 'Export backup')}
          </Button>
        </div>
      ) : null}

      {!hasData ? (
        <Card className="mb-6">
          <Empty
            icon={<TrendingUp size={22} />}
            title={t('Seu painel começa vazio', 'Your dashboard starts empty')}
            text={t('Cadastre produtos, registre vendas e contas, ou carregue dados de demonstração para explorar o sistema.', 'Add products, record sales and bills, or load demo data to explore the system.')}
            action={
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <Button onClick={() => go('stock')}>{t('Cadastrar produtos', 'Add products')}</Button>
                <Button variant="ghost" onClick={loadDemo}>
                  {t('Carregar demonstração', 'Load demo')}
                </Button>
              </div>
            }
          />
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('Faturamento', 'Revenue')} value={money(cur.revenue)} sub={<Delta value={delta(cur.revenue, old.revenue)} />} icon={<Banknote size={16} />} />
            <Stat
              label={t('Lucro líquido', 'Net profit')}
              value={money(cur.profit)}
              tone={cur.profit < 0 ? 'bad' : undefined}
              sub={<Delta value={delta(cur.profit, old.profit)} />}
              icon={<TrendingUp size={16} />}
            />
            <Stat label={t('Despesas operacionais', 'Operating expenses')} value={money(cur.opex)} sub={<Delta value={delta(cur.opex, old.opex)} />} icon={<Wallet size={16} />} />
            <Stat label={t('Valor em estoque', 'Inventory value')} value={money(stockValue(data))} sub={t(`${data.products.length} produtos`, `${data.products.length} products`)} icon={<Boxes size={16} />} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardTitle
                action={
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1.5">
                      <i className="size-2 rounded-full bg-accent" /> {t('Faturamento', 'Revenue')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <i className="size-2 rounded-full bg-ok" /> {t('Lucro', 'Profit')}
                    </span>
                  </div>
                }
              >
                {t('Faturamento vs. lucro', 'Revenue vs. profit')}
              </CardTitle>
              <AreaChart
                labels={series.map((s) => s.label)}
                series={[
                  { name: 'revenue', color: C.accent, values: series.map((s) => s.revenue) },
                  { name: 'profit', color: C.ok, values: series.map((s) => s.profit) },
                ]}
              />
            </Card>

            <Card>
              <CardTitle>{t('Fluxo de caixa do mês', 'Cash flow this month')}</CardTitle>
              <div className="flex flex-wrap items-center gap-5">
                <Donut
                  segments={[
                    { label: 'in', value: cur.inflow, color: C.ok },
                    { label: 'out', value: cur.outflow, color: C.bad },
                  ]}
                >
                  <span className="text-[11px] text-subtle">{t('Saldo de caixa', 'Cash balance')}</span>
                  <span className="display num text-lg font-semibold">{moneyCompact(cashBalance(data))}</span>
                </Donut>
                <dl className="min-w-[140px] flex-1 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-muted">
                      <i className="size-2 rounded-full bg-ok" /> {t('Entradas', 'Inflows')}
                    </dt>
                    <dd className="num font-semibold">{money(cur.inflow)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-muted">
                      <i className="size-2 rounded-full bg-bad" /> {t('Saídas', 'Outflows')}
                    </dt>
                    <dd className="num font-semibold">{money(cur.outflow)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                    <dt className="text-muted">{t('Resultado', 'Net')}</dt>
                    <dd className={`num font-semibold ${cur.inflow - cur.outflow < 0 ? 'text-bad' : 'text-ok'}`}>{money(cur.inflow - cur.outflow)}</dd>
                  </div>
                </dl>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle
                action={
                  <Badge tone="accent">Circle Gateway</Badge>
                }
              >
                {t('Tesouraria global', 'Global treasury')}
              </CardTitle>
              <div className="label">{t('Saldo unificado (USDC)', 'Unified balance (USDC)')}</div>
              <div className="display num mt-1 text-3xl font-semibold">
                {address ? (gw.isLoading ? t('Carregando...', 'Loading...') : `${usdcFmt(gw.data?.total ?? 0)} USDC`) : t('Carteira desconectada', 'Wallet disconnected')}
              </div>
              {address && gw.data?.byChain.length ? (
                <div className="mt-2 text-xs text-muted">{t(`Distribuído em ${gw.data.byChain.length} rede(s)`, `Spread across ${gw.data.byChain.length} network(s)`)}</div>
              ) : null}
              {gw.isError ? <div className="mt-2 text-xs text-bad">{t('Não foi possível consultar o saldo agora.', 'Could not fetch the balance right now.')}</div> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => go('treasury')}>
                  <Landmark size={16} /> {t('Abrir tesouraria', 'Open treasury')}
                </Button>
              </div>
            </Card>

            <Card>
              <CardTitle>{t('Contas a pagar e receber', 'Payables and receivables')}</CardTitle>
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-muted">{t('A receber', 'Receivable')}</span>
                    <span className="num font-semibold text-ok">{money(totals.receivable)}</span>
                  </div>
                  <Bar value={totals.receivable} max={maxAcc} color={C.ok} />
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-muted">{t('A pagar', 'Payable')}</span>
                    <span className="num font-semibold text-bad">{money(totals.payable)}</span>
                  </div>
                  <Bar value={totals.payable} max={maxAcc} color={C.bad} />
                </div>
                {totals.overduePayable > 0 ? <Badge tone="bad">{money(totals.overduePayable)} {t('em atraso a pagar', 'overdue payables')}</Badge> : null}
              </div>
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          <AssistantPanel />
          <Card>
            <CardTitle
              action={
                <button onClick={() => go('finance')} className="text-xs font-semibold text-accent hover:underline">
                  {t('Ver contas', 'View bills')}
                </button>
              }
            >
              {t('Próximas obrigações', 'Upcoming obligations')}
            </CardTitle>
            {next.length === 0 ? (
              <p className="text-sm text-muted">{t('Nenhuma conta em aberto.', 'No open bills.')}</p>
            ) : (
              <ul className="space-y-2">
                {next.map((a) => {
                  const d = daysUntil(a.dueDate)
                  return (
                    <li key={a.id} className="flex items-center gap-3 rounded-xl bg-fill/5 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{a.description}</div>
                        <div className="text-xs text-subtle">
                          {a.contactName} · {fmtDate(a.dueDate)} {d < 0 ? t(`(${-d} dia(s) em atraso)`, `(${-d} day(s) overdue)`) : d === 0 ? t('(hoje)', '(today)') : t(`(em ${d} dia(s))`, `(in ${d} day(s))`)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`num text-sm font-semibold ${a.kind === 'payable' ? 'text-bad' : 'text-ok'}`}>{money(a.amount)}</div>
                        {a.kind === 'payable' ? (
                          <button onClick={() => requestPay(a.id)} className="text-xs font-semibold text-accent hover:underline">
                            {t('Pagar via USDC', 'Pay with USDC')}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
