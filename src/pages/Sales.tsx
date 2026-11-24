import { useEffect, useMemo, useState } from 'react'
import { BarChart3, CalendarDays, Check, Coins, Minus, Plus, Receipt, Search, ShoppingCart, Tag, Trash2, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty, Field, TableWrap, inputCls, td, th } from '@/components/ui'
import { DateField } from '@/components/DateField'
import { isValidIso } from '@/lib/dates'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { useStore } from '@/lib/store'
import { useNav, type ProfileIntent } from '@/lib/nav'
import { useNetwork } from '@/lib/network'
import { contactsForEnvironment, inPeriod, monthPeriod, productsForEnvironment, salesForEnvironment } from '@/lib/selectors'
import { addDays, fmtDate, money, num, today } from '@/lib/format'
import { quantityError, type QuantityError } from '@/lib/quantity'
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
  const { profileIntent, clearProfileIntent } = useNav()
  const network = useNetwork()
  const catalogProducts = productsForEnvironment(data, network)
  const scopedSales = salesForEnvironment(data, network)
  const [limit, setLimit] = useState(20)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('all')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [customerId, setCustomerId] = useState('')
  const [method, setMethod] = useState<PayMethod>('pix')
  const [dueDate, setDueDate] = useState(addDays(today(), 30))
  const [salesFilter, setSalesFilter] = useState<{ id: string; name: string } | null>(null)

  const customers = contactsForEnvironment(data, network).filter((c) => c.kind === 'customer')

  // Consome a intenção de navegação vinda de um perfil (uma única vez por navegação).
  const [seenIntent, setSeenIntent] = useState<ProfileIntent | null>(null)
  if (profileIntent && profileIntent !== seenIntent) {
    setSeenIntent(profileIntent)
    if (profileIntent.kind === 'sale') {
      if (customers.some((c) => c.id === profileIntent.customerId)) setCustomerId(profileIntent.customerId)
    } else if (profileIntent.kind === 'sales') {
      if (customers.some((c) => c.id === profileIntent.customerId)) setSalesFilter({ id: profileIntent.customerId, name: profileIntent.customerName })
    }
  } else if (!profileIntent && seenIntent) {
    setSeenIntent(null)
  }
  useEffect(() => {
    if (profileIntent) clearProfileIntent()
  }, [profileIntent, clearProfileIntent])

  const categories = useMemo(() => [...new Set(catalogProducts.map((p) => p.category).filter(Boolean))].sort(), [catalogProducts])
  const products = useMemo(() => {
    const s = q.trim().toLowerCase()
    return catalogProducts.filter((p) => (category === 'all' || p.category === category) && (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)))
  }, [catalogProducts, q, category])

  const lines = Object.entries(cart).flatMap(([id, qty]) => {
    const p = catalogProducts.find((x) => x.id === id)
    return p ? [{ p, qty }] : []
  })
  const total = lines.reduce((s, l) => s + l.qty * l.p.price, 0)
  const overStock = lines.some((l) => l.qty > l.p.stock)
  const itemCount = lines.reduce((s, l) => s + l.qty, 0)
  // Linhas com quantidade digitada inválida (vazio/zero/negativo/científico/acima do estoque) bloqueiam a finalização.
  const invalidLines = lines.filter((l) => {
    const raw = drafts[l.p.id]
    return raw !== undefined && quantityError(raw, l.p.stock) !== null
  })
  const hasInvalidQty = invalidLines.length > 0

  const live = scopedSales.filter((s) => !s.canceledAt)
  // Vendas exibidas na lista (filtro opcional por cliente, vindo do perfil).
  const shownSales = salesFilter ? scopedSales.filter((s) => s.customerId === salesFilter.id) : scopedSales
  const day = today()
  const todaySales = live.filter((s) => s.date === day)
  const month = monthPeriod(0)
  const monthSales = live.filter((s) => inPeriod(s.date, month))
  const monthTotal = monthSales.reduce((s, x) => s + x.total, 0)
  const monthProfit = monthSales.reduce((s, x) => s + (x.total - x.cogs), 0)
  const ticket = monthSales.length > 0 ? monthTotal / monthSales.length : 0
  const saleCount = (n: number) => `${n} ${n === 1 ? t('venda', 'sale') : t('vendas', 'sales')}`

  const clearDraft = (id: string) =>
    setDrafts((d) => {
      if (!(id in d)) return d
      const { [id]: _drop, ...rest } = d
      return rest
    })

  const add = (id: string) => {
    const p = catalogProducts.find((x) => x.id === id)
    if (!p) return
    clearDraft(id)
    setCart((c) => ({ ...c, [id]: Math.min(p.stock, (c[id] ?? 0) + 1) }))
  }
  const dec = (id: string) => {
    clearDraft(id)
    setCart((c) => {
      const next = { ...c, [id]: (c[id] ?? 0) - 1 }
      if ((next[id] ?? 0) <= 0) delete next[id]
      return next
    })
  }

  const changeQty = (id: string, raw: string) => {
    const p = catalogProducts.find((x) => x.id === id)
    if (!p) return
    setDrafts((d) => ({ ...d, [id]: raw }))
    // Só aplica ao carrinho valores VÁLIDOS; valores inválidos mantêm a última quantidade válida e bloqueiam a finalização.
    if (quantityError(raw, p.stock) === null) {
      const n = Number(raw.trim())
      setCart((c) => ({ ...c, [id]: n }))
    }
  }

  const blurQty = (id: string) => clearDraft(id)

  const qtyMessage = (err: QuantityError): string => {
    switch (err) {
      case 'empty':
        return t('Informe a quantidade.', 'Enter a quantity.')
      case 'zero':
        return t('A quantidade deve ser maior que zero.', 'Quantity must be greater than zero.')
      case 'over_stock':
        return t('Quantidade acima do estoque disponível.', 'Quantity exceeds available stock.')
      default:
        return t('Quantidade inválida (use um número inteiro).', 'Invalid quantity (use a whole number).')
    }
  }

  const finish = () => {
    if (lines.length === 0 || overStock || hasInvalidQty) return
    const ok = recordSale({
      customerId: customerId || undefined,
      method,
      dueDate: method === 'prazo' ? dueDate : undefined,
      items: lines.map((l) => ({ productId: l.p.id, qty: l.qty, price: l.p.price })),
    })
    // Só limpa o carrinho e confirma após sucesso efetivo (sem falso sucesso).
    if (!ok) return
    toast.success(method === 'prazo' ? t('Venda registrada como conta a receber.', 'Sale recorded as a receivable.') : t('Venda registrada e caixa atualizado.', 'Sale recorded and cash updated.'))
    setCart({})
    setDrafts({})
    setCustomerId('')
  }

  const cancel = (id: string) => {
    if (window.confirm(t('Cancelar esta venda? O estoque volta e o valor é estornado no caixa.', 'Cancel this sale? Stock is restored and the amount is refunded in cash.'))) cancelSale(id)
  }

  const cancelButton = (id: string) => (
    <Button small variant="ghost" onClick={() => cancel(id)}>
      <Undo2 size={14} /> {t('Cancelar', 'Cancel')}
    </Button>
  )
  const methodLabel = (m: PayMethod) => methods().find((x) => x.id === m)?.label

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title={t('Vendas e PDV', 'Sales and POS')}
        subtitle={t('Registre vendas no balcão. O estoque baixa e o caixa (ou contas a receber) atualiza na hora.', 'Record counter sales. Stock goes down and cash (or receivables) updates instantly.')}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="ok" icon={<Coins size={20} />} label={t('Vendas de hoje', "Today's sales")} value={money(todaySales.reduce((s, x) => s + x.total, 0))} sub={saleCount(todaySales.length)} />
        <KpiTile tone="violet" icon={<CalendarDays size={20} />} label={t('Vendas do mês', 'Sales this month')} value={money(monthTotal)} sub={saleCount(monthSales.length)} />
        <KpiTile tone="sky" icon={<Tag size={20} />} label={t('Ticket médio', 'Average ticket')} value={money(ticket)} sub={t('Média por venda no mês', 'Average per sale this month')} />
        <KpiTile tone="warn" icon={<BarChart3 size={20} />} label={t('Lucro bruto do mês', 'Gross profit this month')} value={money(monthProfit)} valueTone={monthProfit < 0 ? 'bad' : undefined} sub={monthTotal > 0 ? `${((monthProfit / monthTotal) * 100).toFixed(1).replace('.', t(',', '.'))}% ${t('de margem', 'margin')}` : t('Sem vendas no mês', 'No sales this month')} />
      </div>

      <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <TCard className="p-4 sm:p-5">
          <PanelTitle icon={<ShoppingCart size={18} />} title={t('Produtos', 'Products')} subtitle={t('Toque em um produto para adicionar ao carrinho', 'Tap a product to add it to the cart')} />
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-fill/5 px-3 focus-within:ring-2 focus-within:ring-violet/50">
              <Search size={16} className="text-subtle" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('Buscar produto', 'Search product')}
                aria-label={t('Buscar produto', 'Search product')}
                className="min-h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
              />
            </div>
            {categories.length > 1 ? (
              <PillTabs
                label={t('Categoria', 'Category')}
                value={category}
                onChange={setCategory}
                items={[{ id: 'all', label: t('Todas', 'All') }, ...categories.map((c) => ({ id: c, label: c }))]}
              />
            ) : null}
          </div>
          <div className="mt-4">
            {products.length === 0 ? (
              <Empty icon={<ShoppingCart size={22} />} title={t('Sem produtos', 'No products')} text={t('Cadastre produtos no estoque para começar a vender.', 'Add products to inventory to start selling.')} />
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
                {products.map((p) => {
                  const inCart = cart[p.id] ?? 0
                  const out = p.stock <= 0
                  const low = !out && p.stock <= p.minStock
                  return (
                    <button
                      key={p.id}
                      disabled={out || inCart >= p.stock}
                      onClick={() => add(p.id)}
                      className={`relative flex min-h-24 flex-col items-start justify-between rounded-2xl border bg-fill/5 p-3 text-left transition hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 disabled:opacity-50 ${inCart > 0 ? 'border-violet/60 bg-violet/10' : 'border-line'}`}
                    >
                      {inCart > 0 ? <span className="absolute right-2 top-2 rounded-full bg-violet px-2 py-0.5 text-xs font-bold text-accent-ink">{inCart}</span> : null}
                      <span className="pr-6 text-sm font-semibold leading-snug">{p.name}</span>
                      <span>
                        <span className="num block text-sm text-accent">{money(p.price)}</span>
                        <span className={`text-xs ${low ? 'text-warn' : 'text-subtle'}`}>{out ? t('Sem estoque', 'Out of stock') : t(`${num(p.stock)} em estoque`, `${num(p.stock)} in stock`)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </TCard>

        <TCard id="pos-cart" tint="violet" className="h-fit scroll-mt-20 p-4 sm:p-5 lg:sticky lg:top-24">
          <PanelTitle
            icon={<ShoppingCart size={18} />}
            title={t('Carrinho', 'Cart')}
            subtitle={itemCount > 0 ? `${itemCount} ${itemCount === 1 ? t('item', 'item') : t('itens', 'items')}` : undefined}
          />
          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t('Toque em um produto para adicionar.', 'Tap a product to add it.')}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {lines.map((l) => {
                const err = drafts[l.p.id] !== undefined ? quantityError(drafts[l.p.id], l.p.stock) : null
                return (
                  <li key={l.p.id} className="rounded-xl bg-fill/5 p-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{l.p.name}</div>
                        <div className="num text-xs text-subtle">
                          {money(l.p.price)} {t('cada', 'each')} · {money(l.qty * l.p.price)}
                        </div>
                      </div>
                      <button aria-label={t('Diminuir', 'Decrease')} onClick={() => dec(l.p.id)} className="flex size-9 items-center justify-center rounded-lg border border-line hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60">
                        <Minus size={14} />
                      </button>
                      <input
                        value={drafts[l.p.id] ?? String(l.qty)}
                        onChange={(e) => changeQty(l.p.id, e.target.value)}
                        onBlur={() => blurQty(l.p.id)}
                        onFocus={(e) => e.target.select()}
                        inputMode="numeric"
                        aria-label={t(`Quantidade de ${l.p.name}`, `Quantity of ${l.p.name}`)}
                        className={`num h-9 w-16 rounded-lg border bg-transparent text-center text-sm font-semibold outline-none focus:ring-2 focus:ring-violet/60 ${err ? 'border-bad text-bad' : 'border-line'}`}
                      />
                      <button aria-label={t('Aumentar', 'Increase')} onClick={() => add(l.p.id)} disabled={l.qty >= l.p.stock} className="flex size-9 items-center justify-center rounded-lg border border-line hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 disabled:opacity-40">
                        <Plus size={14} />
                      </button>
                      <button aria-label={t('Remover', 'Remove')} onClick={() => setCart((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== l.p.id)))} className="flex size-9 items-center justify-center rounded-lg text-bad hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {err ? <p className="mt-1.5 text-xs text-bad">{qtyMessage(err)}</p> : null}
                  </li>
                )
              })}
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
              <PillTabs label={t('Pagamento', 'Payment')} value={method} onChange={setMethod} items={methods()} />
            </div>
            {method === 'prazo' ? (
              <Field label={t('Vencimento', 'Due date')}>
                <DateField value={dueDate} onChange={setDueDate} />
              </Field>
            ) : null}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
            <span className="text-sm text-muted">Total</span>
            <span className="display num text-2xl font-semibold">{money(total)}</span>
          </div>
          <Button className="mt-3 w-full" disabled={lines.length === 0 || overStock || hasInvalidQty || (method === 'prazo' && !isValidIso(dueDate))} onClick={finish}>
            <Check size={16} /> {t('Finalizar venda', 'Complete sale')}
          </Button>
        </TCard>
      </div>

      <TCard className="overflow-hidden">
        <div className="border-b border-line p-4 sm:px-5">
          <PanelTitle icon={<Receipt size={18} />} title={t('Vendas recentes', 'Recent sales')} subtitle={`${shownSales.length} ${shownSales.length === 1 ? t('venda registrada', 'recorded sale') : t('vendas registradas', 'recorded sales')}`} />
          {salesFilter ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="accent">{t('Cliente', 'Customer')}: {salesFilter.name}</Badge>
              <Button small variant="ghost" onClick={() => setSalesFilter(null)}>
                <X size={14} /> {t('Limpar filtro', 'Clear filter')}
              </Button>
            </div>
          ) : null}
        </div>
        {shownSales.length === 0 ? (
          <Empty icon={<Receipt size={22} />} title={t('Nenhuma venda ainda', 'No sales yet')} />
        ) : (
          <>
            <div className="hidden md:block">
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
                  {shownSales.slice(0, limit).map((s) => (
                    <tr key={s.id} className={`transition hover:bg-fill/5 ${s.canceledAt ? 'opacity-60' : ''}`}>
                      <td className={td}>{fmtDate(s.date)}</td>
                      <td className={td}>{s.customerName}</td>
                      <td className={`${td} max-w-[260px] truncate`}>{s.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</td>
                      <td className={td}>
                        <Badge tone={s.method === 'prazo' ? 'warn' : 'neutral'}>{methodLabel(s.method)}</Badge>
                      </td>
                      <td className={`${td} num text-right font-semibold`}>{money(s.total)}</td>
                      <td className={`${td} num text-right text-ok`}>{s.canceledAt ? '-' : money(s.total - s.cogs)}</td>
                      <td className={`${td} text-right`}>{s.canceledAt ? <Badge tone="bad">{t('Cancelada', 'Canceled')}</Badge> : cancelButton(s.id)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {shownSales.slice(0, limit).map((s) => (
                <li key={s.id} className={`space-y-2 p-4 ${s.canceledAt ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{s.customerName}</p>
                      <p className="text-xs text-subtle">{fmtDate(s.date)}</p>
                    </div>
                    <div className="num shrink-0 whitespace-nowrap text-sm font-semibold">{money(s.total)}</div>
                  </div>
                  <p className="text-xs text-muted">{s.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge tone={s.method === 'prazo' ? 'warn' : 'neutral'}>{methodLabel(s.method)}</Badge>
                      {s.canceledAt ? null : <span className="num text-xs text-ok">{money(s.total - s.cogs)}</span>}
                    </span>
                    {s.canceledAt ? <Badge tone="bad">{t('Cancelada', 'Canceled')}</Badge> : cancelButton(s.id)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {shownSales.length > limit ? (
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" small onClick={() => setLimit((l) => l + 30)}>
              {t('Ver mais vendas', 'Show more sales')}
            </Button>
          </div>
        ) : null}
      </TCard>

      {itemCount > 0 ? (
        <div className="fixed inset-x-3 bottom-3 z-30 lg:hidden">
          <button
            onClick={() => document.getElementById('pos-cart')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-violet/50 bg-panel px-4 text-sm font-semibold shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
          >
            <span className="flex items-center gap-2">
              <ShoppingCart size={16} className="text-violet" /> {itemCount} {itemCount === 1 ? t('item', 'item') : t('itens', 'items')}
            </span>
            <span className="num">{money(total)}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
