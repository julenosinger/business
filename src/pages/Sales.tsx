import { useMemo, useState } from 'react'
import { Check, Minus, Plus, Receipt, Search, ShoppingCart, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, CardTitle, Empty, Field, PageHeader, TableWrap, inputCls, td, th } from '@/components/ui'
import { useStore } from '@/lib/store'
import { addDays, fmtDate, money, num, today } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { PayMethod } from '@/lib/types'

const methods = (): { id: PayMethod; label: string }[] => [
  { id: 'pix', label: 'Pix' },
  { id: 'cartao', label: t('Cartão', 'Card') },
  { id: 'dinheiro', label: t('Dinheiro', 'Cash') },
  { id: 'usdc', label: 'USDC' },
  { id: 'prazo', label: t('A prazo', 'On credit') },
]

export function Sales() {
  const { data, recordSale, cancelSale } = useStore()
  const [limit, setLimit] = useState(20)
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [customerId, setCustomerId] = useState('')
  const [method, setMethod] = useState<PayMethod>('pix')
  const [dueDate, setDueDate] = useState(addDays(today(), 30))

  const customers = data.contacts.filter((c) => c.kind === 'customer')
  const products = useMemo(() => {
    const s = q.trim().toLowerCase()
    return data.products.filter((p) => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
  }, [data.products, q])

  const lines = Object.entries(cart).flatMap(([id, qty]) => {
    const p = data.products.find((x) => x.id === id)
    return p ? [{ p, qty }] : []
  })
  const total = lines.reduce((s, l) => s + l.qty * l.p.price, 0)
  const overStock = lines.some((l) => l.qty > l.p.stock)

  const add = (id: string) => {
    const p = data.products.find((x) => x.id === id)
    if (!p) return
    setCart((c) => ({ ...c, [id]: Math.min(p.stock, (c[id] ?? 0) + 1) }))
  }
  const dec = (id: string) =>
    setCart((c) => {
      const next = { ...c, [id]: (c[id] ?? 0) - 1 }
      if ((next[id] ?? 0) <= 0) delete next[id]
      return next
    })

  const finish = () => {
    recordSale({
      customerId: customerId || undefined,
      method,
      dueDate: method === 'prazo' ? dueDate : undefined,
      items: lines.map((l) => ({ productId: l.p.id, qty: l.qty, price: l.p.price })),
    })
    toast.success(method === 'prazo' ? t('Venda registrada como conta a receber.', 'Sale recorded as a receivable.') : t('Venda registrada e caixa atualizado.', 'Sale recorded and cash updated.'))
    setCart({})
    setCustomerId('')
  }

  return (
    <div>
      <PageHeader
        title={t('Vendas e PDV', 'Sales and POS')}
        subtitle={t('Registre vendas no balcão. O estoque baixa e o caixa (ou contas a receber) atualiza na hora.', 'Record counter sales. Stock goes down and cash (or receivables) updates instantly.')}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-fill/5 px-3">
            <Search size={16} className="text-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('Buscar produto', 'Search product')}
              aria-label={t('Buscar produto', 'Search product')}
              className="min-h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
            />
          </div>
          {products.length === 0 ? (
            <Empty icon={<ShoppingCart size={22} />} title={t('Sem produtos', 'No products')} text={t('Cadastre produtos no estoque para começar a vender.', 'Add products to inventory to start selling.')} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {products.map((p) => {
                const inCart = cart[p.id] ?? 0
                const out = p.stock <= 0
                return (
                  <button
                    key={p.id}
                    disabled={out || inCart >= p.stock}
                    onClick={() => add(p.id)}
                    className="relative flex min-h-24 flex-col items-start justify-between rounded-2xl border border-line bg-fill/5 p-3 text-left transition hover:bg-surface-strong disabled:opacity-50"
                  >
                    {inCart > 0 ? <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-ink">{inCart}</span> : null}
                    <span className="pr-6 text-sm font-semibold leading-snug">{p.name}</span>
                    <span>
                      <span className="num block text-sm text-accent">{money(p.price)}</span>
                      <span className="text-xs text-subtle">{out ? t('Sem estoque', 'Out of stock') : t(`${num(p.stock)} em estoque`, `${num(p.stock)} in stock`)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Card>

        <Card className="h-fit lg:sticky lg:top-24">
          <CardTitle>{t('Carrinho', 'Cart')}</CardTitle>
          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t('Toque em um produto para adicionar.', 'Tap a product to add it.')}</p>
          ) : (
            <ul className="space-y-2">
              {lines.map((l) => (
                <li key={l.p.id} className="flex items-center gap-2 rounded-xl bg-fill/5 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{l.p.name}</div>
                    <div className="num text-xs text-subtle">{money(l.p.price)} {t('cada', 'each')}</div>
                  </div>
                  <button aria-label={t('Diminuir', 'Decrease')} onClick={() => dec(l.p.id)} className="flex size-9 items-center justify-center rounded-lg border border-line">
                    <Minus size={14} />
                  </button>
                  <span className="num w-6 text-center text-sm font-semibold">{l.qty}</span>
                  <button aria-label={t('Aumentar', 'Increase')} onClick={() => add(l.p.id)} disabled={l.qty >= l.p.stock} className="flex size-9 items-center justify-center rounded-lg border border-line disabled:opacity-40">
                    <Plus size={14} />
                  </button>
                  <button aria-label={t('Remover', 'Remove')} onClick={() => setCart((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== l.p.id)))} className="flex size-9 items-center justify-center rounded-lg text-bad">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 space-y-3">
            <Field label={t('Cliente', 'Customer')}>
              <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">{t('Consumidor final', 'Walk-in customer')}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <span className="label mb-1.5 block">{t('Pagamento', 'Payment')}</span>
              <div className="flex flex-wrap gap-2">
                {methods().map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${method === m.id ? 'bg-accent text-accent-ink' : 'border border-line text-muted'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {method === 'prazo' ? (
              <Field label={t('Vencimento', 'Due date')}>
                <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            ) : null}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
            <span className="text-sm text-muted">Total</span>
            <span className="display num text-2xl font-semibold">{money(total)}</span>
          </div>
          <Button className="mt-3 w-full" disabled={lines.length === 0 || overStock} onClick={finish}>
            <Check size={16} /> {t('Finalizar venda', 'Complete sale')}
          </Button>
        </Card>
      </div>

      <Card className="mt-6 !p-0">
        <div className="border-b border-line p-4">
          <h3 className="display flex items-center gap-2 text-base font-semibold">
            <Receipt size={18} className="text-accent" /> {t('Vendas recentes', 'Recent sales')}
          </h3>
        </div>
        {data.sales.length === 0 ? (
          <Empty icon={<Receipt size={22} />} title={t('Nenhuma venda ainda', 'No sales yet')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>{t('Data', 'Date')}</th>
                <th className={th}>{t('Cliente', 'Customer')}</th>
                <th className={th}>{t('Itens', 'Items')}</th>
                <th className={th}>{t('Pagamento', 'Payment')}</th>
                <th className={`${th} text-right`}>Total</th>
                <th className={`${th} text-right`}>{t('Lucro bruto', 'Gross profit')}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {data.sales.slice(0, limit).map((s) => (
                <tr key={s.id} className={s.canceledAt ? 'opacity-60' : undefined}>
                  <td className={td}>{fmtDate(s.date)}</td>
                  <td className={td}>{s.customerName}</td>
                  <td className={`${td} max-w-[260px] truncate`}>{s.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</td>
                  <td className={td}>
                    <Badge tone={s.method === 'prazo' ? 'warn' : 'neutral'}>{methods().find((m) => m.id === s.method)?.label}</Badge>
                  </td>
                  <td className={`${td} num text-right font-semibold`}>{money(s.total)}</td>
                  <td className={`${td} num text-right text-ok`}>{s.canceledAt ? '-' : money(s.total - s.cogs)}</td>
                  <td className={`${td} text-right`}>
                    {s.canceledAt ? (
                      <Badge tone="bad">{t('Cancelada', 'Canceled')}</Badge>
                    ) : (
                      <Button
                        small
                        variant="ghost"
                        onClick={() => {
                          if (
                            window.confirm(
                              t(
                                'Cancelar esta venda? O estoque volta e o valor é estornado no caixa.',
                                'Cancel this sale? Stock is restored and the amount is refunded in cash.',
                              ),
                            )
                          )
                            cancelSale(s.id)
                        }}
                      >
                        <Undo2 size={14} /> {t('Cancelar', 'Cancel')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        {data.sales.length > limit ? (
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" small onClick={() => setLimit((l) => l + 30)}>
              {t('Ver mais vendas', 'Show more sales')}
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  )
}
