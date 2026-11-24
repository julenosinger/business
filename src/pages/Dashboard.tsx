import { useAccount } from 'wagmi'
import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, AlertTriangle, Banknote, Boxes, CalendarClock, Database, DownloadCloud, Landmark, LineChart, Package, PieChart, Receipt, Trash2, TrendingUp, Wallet } from 'lucide-react'
import { Bar, AreaChart, C, Donut } from '@/components/charts'
import { AssistantPanel } from '@/components/AssistantPanel'
import { Badge, Button, Empty, Skeleton } from '@/components/ui'
import { PageTop } from '@/components/ds/PageTop'
import { KpiTile } from '@/components/ds/KpiTile'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { useStore } from '@/lib/store'
import { useNav } from '@/lib/nav'
import { useGatewayBalances } from '@/lib/gateway'
import { useNetwork } from '@/lib/network'
import { accountTotalsForEnvironment, accountsForEnvironment, delta, entriesForEnvironment, kpisForEnvironment, monthPeriod, monthlySeriesForEnvironment, productsForEnvironment, salesForEnvironment, stockValueForEnvironment, upcomingForEnvironment } from '@/lib/selectors'
import { fmtDate, daysUntil, money, moneyCompact, num, pct, usdcFmt } from '@/lib/format'
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
  const { data, loadSandboxDemo, cancelAccount } = useStore()
  const { go, requestPay } = useNav()
  const network = useNetwork()
  const [sinceBackup, setSinceBackup] = useState<number | null>(daysSinceBackup())
  const { address } = useAccount()
  const gw = useGatewayBalances(address)

  const now = monthPeriod(0)
  const prev = monthPeriod(-1)
  const cur = kpisForEnvironment(data, network, now)
  const old = kpisForEnvironment(data, network, prev)
  const series = monthlySeriesForEnvironment(data, network, 6)
  const totals = accountTotalsForEnvironment(data, network)
  const next = upcomingForEnvironment(data, network, 5)
  const hasData = salesForEnvironment(data, network).length + entriesForEnvironment(data, network).length + productsForEnvironment(data, network).length + accountsForEnvironment(data.accounts, network).length > 0
  const maxAcc = Math.max(totals.receivable, totals.payable, 1)
  const gwConfirmed = gw.data?.total ?? 0
  const gwPending = gw.data?.pending ?? 0
  const net = cur.inflow - cur.outflow
  const margin = cur.revenue > 0 ? (cur.profit / cur.revenue) * 100 : null

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title={t(`Olá, ${data.settings.owner}!`, `Hello, ${data.settings.owner}!`)}
        subtitle={t(`Visão geral de ${data.settings.company} em ${now.label}.`, `Overview of ${data.settings.company} for ${now.label}.`)}
        actions={
          !hasData && network === 'testnet' ? (
            <Button variant="ghost" onClick={loadSandboxDemo}>
              <Database size={16} /> {t('Carregar dados de demonstração', 'Load demo data')}
            </Button>
          ) : undefined
        }
      />

      {hasData && (sinceBackup === null || sinceBackup >= 7) ? (
        <div className="tcard flex flex-wrap items-center gap-3 !border-warn/40 !bg-warn/10 p-4 text-sm" role="status">
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
        <TCard className="p-2">
          <Empty
            icon={<TrendingUp size={22} />}
            title={t('Seu painel começa vazio', 'Your dashboard starts empty')}
            text={t('Cadastre produtos, registre vendas e contas, ou carregue dados de demonstração para explorar o sistema.', 'Add products, record sales and bills, or load demo data to explore the system.')}
            action={
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <Button onClick={() => go('stock')}>{t('Cadastrar produtos', 'Add products')}</Button>
                {network === 'testnet' ? (
                  <Button variant="ghost" onClick={loadSandboxDemo}>
                    {t('Carregar demonstração', 'Load demo')}
                  </Button>
                ) : null}
              </div>
            }
          />
        </TCard>
      ) : null}

      {hasData && cur.cogsIncomplete ? (
        <div className="tcard flex flex-wrap items-center gap-3 !border-warn/40 !bg-warn/10 p-4 text-sm" role="status">
          <AlertTriangle size={18} className="text-warn" />
          <p className="min-w-0 flex-1 text-pretty">
            {t(
              'Há receita de mercadorias sem custo (CMV) informado: o lucro líquido está incompleto. Registre a venda no PDV ou informe o custo para apurar o resultado.',
              'There is merchandise revenue without a reported cost (COGS): net profit is incomplete. Record the sale in the POS or report the cost to compute the result.',
            )}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 3xl:grid-cols-6">
        <KpiTile
          tone="ok"
          icon={<Banknote size={20} />}
          label={t('Faturamento', 'Revenue')}
          value={money(cur.revenue)}
          hint={t('Vendas do PDV + outras receitas de natureza "receita".', 'POS sales + other revenue of a "revenue" nature.')}
          sub={<Delta value={delta(cur.revenue, old.revenue)} />}
        />
        <KpiTile
          tone="violet"
          icon={<TrendingUp size={20} />}
          label={t('Lucro bruto', 'Gross profit')}
          value={money(cur.grossProfit)}
          valueTone={cur.grossProfit < 0 ? 'bad' : undefined}
          hint={t('Faturamento menos o custo das mercadorias vendidas (CMV).', 'Revenue minus cost of goods sold (COGS).')}
          sub={<Delta value={delta(cur.grossProfit, old.grossProfit)} />}
        />
        <KpiTile
          tone="warn"
          icon={<Package size={20} />}
          label={t('CMV', 'COGS')}
          value={money(cur.cogs)}
          hint={t('Custo das mercadorias vendidas, apurado pelas vendas — nunca inferido de pagamentos a fornecedores.', 'Cost of goods sold, derived from sales — never inferred from supplier payments.')}
          sub={t('Custo das mercadorias vendidas', 'Cost of goods sold')}
        />
        <KpiTile tone="sky" icon={<Wallet size={20} />} label={t('Despesas operacionais', 'Operating expenses')} value={money(cur.opex)} sub={<Delta value={delta(cur.opex, old.opex)} />} />
        <KpiTile
          tone="violet"
          icon={<TrendingUp size={20} />}
          label={t('Lucro líquido', 'Net profit')}
          value={money(cur.profit)}
          valueTone={cur.profit < 0 ? 'bad' : undefined}
          hint={t('Lucro bruto menos despesas operacionais.', 'Gross profit minus operating expenses.')}
          sub={
            <>
              <Delta value={delta(cur.profit, old.profit)} />
              {margin !== null ? <span className="text-subtle">{t('margem', 'margin')} {num(margin)}%</span> : null}
            </>
          }
        />
        <KpiTile
          tone="warn"
          icon={<Boxes size={20} />}
          label={t('Valor em estoque', 'Inventory value')}
          value={money(stockValueForEnvironment(data, network))}
          sub={t(`${productsForEnvironment(data, network).length} produtos`, `${productsForEnvironment(data, network).length} products`)}
        />
      </div>

      <div className="grid items-stretch gap-4 sm:gap-5 xl:grid-cols-[1.5fr_1fr]">
        <TCard className="flex h-full flex-col gap-3 p-4 sm:p-5">
          <PanelTitle
            icon={<LineChart size={18} />}
            title={t('Faturamento vs. lucro', 'Revenue vs. profit')}
            subtitle={t('Últimos 6 meses', 'Last 6 months')}
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
          />
          <AreaChart
            labels={series.map((s) => s.label)}
            series={[
              { name: 'revenue', color: C.accent, values: series.map((s) => s.revenue) },
              { name: 'profit', color: C.ok, values: series.map((s) => s.profit) },
            ]}
          />
        </TCard>

        <TCard className="flex h-full flex-col gap-4 p-4 sm:p-5">
          <PanelTitle icon={<PieChart size={18} />} title={t('Fluxo de caixa do mês', 'Cash flow this month')} subtitle={now.label} />
          <div className="flex flex-1 flex-wrap items-center gap-5">
            <Donut
              segments={[
                { label: 'in', value: cur.inflow, color: C.ok },
                { label: 'out', value: cur.outflow, color: C.bad },
              ]}
            >
              <span className="text-[11px] text-subtle">{t('Resultado do mês', "Month's result")}</span>
              <span className={`display num text-sm font-semibold ${net < 0 ? 'text-bad' : 'text-ok'}`}>{moneyCompact(net)}</span>
            </Donut>
            <dl className="min-w-[140px] flex-1 space-y-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <dt className="flex items-center gap-2 text-muted">
                  <i className="size-2 rounded-full bg-ok" /> {t('Entradas', 'Inflows')}
                </dt>
                <dd className="num whitespace-nowrap font-semibold">{money(cur.inflow)}</dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <dt className="flex items-center gap-2 text-muted">
                  <i className="size-2 rounded-full bg-bad" /> {t('Saídas', 'Outflows')}
                </dt>
                <dd className="num whitespace-nowrap font-semibold">{money(cur.outflow)}</dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t border-line pt-3">
                <dt className="text-muted">{t('Resultado', 'Net')}</dt>
                <dd className={`num whitespace-nowrap font-semibold ${net < 0 ? 'text-bad' : 'text-ok'}`}>{money(net)}</dd>
              </div>
            </dl>
          </div>
        </TCard>
      </div>

      <div className="grid items-stretch gap-4 sm:gap-5 lg:grid-cols-2">
        <TCard className="flex h-full flex-col gap-4 p-4 sm:p-5">
          <PanelTitle
            icon={<Landmark size={18} />}
            title={t('Tesouraria global', 'Global treasury')}
            subtitle={t('Saldo unificado em USDC', 'Unified USDC balance')}
            action={<Badge tone="accent">Circle Gateway</Badge>}
          />
          <div>
            {!address ? (
              <div className="display text-2xl font-semibold text-muted">{t('Carteira desconectada', 'Wallet disconnected')}</div>
            ) : gw.isLoading ? (
              <Skeleton className="h-9 w-40" />
            ) : gw.isError ? (
              <div className="text-sm text-bad">{t('Não foi possível consultar o saldo agora.', 'Could not fetch the balance right now.')}</div>
            ) : (
              <div className="display num text-3xl font-semibold">
                {usdcFmt(gwConfirmed + gwPending)} <span className="text-base font-medium text-muted">USDC</span>
              </div>
            )}
            {address && gw.data && !gw.isError ? (
              <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <dt className="text-subtle">{t('Disponível', 'Available')}</dt>
                  <dd className="num mt-0.5 text-sm font-semibold">{usdcFmt(gwConfirmed)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">{t('Em processamento', 'Processing')}</dt>
                  <dd className="num mt-0.5 text-sm font-semibold">{gw.data.pending === null ? '—' : usdcFmt(gwPending)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">{t('Redes com saldo', 'Funded networks')}</dt>
                  <dd className="num mt-0.5 text-sm font-semibold">{gw.data.byChain.filter((b) => b.amount > 0).length}</dd>
                </div>
              </dl>
            ) : null}
          </div>
          <div className="mt-auto">
            <Button onClick={() => go('treasury')}>
              <Landmark size={16} /> {t('Abrir tesouraria', 'Open treasury')}
            </Button>
          </div>
        </TCard>

        <TCard className="flex h-full flex-col gap-4 p-4 sm:p-5">
          <PanelTitle
            icon={<Receipt size={18} />}
            title={t('Contas a pagar e receber', 'Payables and receivables')}
            subtitle={t('Valores em aberto', 'Open amounts')}
            action={
              <button onClick={() => go('finance')} className="text-sm font-semibold text-sky hover:underline">
                {t('Ver contas', 'View bills')}
              </button>
            }
          />
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
          </div>
          {totals.overduePayable > 0 ? (
            <div className="mt-auto">
              <Badge tone="bad">
                {money(totals.overduePayable)} {t('em atraso a pagar', 'overdue payables')}
              </Badge>
            </div>
          ) : null}
        </TCard>
      </div>

      <div className="grid items-stretch gap-4 sm:gap-5 lg:grid-cols-[1.4fr_1fr]">
        <TCard className="h-full p-4 sm:p-5">
          <PanelTitle
            icon={<CalendarClock size={18} />}
            title={t('Próximas obrigações', 'Upcoming obligations')}
            subtitle={t('Vencimentos mais próximos', 'Nearest due dates')}
            action={
              <button onClick={() => go('finance')} className="text-sm font-semibold text-sky hover:underline">
                {t('Ver contas', 'View bills')}
              </button>
            }
          />
          {next.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t('Nenhuma conta em aberto.', 'No open bills.')}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {next.map((a) => {
                const d = daysUntil(a.dueDate)
                return (
                  <li key={a.id} className="flex items-center gap-3 rounded-xl border border-line bg-fill/5 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{a.description}</div>
                      <div className="text-xs text-subtle">
                        {a.contactName} · {fmtDate(a.dueDate)}{' '}
                        {d < 0 ? t(`(${-d} dia(s) em atraso)`, `(${-d} day(s) overdue)`) : d === 0 ? t('(hoje)', '(today)') : t(`(em ${d} dia(s))`, `(in ${d} day(s))`)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`num text-sm font-semibold ${a.kind === 'payable' ? 'text-bad' : 'text-ok'}`}>{money(a.amount)}</div>
                      <div className="mt-0.5 flex items-center justify-end gap-2">
                        {a.kind === 'payable' ? (
                          <button onClick={() => requestPay(a.id)} className="text-xs font-semibold text-sky hover:underline">
                            {t('Pagar via USDC', 'Pay with USDC')}
                          </button>
                        ) : null}
                        <button
                          onClick={() => {
                            if (window.confirm(t(`Cancelar a obrigação "${a.description}"?`, `Cancel the "${a.description}" obligation?`))) cancelAccount(a.id)
                          }}
                          aria-label={t('Cancelar obrigação', 'Cancel obligation')}
                          title={t('Cancelar obrigação', 'Cancel obligation')}
                          className="text-subtle transition-colors hover:text-bad"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </TCard>

        <AssistantPanel />
      </div>
    </div>
  )
}
