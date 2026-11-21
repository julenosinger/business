import { useState } from 'react'
import { Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, CardTitle, Empty, Field, PageHeader, TableWrap, inputCls, td, th } from '@/components/ui'
import { useStore } from '@/lib/store'
import { addDays, fmtDate, money, parseNum, today } from '@/lib/format'
import { t } from '@/lib/i18n'
import { CAT_PURCHASE } from '@/lib/types'

interface Line {
  key: number
  productId: string
  qty: string
  cost: string
}

let seq = 1

export function Purchases() {
  const { data, recordPurchase } = useStore()
  const suppliers = data.contacts.filter((c) => c.kind === 'supplier')
  const [supplierId, setSupplierId] = useState('')
  const [paidNow, setPaidNow] = useState(false)
  const [dueDate, setDueDate] = useState(addDays(today(), 15))
  const [lines, setLines] = useState<Line[]>([{ key: seq++, productId: '', qty: '', cost: '' }])

  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const parsed = lines.map((l) => ({ ...l, q: parseNum(l.qty), c: parseNum(l.cost) }))
  const valid = parsed.length > 0 && parsed.every((l) => l.productId && l.q > 0 && l.c >= 0 && !Number.isNaN(l.c))
  const total = parsed.reduce((s, l) => s + (l.q > 0 && l.c >= 0 ? l.q * l.c : 0), 0)

  const submit = () => {
    recordPurchase({
      supplierId: supplierId || undefined,
      paidNow,
      dueDate,
      items: parsed.map((l) => ({ productId: l.productId, qty: l.q, cost: l.c })),
    })
    toast.success(paidNow ? t('Compra registrada e paga.', 'Purchase recorded and paid.') : t('Compra registrada como conta a pagar.', 'Purchase recorded as a payable.'))
    setLines([{ key: seq++, productId: '', qty: '', cost: '' }])
    setSupplierId('')
  }

  const history = [
    ...data.entries.filter((e) => e.category === CAT_PURCHASE).map((e) => ({ id: e.id, date: e.date, desc: e.description, amount: e.amount, paid: true })),
    ...data.accounts
      .filter((a) => a.kind === 'payable' && a.category === CAT_PURCHASE && a.status === 'open')
      .map((a) => ({ id: a.id, date: a.dueDate, desc: a.description, amount: a.amount, paid: false })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20)

  return (
    <div>
      <PageHeader
        title={t('Compras', 'Purchases')}
        subtitle={t('Registre a entrada de mercadorias. O estoque e o custo são atualizados, e o pagamento vira caixa ou conta a pagar.', 'Record incoming goods. Stock and cost are updated, and payment becomes cash out or a payable.')}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardTitle>{t('Nova compra', 'New purchase')}</CardTitle>
          {data.products.length === 0 ? (
            <Empty icon={<ShoppingBag size={22} />} title={t('Cadastre produtos primeiro', 'Add products first')} text={t('Para comprar, os produtos precisam existir no estoque.', 'To buy, products must exist in inventory.')} />
          ) : (
            <div className="space-y-4">
              <Field label={t('Fornecedor', 'Supplier')} hint={suppliers.length ? undefined : t('Cadastre fornecedores na aba Fornecedores.', 'Add suppliers in the Suppliers tab.')}>
                <select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">{t('Fornecedor avulso', 'One-off supplier')}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="space-y-2">
                <span className="label block">{t('Itens', 'Items')}</span>
                {lines.map((l) => (
                  <div key={l.key} className="grid grid-cols-[1fr_72px_96px_40px] items-center gap-2">
                    <select
                      aria-label={t('Produto', 'Product')}
                      className={inputCls}
                      value={l.productId}
                      onChange={(e) => {
                        const p = data.products.find((x) => x.id === e.target.value)
                        patch(l.key, { productId: e.target.value, cost: p && !l.cost ? String(p.cost) : l.cost })
                      }}
                    >
                      <option value="">{t('Produto', 'Product')}</option>
                      {data.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input aria-label={t('Quantidade', 'Quantity')} className={inputCls} inputMode="decimal" placeholder={t('Qtd', 'Qty')} value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} />
                    <input aria-label={t('Custo unitário', 'Unit cost')} className={inputCls} inputMode="decimal" placeholder={t('Custo', 'Cost')} value={l.cost} onChange={(e) => patch(l.key, { cost: e.target.value })} />
                    <button
                      aria-label={t('Remover item', 'Remove item')}
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      className="flex size-10 items-center justify-center rounded-lg text-bad disabled:opacity-30"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <Button variant="ghost" small onClick={() => setLines((ls) => [...ls, { key: seq++, productId: '', qty: '', cost: '' }])}>
                  <Plus size={14} /> {t('Adicionar item', 'Add item')}
                </Button>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setPaidNow(false)} className={`min-h-10 flex-1 rounded-xl text-sm font-semibold ${!paidNow ? 'bg-accent text-accent-ink' : 'border border-line text-muted'}`}>
                  {t('A prazo', 'On credit')}
                </button>
                <button onClick={() => setPaidNow(true)} className={`min-h-10 flex-1 rounded-xl text-sm font-semibold ${paidNow ? 'bg-accent text-accent-ink' : 'border border-line text-muted'}`}>
                  {t('Pago agora', 'Paid now')}
                </button>
              </div>
              {!paidNow ? (
                <Field label={t('Vencimento', 'Due date')}>
                  <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </Field>
              ) : null}

              <div className="flex items-center justify-between border-t border-line pt-4">
                <span className="text-sm text-muted">{t('Total da compra', 'Purchase total')}</span>
                <span className="display num text-xl font-semibold">{money(total)}</span>
              </div>
              <Button className="w-full" disabled={!valid} onClick={submit}>
                {t('Registrar compra', 'Record purchase')}
              </Button>
            </div>
          )}
        </Card>

        <Card className="!p-0">
          <div className="border-b border-line p-4">
            <h3 className="display text-base font-semibold">{t('Compras recentes', 'Recent purchases')}</h3>
          </div>
          {history.length === 0 ? (
            <Empty icon={<ShoppingBag size={22} />} title={t('Nenhuma compra registrada', 'No purchases recorded')} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>{t('Data', 'Date')}</th>
                  <th className={th}>{t('Descrição', 'Description')}</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>{t('Valor', 'Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className={td}>{fmtDate(h.date)}</td>
                    <td className={`${td} max-w-[200px] truncate`}>{h.desc}</td>
                    <td className={td}>{h.paid ? <Badge tone="ok">{t('Paga', 'Paid')}</Badge> : <Badge tone="warn">{t('A pagar', 'Payable')}</Badge>}</td>
                    <td className={`${td} num text-right font-semibold`}>{money(h.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </div>
  )
}
