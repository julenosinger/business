import { useState } from 'react'
import { BarChart3, Download, FileSpreadsheet, LineChart, PieChart, PiggyBank, Percent, Trophy, TrendingUp, Wallet } from 'lucide-react'
import { AreaChart, Bar, C, Donut } from '@/components/charts'
import { Button, Empty } from '@/components/ui'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { periodFor, rangeTabs } from '@/pages/Accounting'
import { useStore } from '@/lib/store'
import { useNetwork } from '@/lib/network'
import { expensesByCategory, kpisForEnvironment, monthlySeriesForEnvironment, topProductsForEnvironment } from '@/lib/selectors'
import { fmtDate, downloadCsv, money, num } from '@/lib/format'
import { cat, t } from '@/lib/i18n'

const COLORS = [C.accent, C.ok, C.warn, C.bad, '#8b7bd8', '#3aa6b0', '#d1679f']

export function Reports() {
  const { data } = useStore()
  const network = useNetwork()
  const [range, setRange] = useState<'month' | 'prev' | 'year'>('month')
  const period = periodFor(range)
  const k = kpisForEnvironment(data, network, period)
  const cats = expensesByCategory(data, period)
  const top = topProductsForEnvironment(data, network, period, 8)
  const series = monthlySeriesForEnvironment(data, network, 6)
  const catTotal = cats.reduce((s, c) => s + c.total, 0)
  const margin = k.revenue > 0 ? (k.profit / k.revenue) * 100 : 0
  const topMax = Math.max(...top.map((p) => p.revenue), 1)
  const liveSales = data.sales.filter((s) => !s.canceledAt)
  const records = (n: number) => `${n} ${n === 1 ? t('registro', 'record') : t('registros', 'records')}`

  const exports: { id: string; title: string; sub: string; disabled: boolean; run: () => void }[] = [
    {
      id: 'sales',
      title: t('Vendas', 'Sales'),
      sub: records(liveSales.length),
      disabled: liveSales.length === 0,
      run: () =>
        downloadCsv('sales.csv', [
          [t('Data', 'Date'), t('Cliente', 'Customer'), t('Pagamento', 'Payment'), 'Total', t('Custo', 'Cost')],
          ...liveSales.map((s) => [fmtDate(s.date), s.customerName, s.method, s.total, s.cogs]),
        ]),
    },
    {
      id: 'inventory',
      title: t('Estoque', 'Inventory'),
      sub: records(data.products.length),
      disabled: data.products.length === 0,
      run: () =>
        downloadCsv('inventory.csv', [
          ['SKU', t('Produto', 'Product'), t('Categoria', 'Category'), t('Estoque', 'Stock'), t('Mínimo', 'Minimum'), t('Custo', 'Cost'), t('Preço', 'Price')],
          ...data.products.map((p) => [p.sku, p.name, p.category, p.stock, p.minStock, p.cost, p.price]),
        ]),
    },
    {
      id: 'bills',
      title: t('Contas', 'Bills'),
      sub: records(data.accounts.length),
      disabled: data.accounts.length === 0,
      run: () =>
        downloadCsv('bills.csv', [
          [t('Tipo', 'Type'), t('Descrição', 'Description'), t('Parte', 'Party'), t('Vencimento', 'Due date'), t('Valor', 'Amount'), t('Situação', 'Status')],
          ...data.accounts.map((a) => [a.kind === 'payable' ? t('A pagar', 'Payable') : t('A receber', 'Receivable'), a.description, a.contactName, fmtDate(a.dueDate), a.amount, a.status === 'paid' ? t('Liquidada', 'Settled') : t('Em aberto', 'Open')]),
        ]),
    },
  ]

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title={t('Relatórios e BI', 'Reports and BI')}
        subtitle={t(`Indicadores de ${period.label}.`, `Indicators for ${period.label}.`)}
        actions={<PillTabs label={t('Período', 'Period')} value={range} onChange={setRange} items={rangeTabs()} />}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="ok" icon={<TrendingUp size={20} />} label={t('Receita', 'Revenue')} value={money(k.revenue)} sub={period.label} />
        <KpiTile tone="sky" icon={<Wallet size={20} />} label={t('Lucro bruto', 'Gross profit')} value={money(k.grossProfit)} valueTone={k.grossProfit < 0 ? 'bad' : undefined} sub={t('Receita menos custo das mercadorias', 'Revenue minus cost of goods')} />
        <KpiTile tone="violet" icon={<PiggyBank size={20} />} label={t('Lucro líquido', 'Net profit')} value={money(k.profit)} valueTone={k.profit < 0 ? 'bad' : undefined} sub={k.profit < 0 ? t('Resultado negativo no período', 'Negative result in the period') : t('Após custos e despesas', 'After costs and expenses')} />
        <KpiTile tone="warn" icon={<Percent size={20} />} label={t('Margem líquida', 'Net margin')} value={`${num(margin)}%`} valueTone={margin < 0 ? 'bad' : undefined} sub={k.revenue > 0 ? t('Lucro líquido sobre a receita', 'Net profit over revenue') : t('Sem receita no período', 'No revenue in this period')} />
      </div>

      <div className="grid items-stretch gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <TCard className="flex h-full flex-col p-4 sm:p-5">
          <PanelTitle
            icon={<LineChart size={18} />}
            title={t('Entradas vs. saídas (6 meses)', 'Inflows vs. outflows (6 months)')}
            subtitle={t('Fluxo de caixa mês a mês', 'Month-by-month cash flow')}
            action={
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <i className="size-2 rounded-full" style={{ background: C.ok }} /> {t('Entradas', 'Inflows')}
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="size-2 rounded-full" style={{ background: C.bad }} /> {t('Saídas', 'Outflows')}
                </span>
              </span>
            }
          />
          <div className="mt-3 flex flex-1 items-center">
            <AreaChart
              labels={series.map((s) => s.label)}
              series={[
                { name: 'in', color: C.ok, values: series.map((s) => s.inflow) },
                { name: 'out', color: C.bad, values: series.map((s) => s.outflow) },
              ]}
            />
          </div>
        </TCard>

        <TCard className="h-full p-4 sm:p-5">
          <PanelTitle icon={<PieChart size={18} />} title={t('Despesas por categoria', 'Expenses by category')} subtitle={period.label} />
          {cats.length === 0 ? (
            <p className="mt-8 text-center text-sm text-subtle">{t('Sem despesas no período.', 'No expenses in this period.')}</p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-5">
              <Donut segments={cats.map((c, i) => ({ label: cat(c.category), value: c.total, color: COLORS[i % COLORS.length] ?? C.accent }))} size={150} thickness={20}>
                <span className="text-[11px] text-subtle">Total</span>
                <span className="display num text-sm font-semibold">{money(catTotal)}</span>
              </Donut>
              <ul className="min-w-[180px] flex-1 space-y-2 text-sm">
                {cats.map((c, i) => (
                  <li key={c.category} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-muted">
                      <i className="size-2 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} /> <span className="truncate">{cat(c.category)}</span>
                    </span>
                    <span className="num flex shrink-0 items-baseline gap-2">
                      <span className="font-semibold">{money(c.total)}</span>
                      <span className="w-9 text-right text-xs text-subtle">{catTotal > 0 ? `${Math.round((c.total / catTotal) * 100)}%` : '—'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TCard>
      </div>

      <div className="grid items-stretch gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <TCard className="h-full overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:px-5">
            <PanelTitle icon={<Trophy size={18} />} title={t('Produtos mais vendidos', 'Top-selling products')} subtitle={period.label} />
            <Button
              variant="ghost"
              small
              disabled={top.length === 0}
              onClick={() => downloadCsv('top-products.csv', [[t('Produto', 'Product'), t('Qtd', 'Qty'), t('Receita', 'Revenue'), t('Lucro', 'Profit')], ...top.map((p) => [p.name, p.qty, p.revenue, p.profit])])}
            >
              <Download size={14} /> CSV
            </Button>
          </div>
          {top.length === 0 ? (
            <Empty icon={<BarChart3 size={22} />} title={t('Sem vendas no período', 'No sales in this period')} />
          ) : (
            <ol className="divide-y divide-line">
              {top.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3 p-4 sm:px-5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill/10 text-xs font-semibold text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold">{p.name}</span>
                      <span className="num shrink-0 whitespace-nowrap text-sm font-semibold">{money(p.revenue)}</span>
                    </div>
                    <div className="my-1.5">
                      <Bar value={p.revenue} max={topMax} />
                    </div>
                    <div className="flex justify-between gap-3 text-xs text-subtle">
                      <span className="num">
                        {num(p.qty)} {t('un.', 'units')}
                      </span>
                      <span className={`num ${p.profit < 0 ? 'text-bad' : 'text-ok'}`}>
                        {t('Lucro', 'Profit')} {money(p.profit)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </TCard>

        <TCard className="h-full p-4 sm:p-5">
          <PanelTitle icon={<FileSpreadsheet size={18} />} title={t('Exportar dados', 'Export data')} subtitle={t('Arquivos CSV para planilhas e contador', 'CSV files for spreadsheets and your accountant')} />
          <ul className="mt-4 space-y-2.5">
            {exports.map((x) => (
              <li key={x.id}>
                <button
                  onClick={x.run}
                  disabled={x.disabled}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-line bg-fill/5 px-4 text-left transition hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>
                    <span className="block text-sm font-semibold">{x.title}</span>
                    <span className="block text-xs text-subtle">{x.sub}</span>
                  </span>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-violet/15 text-violet">
                    <Download size={16} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </TCard>
      </div>
    </div>
  )
}
