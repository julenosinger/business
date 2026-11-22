import { useState } from 'react'
import { ArrowLeftRight, BookOpen, Download, Pencil, PiggyBank, Plus, Receipt, Scale, Trash2, TrendingUp } from 'lucide-react'
import { Badge, Button, Empty, Field, Modal, TableWrap, inputCls, td, th } from '@/components/ui'
import { DateField } from '@/components/DateField'
import { isValidIso } from '@/lib/dates'
import { Bar, C } from '@/components/charts'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { GeneralLedgerTab } from '@/components/accounting/GeneralLedgerTab'
import { ChartOfAccountsTab } from '@/components/accounting/ChartOfAccountsTab'
import { ReconciliationTab } from '@/components/accounting/ReconciliationTab'
import { useStore } from '@/lib/store'
import { expensesByCategory, inPeriod, kpis, monthPeriod, type Period } from '@/lib/selectors'
import { fmtDate, downloadCsv, iso, money, parseNum, today } from '@/lib/format'
import { cat, t } from '@/lib/i18n'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, CAT_PURCHASE, CAT_SALES, type Entry } from '@/lib/types'

type Range = 'month' | 'prev' | 'year'

export function periodFor(range: Range): Period {
  if (range === 'year') {
    const y = new Date().getFullYear()
    return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)), label: String(y) }
  }
  return monthPeriod(range === 'month' ? 0 : -1)
}

export const rangeTabs = (): { id: Range; label: string }[] => [
  { id: 'month', label: t('Este mês', 'This month') },
  { id: 'prev', label: t('Mês anterior', 'Last month') },
  { id: 'year', label: t('Ano', 'Year') },
]

function EntryModal({ target, onClose }: { target: Entry | 'new' | null; onClose: () => void }) {
  const { addEntry, updateEntry } = useStore()
  const editing = target && target !== 'new' ? target : null
  const [loaded, setLoaded] = useState<string | null>(null)
  const [type, setType] = useState<'in' | 'out'>('out')
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[2])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const value = parseNum(amount)
  const cats: readonly string[] = type === 'in' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const key = target === null ? null : editing ? editing.id : 'new'
  if (key !== loaded) {
    setLoaded(key)
    setType(editing?.type ?? 'out')
    setCategory(editing?.category ?? EXPENSE_CATEGORIES[2])
    setDescription(editing?.description ?? '')
    setAmount(editing ? String(editing.amount) : '')
    setDate(editing?.date ?? today())
  }

  const pick = (t: 'in' | 'out') => {
    setType(t)
    setCategory((t === 'in' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0])
  }

  return (
    <Modal open={target !== null} onClose={onClose} title={editing ? t('Editar lançamento', 'Edit entry') : t('Novo lançamento', 'New entry')}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <button onClick={() => pick('out')} className={`min-h-10 flex-1 rounded-xl text-sm font-semibold ${type === 'out' ? 'bg-bad/20 text-bad' : 'border border-line text-muted'}`}>
            {t('Saída', 'Outflow')}
          </button>
          <button onClick={() => pick('in')} className={`min-h-10 flex-1 rounded-xl text-sm font-semibold ${type === 'in' ? 'bg-ok/20 text-ok' : 'border border-line text-muted'}`}>
            {t('Entrada', 'Inflow')}
          </button>
        </div>
        <Field label={t('Categoria', 'Category')}>
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => (
              <option key={c} value={c}>
                {cat(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Descrição', 'Description')}>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Valor', 'Amount')}>
            <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
          </Field>
          <Field label={t('Data', 'Date')}>
            <DateField value={date} onChange={setDate} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar', 'Cancel')}
          </Button>
          <Button
            disabled={!(value > 0) || !description.trim() || !isValidIso(date)}
            onClick={() => {
              const payload = { type, category, description: description.trim(), amount: value, date }
              if (editing) updateEntry(editing.id, payload)
              else addEntry(payload)
              onClose()
            }}
          >
            {t('Salvar', 'Save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function DreRow({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: 'ok' | 'bad' }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2 text-sm ${strong ? 'border-t border-line font-semibold' : 'text-muted'}`}>
      <span>{label}</span>
      <span className={`num whitespace-nowrap ${tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : strong ? 'text-ink' : ''}`}>{money(value)}</span>
    </div>
  )
}

type AccountingTab = 'overview' | 'cashbook' | 'ledger' | 'chart' | 'reconciliation'

export function Accounting() {
  const { data, removeEntry } = useStore()
  const [range, setRange] = useState<Range>('month')
  const [tab, setTab] = useState<AccountingTab>('overview')
  const [target, setTarget] = useState<Entry | 'new' | null>(null)
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all')
  const [limit, setLimit] = useState(30)
  const period = periodFor(range)
  const k = kpis(data, period)
  const cats = expensesByCategory(data, period).filter((c) => c.category !== CAT_PURCHASE && c.category !== CAT_SALES)
  const salesRev = data.sales.filter((s) => !s.canceledAt && inPeriod(s.date, period)).reduce((s, x) => s + x.total, 0)
  const entries = data.entries.filter((e) => inPeriod(e.date, period) && (filter === 'all' || e.type === filter))
  const shown = entries.slice(0, limit)
  const margin = k.revenue > 0 ? (k.profit / k.revenue) * 100 : null
  const net = k.inflow - k.outflow
  const maxCat = Math.max(0, ...cats.map((c) => c.total))
  const totalCats = cats.reduce((s, c) => s + c.total, 0)

  const pickRange = (r: Range) => {
    setRange(r)
    setLimit(30)
  }
  const pickFilter = (f: 'all' | 'in' | 'out') => {
    setFilter(f)
    setLimit(30)
  }

  const rowActions = (e: Entry) => (
    <div className="flex justify-end gap-1">
      <button
        aria-label={t('Editar lançamento', 'Edit entry')}
        onClick={() => setTarget(e)}
        className="flex size-9 items-center justify-center rounded-lg text-subtle hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
      >
        <Pencil size={15} />
      </button>
      <button
        aria-label={t('Remover lançamento', 'Remove entry')}
        onClick={() => removeEntry(e.id)}
        className="flex size-9 items-center justify-center rounded-lg text-subtle hover:bg-fill/10 hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title={t('Contabilidade', 'Accounting')}
        subtitle={t('Livro-caixa com entradas e saídas, e o resultado do período (DRE simplificada).', 'Cash book with inflows and outflows, plus the period result (simplified income statement).')}
        actions={
          tab === 'overview' || tab === 'cashbook' ? (
            <>
              <PillTabs label={t('Período', 'Period')} value={range} onChange={pickRange} items={rangeTabs()} />
              <Button onClick={() => setTarget('new')}>
                <Plus size={16} /> {t('Lançamento', 'Entry')}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="overflow-x-auto">
        <PillTabs
          label={t('Seções da contabilidade', 'Accounting sections')}
          value={tab}
          onChange={setTab}
          items={[
            { id: 'overview', label: t('Visão geral', 'Overview') },
            { id: 'cashbook', label: t('Livro-Caixa', 'Cash Book') },
            { id: 'ledger', label: t('Razão Geral', 'General Ledger') },
            { id: 'chart', label: t('Plano de contas', 'Chart of Accounts') },
            { id: 'reconciliation', label: t('Conciliação', 'Reconciliation') },
          ]}
        />
      </div>

      {tab === 'overview' ? (
        <>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="ok" icon={<TrendingUp size={20} />} label={t('Receita bruta', 'Gross revenue')} value={money(k.revenue)} sub={`${t('Vendas', 'Sales')} ${money(salesRev)}`} />
        <KpiTile
          tone="warn"
          icon={<Receipt size={20} />}
          label={t('Custos e despesas', 'Costs and expenses')}
          value={money(k.cogs + k.opex)}
          sub={`${t('CMV', 'COGS')} ${money(k.cogs)} · ${t('Desp.', 'Exp.')} ${money(k.opex)}`}
        />
        <KpiTile
          tone="violet"
          icon={<PiggyBank size={20} />}
          label={t('Lucro líquido', 'Net profit')}
          value={money(k.profit)}
          valueTone={k.profit < 0 ? 'bad' : undefined}
          sub={margin === null ? t('Sem receita no período', 'No revenue in this period') : `${margin.toFixed(1).replace('.', t(',', '.'))}% ${t('de margem', 'margin')}`}
        />
        <KpiTile
          tone="sky"
          icon={<ArrowLeftRight size={20} />}
          label={t('Fluxo de caixa', 'Cash flow')}
          value={money(net)}
          valueTone={net < 0 ? 'bad' : undefined}
          sub={`+${money(k.inflow)} / -${money(k.outflow)}`}
        />
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
          <TCard className="h-full p-4 sm:p-5">
            <PanelTitle icon={<Scale size={18} />} title={t('DRE', 'Income statement')} subtitle={period.label} />
            <div className="mt-3">
              <DreRow label={t('Receita de vendas', 'Sales revenue')} value={salesRev} />
              <DreRow label={t('Outras receitas', 'Other income')} value={k.revenue - salesRev} />
              <DreRow label={t('Receita bruta', 'Gross revenue')} value={k.revenue} strong />
              <DreRow label={t('(-) Custo das mercadorias vendidas', '(-) Cost of goods sold')} value={-k.cogs} />
              <DreRow label={t('Lucro bruto', 'Gross profit')} value={k.grossProfit} strong />
              {cats.map((c) => (
                <DreRow key={c.category} label={`(-) ${cat(c.category)}`} value={-c.total} />
              ))}
              <DreRow label={t('Lucro líquido', 'Net profit')} value={k.profit} strong tone={k.profit >= 0 ? 'ok' : 'bad'} />
            </div>
            <p className="mt-3 text-xs text-subtle text-pretty">
              {t('Receitas e custo das mercadorias por competência (data da venda). Despesas pelo regime de caixa (data do pagamento). Compras de mercadorias entram via custo das vendas.', 'Revenue and cost of goods on an accrual basis (sale date). Expenses on a cash basis (payment date). Merchandise purchases flow through cost of goods sold.')}
            </p>
          </TCard>

          <TCard className="h-full p-4 sm:p-5">
              <PanelTitle icon={<Receipt size={18} />} title={t('Despesas por categoria', 'Expenses by category')} subtitle={t('Peso de cada categoria no período', 'Weight of each category in the period')} />
              {cats.length === 0 ? (
                <p className="mt-6 text-center text-sm text-subtle">{t('Sem despesas no período.', 'No expenses in this period.')}</p>
              ) : (
              <ul className="mt-4 space-y-3">
                {cats.map((c) => (
                  <li key={c.category}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-muted">{cat(c.category)}</span>
                      <span className="num flex shrink-0 items-baseline gap-2">
                        <span className="font-semibold">{money(c.total)}</span>
                        <span className="w-10 text-right text-xs text-subtle">{totalCats > 0 ? `${Math.round((c.total / totalCats) * 100)}%` : '—'}</span>
                      </span>
                    </div>
                    <Bar value={c.total} max={maxCat} color={C.warn} />
                  </li>
                ))}
              </ul>
              )}
            </TCard>
        </div>

        </>
      ) : null}

      {tab === 'cashbook' ? (
      <TCard className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:px-5">
            <PanelTitle
              icon={<BookOpen size={18} />}
              title={t('Livro-caixa', 'Cash book')}
              subtitle={`${entries.length} ${entries.length === 1 ? t('lançamento', 'entry') : t('lançamentos', 'entries')} · ${period.label}`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <PillTabs
                label={t('Tipo', 'Type')}
                value={filter}
                onChange={pickFilter}
                items={[
                  { id: 'all', label: t('Todos', 'All') },
                  { id: 'in', label: t('Entradas', 'Inflows') },
                  { id: 'out', label: t('Saídas', 'Outflows') },
                ]}
              />
              <Button
                variant="ghost"
                small
                disabled={entries.length === 0}
                onClick={() =>
                  downloadCsv('cash-book.csv', [
                    [t('Data', 'Date'), t('Tipo', 'Type'), t('Categoria', 'Category'), t('Descrição', 'Description'), t('Valor', 'Amount')],
                    ...entries.map((e) => [fmtDate(e.date), e.type === 'in' ? t('Entrada', 'Inflow') : t('Saída', 'Outflow'), cat(e.category), e.description, e.amount]),
                  ])
                }
              >
                <Download size={14} /> CSV
              </Button>
            </div>
          </div>

          {entries.length === 0 ? (
            <Empty icon={<BookOpen size={22} />} title={t('Sem lançamentos no período', 'No entries in this period')} text={t('Vendas, pagamentos e recebimentos aparecem aqui automaticamente.', 'Sales, payments and receipts show up here automatically.')} />
          ) : (
            <>
              <div className="hidden md:block">
                <TableWrap>
                  <thead>
                    <tr>
                      <th className={th}>{t('Data', 'Date')}</th>
                      <th className={th}>{t('Categoria', 'Category')}</th>
                      <th className={th}>{t('Descrição', 'Description')}</th>
                      <th className={`${th} text-right`}>{t('Valor', 'Amount')}</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr key={e.id} className="transition hover:bg-fill/5">
                        <td className={td}>{fmtDate(e.date)}</td>
                        <td className={td}>
                          <Badge tone={e.type === 'in' ? 'ok' : 'bad'}>{cat(e.category)}</Badge>
                        </td>
                        <td className={`${td} max-w-[280px] truncate`}>{e.description}</td>
                        <td className={`${td} num text-right font-semibold ${e.type === 'in' ? 'text-ok' : 'text-bad'}`}>
                          {e.type === 'in' ? '+' : '-'} {money(e.amount)}
                        </td>
                        <td className={`${td} text-right`}>{rowActions(e)}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>

              <ul className="divide-y divide-line md:hidden">
                {shown.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={e.type === 'in' ? 'ok' : 'bad'}>{cat(e.category)}</Badge>
                        <span className="text-xs text-subtle">{fmtDate(e.date)}</span>
                      </div>
                      <p className="mt-1.5 truncate text-sm">{e.description}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`num whitespace-nowrap text-sm font-semibold ${e.type === 'in' ? 'text-ok' : 'text-bad'}`}>
                        {e.type === 'in' ? '+' : '-'} {money(e.amount)}
                      </div>
                      <div className="mt-1">{rowActions(e)}</div>
                    </div>
                  </li>
                ))}
              </ul>

              {entries.length > shown.length ? (
                <div className="border-t border-line p-3 text-center">
                  <Button variant="ghost" small onClick={() => setLimit((l) => l + 30)}>
                    {t('Ver mais', 'View more')} ({entries.length - shown.length})
                  </Button>
                </div>
              ) : null}
            </>
          )}
      </TCard>
      ) : null}

      {tab === 'ledger' ? <GeneralLedgerTab /> : null}
      {tab === 'chart' ? <ChartOfAccountsTab /> : null}
      {tab === 'reconciliation' ? <ReconciliationTab /> : null}

      <EntryModal target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
