import { useState } from 'react'
import { BookOpen, Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardTitle, Empty, Field, Modal, PageHeader, Tabs, TableWrap, inputCls, td, th } from '@/components/ui'
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
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar', 'Cancel')}
          </Button>
          <Button
            disabled={!(value > 0) || !description.trim()}
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
    <div className={`flex items-center justify-between py-2 text-sm ${strong ? 'border-t border-line font-semibold' : 'text-muted'}`}>
      <span>{label}</span>
      <span className={`num ${tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : strong ? 'text-ink' : ''}`}>{money(value)}</span>
    </div>
  )
}

export function Accounting() {
  const { data, removeEntry } = useStore()
  const [range, setRange] = useState<Range>('month')
  const [target, setTarget] = useState<Entry | 'new' | null>(null)
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all')
  const period = periodFor(range)
  const k = kpis(data, period)
  const cats = expensesByCategory(data, period).filter((c) => c.category !== CAT_PURCHASE && c.category !== CAT_SALES)
  const salesRev = data.sales.filter((s) => !s.canceledAt && inPeriod(s.date, period)).reduce((s, x) => s + x.total, 0)
  const entries = data.entries.filter((e) => inPeriod(e.date, period) && (filter === 'all' || e.type === filter))

  return (
    <div>
      <PageHeader
        title={t('Contabilidade', 'Accounting')}
        subtitle={t('Livro-caixa com entradas e saídas, e o resultado do período (DRE simplificada).', 'Cash book with inflows and outflows, plus the period result (simplified income statement).')}
        actions={
          <>
            <Tabs value={range} onChange={setRange} items={rangeTabs()} />
            <Button onClick={() => setTarget('new')}>
              <Plus size={16} /> {t('Lançamento', 'Entry')}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardTitle>{t('DRE', 'Income statement')} · {period.label}</CardTitle>
          <DreRow label={t('Receita de vendas', 'Sales revenue')} value={salesRev} />
          <DreRow label={t('Outras receitas', 'Other income')} value={k.revenue - salesRev} />
          <DreRow label={t('Receita bruta', 'Gross revenue')} value={k.revenue} strong />
          <DreRow label={t('(-) Custo das mercadorias vendidas', '(-) Cost of goods sold')} value={-k.cogs} />
          <DreRow label={t('Lucro bruto', 'Gross profit')} value={k.grossProfit} strong />
          {cats.map((c) => (
            <DreRow key={c.category} label={`(-) ${cat(c.category)}`} value={-c.total} />
          ))}
          <DreRow label={t('Lucro líquido', 'Net profit')} value={k.profit} strong tone={k.profit >= 0 ? 'ok' : 'bad'} />
          <p className="mt-3 text-xs text-subtle text-pretty">
            {t('Receitas e custo das mercadorias por competência (data da venda). Despesas pelo regime de caixa (data do pagamento). Compras de mercadorias entram via custo das vendas.', 'Revenue and cost of goods on an accrual basis (sale date). Expenses on a cash basis (payment date). Merchandise purchases flow through cost of goods sold.')}
          </p>
        </Card>

        <Card className="!p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
            <Tabs
              value={filter}
              onChange={setFilter}
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
          {entries.length === 0 ? (
            <Empty icon={<BookOpen size={22} />} title={t('Sem lançamentos no período', 'No entries in this period')} text={t('Vendas, pagamentos e recebimentos aparecem aqui automaticamente.', 'Sales, payments and receipts show up here automatically.')} />
          ) : (
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
                {entries.slice(0, 100).map((e) => (
                  <tr key={e.id}>
                    <td className={td}>{fmtDate(e.date)}</td>
                    <td className={td}>
                      <Badge tone={e.type === 'in' ? 'ok' : 'bad'}>{cat(e.category)}</Badge>
                    </td>
                    <td className={`${td} max-w-[280px] truncate`}>{e.description}</td>
                    <td className={`${td} num text-right font-semibold ${e.type === 'in' ? 'text-ok' : 'text-bad'}`}>
                      {e.type === 'in' ? '+' : '-'} {money(e.amount)}
                    </td>
                    <td className={`${td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <button
                          aria-label={t('Editar lançamento', 'Edit entry')}
                          onClick={() => setTarget(e)}
                          className="flex size-9 items-center justify-center rounded-lg text-subtle hover:text-ink"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          aria-label={t('Remover lançamento', 'Remove entry')}
                          onClick={() => removeEntry(e.id)}
                          className="flex size-9 items-center justify-center rounded-lg text-subtle hover:text-bad"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>

      <EntryModal target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
