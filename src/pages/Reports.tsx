import { useState } from 'react'
import { BarChart3, Download } from 'lucide-react'
import { AreaChart, Bar, C, Donut } from '@/components/charts'
import { Button, Card, CardTitle, Empty, PageHeader, Tabs, TableWrap, td, th } from '@/components/ui'
import { periodFor, rangeTabs } from '@/pages/Accounting'
import { useStore } from '@/lib/store'
import { expensesByCategory, kpis, monthlySeries, topProducts } from '@/lib/selectors'
import { fmtDate, downloadCsv, money, num } from '@/lib/format'
import { cat, t } from '@/lib/i18n'

const COLORS = [C.accent, C.ok, C.warn, C.bad, '#8b7bd8', '#3aa6b0', '#d1679f']

export function Reports() {
  const { data } = useStore()
  const [range, setRange] = useState<'month' | 'prev' | 'year'>('month')
  const period = periodFor(range)
  const k = kpis(data, period)
  const cats = expensesByCategory(data, period)
  const top = topProducts(data, period, 8)
  const series = monthlySeries(data, 6)
  const catTotal = cats.reduce((s, c) => s + c.total, 0)
  const margin = k.revenue > 0 ? (k.profit / k.revenue) * 100 : 0
  const topMax = Math.max(...top.map((t) => t.revenue), 1)

  return (
    <div>
      <PageHeader
        title={t('Relatórios e BI', 'Reports and BI')}
        subtitle={t(`Indicadores de ${period.label}.`, `Indicators for ${period.label}.`)}
        actions={<Tabs value={range} onChange={setRange} items={rangeTabs()} />}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>{t('Resultado do período', 'Period result')}</CardTitle>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="label">{t('Receita', 'Revenue')}</dt>
              <dd className="display num mt-1 text-xl font-semibold">{money(k.revenue)}</dd>
            </div>
            <div>
              <dt className="label">{t('Lucro líquido', 'Net profit')}</dt>
              <dd className={`display num mt-1 text-xl font-semibold ${k.profit < 0 ? 'text-bad' : 'text-ok'}`}>{money(k.profit)}</dd>
            </div>
            <div>
              <dt className="label">{t('Margem líquida', 'Net margin')}</dt>
              <dd className="display num mt-1 text-xl font-semibold">{num(margin)}%</dd>
            </div>
            <div>
              <dt className="label">{t('Lucro bruto', 'Gross profit')}</dt>
              <dd className="display num mt-1 text-xl font-semibold">{money(k.grossProfit)}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardTitle>{t('Despesas por categoria', 'Expenses by category')}</CardTitle>
          {cats.length === 0 ? (
            <p className="text-sm text-muted">{t('Sem despesas no período.', 'No expenses in this period.')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-5">
              <Donut segments={cats.map((c, i) => ({ label: cat(c.category), value: c.total, color: COLORS[i % COLORS.length] ?? C.accent }))} size={150} thickness={20}>
                <span className="text-[11px] text-subtle">Total</span>
                <span className="display num text-sm font-semibold">{money(catTotal)}</span>
              </Donut>
              <ul className="min-w-[180px] flex-1 space-y-2 text-sm">
                {cats.map((c, i) => (
                  <li key={c.category} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-muted">
                      <i className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} /> {cat(c.category)}
                    </span>
                    <span className="num font-semibold">{money(c.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>{t('Entradas vs. saídas (6 meses)', 'Inflows vs. outflows (6 months)')}</CardTitle>
          <AreaChart
            labels={series.map((s) => s.label)}
            series={[
              { name: 'in', color: C.ok, values: series.map((s) => s.inflow) },
              { name: 'out', color: C.bad, values: series.map((s) => s.outflow) },
            ]}
          />
        </Card>

        <Card className="!p-0">
          <div className="flex items-center justify-between border-b border-line p-4">
            <h3 className="display text-base font-semibold">{t('Produtos mais vendidos', 'Top-selling products')}</h3>
            <Button
              variant="ghost"
              small
              disabled={top.length === 0}
              onClick={() =>
                downloadCsv('top-products.csv', [[t('Produto', 'Product'), t('Qtd', 'Qty'), t('Receita', 'Revenue'), t('Lucro', 'Profit')], ...top.map((t) => [t.name, t.qty, t.revenue, t.profit])])
              }
            >
              <Download size={14} /> CSV
            </Button>
          </div>
          {top.length === 0 ? (
            <Empty icon={<BarChart3 size={22} />} title={t('Sem vendas no período', 'No sales in this period')} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>{t('Produto', 'Product')}</th>
                  <th className={`${th} text-right`}>{t('Qtd', 'Qty')}</th>
                  <th className={`${th} text-right`}>{t('Receita', 'Revenue')}</th>
                  <th className={`${th} text-right`}>{t('Lucro', 'Profit')}</th>
                </tr>
              </thead>
              <tbody>
                {top.map((t) => (
                  <tr key={t.name}>
                    <td className={td}>
                      <div className="mb-1 font-semibold">{t.name}</div>
                      <Bar value={t.revenue} max={topMax} />
                    </td>
                    <td className={`${td} num text-right`}>{num(t.qty)}</td>
                    <td className={`${td} num text-right`}>{money(t.revenue)}</td>
                    <td className={`${td} num text-right text-ok`}>{money(t.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardTitle>{t('Exportar dados', 'Export data')}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={data.sales.every((s) => s.canceledAt)}
            onClick={() =>
              downloadCsv('sales.csv', [
                [t('Data', 'Date'), t('Cliente', 'Customer'), t('Pagamento', 'Payment'), 'Total', t('Custo', 'Cost')],
                ...data.sales.filter((s) => !s.canceledAt).map((s) => [fmtDate(s.date), s.customerName, s.method, s.total, s.cogs]),
              ])
            }
          >
            <Download size={14} /> {t('Vendas', 'Sales')}
          </Button>
          <Button
            variant="ghost"
            disabled={data.products.length === 0}
            onClick={() =>
              downloadCsv('inventory.csv', [
                ['SKU', t('Produto', 'Product'), t('Categoria', 'Category'), t('Estoque', 'Stock'), t('Mínimo', 'Minimum'), t('Custo', 'Cost'), t('Preço', 'Price')],
                ...data.products.map((p) => [p.sku, p.name, p.category, p.stock, p.minStock, p.cost, p.price]),
              ])
            }
          >
            <Download size={14} /> {t('Estoque', 'Inventory')}
          </Button>
          <Button
            variant="ghost"
            disabled={data.accounts.length === 0}
            onClick={() =>
              downloadCsv('bills.csv', [
                [t('Tipo', 'Type'), t('Descrição', 'Description'), t('Parte', 'Party'), t('Vencimento', 'Due date'), t('Valor', 'Amount'), t('Situação', 'Status')],
                ...data.accounts.map((a) => [a.kind === 'payable' ? t('A pagar', 'Payable') : t('A receber', 'Receivable'), a.description, a.contactName, fmtDate(a.dueDate), a.amount, a.status === 'paid' ? t('Liquidada', 'Settled') : t('Em aberto', 'Open')]),
              ])
            }
          >
            <Download size={14} /> {t('Contas', 'Bills')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
