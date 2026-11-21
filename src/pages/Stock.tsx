import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, History, Layers, Pencil, Plus, Search, Tag, Trash2, Wallet } from 'lucide-react'
import { Badge, Button, Empty, Field, Modal, TableWrap, inputCls, td, th } from '@/components/ui'
import { Bar, C } from '@/components/charts'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { useStore } from '@/lib/store'
import { lowStock, stockValue } from '@/lib/selectors'
import { fmtDate, money, num, parseNum, pct } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Product } from '@/lib/types'

interface Form {
  sku: string
  name: string
  category: string
  unit: string
  cost: string
  price: string
  stock: string
  minStock: string
}

const blank: Form = { sku: '', name: '', category: '', unit: 'un', cost: '', price: '', stock: '0', minStock: '0' }

function ProductModal({ product, onClose }: { product: Product | 'new' | null; onClose: () => void }) {
  const { addProduct, updateProduct } = useStore()
  const editing = product && product !== 'new' ? product : null
  const [form, setForm] = useState<Form>(blank)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const key = product === null ? null : editing ? editing.id : 'new'
  if (key !== loadedFor) {
    setLoadedFor(key)
    setForm(
      editing
        ? {
            sku: editing.sku,
            name: editing.name,
            category: editing.category,
            unit: editing.unit,
            cost: String(editing.cost),
            price: String(editing.price),
            stock: String(editing.stock),
            minStock: String(editing.minStock),
          }
        : blank,
    )
  }
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const cost = parseNum(form.cost)
  const price = parseNum(form.price)
  const valid = form.name.trim() !== '' && cost >= 0 && price >= 0 && !Number.isNaN(cost) && !Number.isNaN(price)

  const save = () => {
    const base = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      category: form.category.trim() || 'Geral',
      unit: form.unit.trim() || 'un',
      cost,
      price,
      minStock: Math.max(0, parseNum(form.minStock) || 0),
    }
    if (editing) updateProduct(editing.id, base)
    else addProduct({ ...base, stock: Math.max(0, parseNum(form.stock) || 0) })
    onClose()
  }

  return (
    <Modal open={product !== null} onClose={onClose} title={editing ? t('Editar produto', 'Edit product') : t('Novo produto', 'New product')}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label={t('Nome', 'Name')}>
            <input className={inputCls} value={form.name} onChange={set('name')} placeholder={t('Ex.: Café especial 500g', 'E.g. Specialty coffee 500g')} />
          </Field>
        </div>
        <Field label="SKU">
          <input className={inputCls} value={form.sku} onChange={set('sku')} />
        </Field>
        <Field label={t('Categoria', 'Category')}>
          <input className={inputCls} value={form.category} onChange={set('category')} />
        </Field>
        <Field label={t('Custo', 'Cost')}>
          <input className={inputCls} inputMode="decimal" value={form.cost} onChange={set('cost')} placeholder="0,00" />
        </Field>
        <Field label={t('Preço de venda', 'Sale price')}>
          <input className={inputCls} inputMode="decimal" value={form.price} onChange={set('price')} placeholder="0,00" />
        </Field>
        {!editing ? (
          <Field label={t('Estoque inicial', 'Opening stock')}>
            <input className={inputCls} inputMode="decimal" value={form.stock} onChange={set('stock')} />
          </Field>
        ) : null}
        <Field label={t('Estoque mínimo', 'Minimum stock')}>
          <input className={inputCls} inputMode="decimal" value={form.minStock} onChange={set('minStock')} />
        </Field>
        <Field label={t('Unidade', 'Unit')}>
          <input className={inputCls} value={form.unit} onChange={set('unit')} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('Cancelar', 'Cancel')}
        </Button>
        <Button disabled={!valid} onClick={save}>
          {t('Salvar', 'Save')}
        </Button>
      </div>
    </Modal>
  )
}

function MoveModal({ target, onClose }: { target: { product: Product; kind: 'in' | 'out' | 'adjust' } | null; onClose: () => void }) {
  const { moveStock } = useStore()
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const q = parseNum(qty)
  const kind = target?.kind ?? 'in'
  const tooMuch = kind === 'out' && target ? q > target.product.stock : false
  const valid = !Number.isNaN(q) && q >= 0 && (kind === 'adjust' || q > 0) && !tooMuch
  const title = kind === 'in' ? t('Entrada de estoque', 'Stock in') : kind === 'out' ? t('Saída de estoque', 'Stock out') : t('Ajuste de inventário', 'Inventory adjustment')

  const done = () => {
    if (!target) return
    moveStock(target.product.id, kind, q, note.trim() || title)
    setQty('')
    setNote('')
    onClose()
  }

  return (
    <Modal open={target !== null} onClose={onClose} title={title}>
      {target ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {target.product.name} · {t('estoque atual', 'current stock')}: <b className="text-ink">{num(target.product.stock)}</b>
          </p>
          <Field label={kind === 'adjust' ? t('Nova quantidade', 'New quantity') : t('Quantidade', 'Quantity')} hint={tooMuch ? t('Quantidade maior que o estoque disponível.', 'Quantity exceeds available stock.') : undefined}>
            <input className={inputCls} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label={t('Observação', 'Note')}>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Ex.: perda, devolução, contagem', 'E.g. loss, return, count')} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              {t('Cancelar', 'Cancel')}
            </Button>
            <Button disabled={!valid} onClick={done}>
              {t('Confirmar', 'Confirm')}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

function HistoryModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { data } = useStore()
  const moves = product ? data.moves.filter((m) => m.productId === product.id) : []
  return (
    <Modal open={product !== null} onClose={onClose} title={t('Histórico de movimentações', 'Movement history')} wide>
      {product ? (
        <div>
          <p className="mb-3 text-sm text-muted">
            {product.name} · {t('estoque atual', 'current stock')}: <b className="text-ink">{num(product.stock)}</b>
          </p>
          {moves.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t('Nenhuma movimentação registrada para este produto.', 'No movements recorded for this product.')}</p>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>{t('Data', 'Date')}</th>
                  <th className={th}>{t('Tipo', 'Type')}</th>
                  <th className={`${th} text-right`}>{t('Quantidade', 'Quantity')}</th>
                  <th className={th}>{t('Observação', 'Note')}</th>
                </tr>
              </thead>
              <tbody>
                {moves.slice(0, 100).map((m) => (
                  <tr key={m.id}>
                    <td className={td}>{fmtDate(m.date)}</td>
                    <td className={td}>
                      <Badge tone={m.kind === 'in' ? 'ok' : m.kind === 'out' ? 'warn' : 'neutral'}>
                        {m.kind === 'in' ? t('Entrada', 'In') : m.kind === 'out' ? t('Saída', 'Out') : t('Ajuste', 'Adjustment')}
                      </Badge>
                    </td>
                    <td className={`${td} num text-right`}>
                      {m.kind === 'in' ? '+' : m.kind === 'out' ? '-' : '='}
                      {num(m.qty)}
                    </td>
                    <td className={`${td} max-w-[260px] truncate`}>{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      ) : null}
    </Modal>
  )
}

type View = 'all' | 'low'

export function Stock() {
  const { data, removeProduct } = useStore()
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>('all')
  const [limit, setLimit] = useState(30)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [move, setMove] = useState<{ product: Product; kind: 'in' | 'out' | 'adjust' } | null>(null)
  const [history, setHistory] = useState<Product | null>(null)

  const low = lowStock(data)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return data.products.filter(
      (p) => (view === 'all' || p.stock <= p.minStock) && (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.category.toLowerCase().includes(s)),
    )
  }, [data.products, q, view])
  const shown = list.slice(0, limit)
  const potential = data.products.reduce((s, p) => s + p.stock * p.price, 0)
  const cost = stockValue(data)
  const categories = new Set(data.products.map((p) => p.category)).size
  const potentialMargin = potential > 0 ? ((potential - cost) / potential) * 100 : null

  const iconBtn = 'flex size-9 items-center justify-center rounded-lg hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60'
  const actions = (p: Product) => (
    <div className="flex justify-end gap-1">
      <button title={t('Entrada', 'Stock in')} aria-label={t('Entrada', 'Stock in')} onClick={() => setMove({ product: p, kind: 'in' })} className={`${iconBtn} text-ok`}>
        <ArrowDownToLine size={16} />
      </button>
      <button title={t('Saída', 'Stock out')} aria-label={t('Saída', 'Stock out')} onClick={() => setMove({ product: p, kind: 'out' })} className={`${iconBtn} text-warn`}>
        <ArrowUpFromLine size={16} />
      </button>
      <button title={t('Histórico', 'History')} aria-label={t('Histórico', 'History')} onClick={() => setHistory(p)} className={`${iconBtn} text-muted`}>
        <History size={16} />
      </button>
      <button title={t('Editar', 'Edit')} aria-label={t('Editar', 'Edit')} onClick={() => setEditing(p)} className={`${iconBtn} text-muted`}>
        <Pencil size={16} />
      </button>
      <button title={t('Remover', 'Remove')} aria-label={t('Remover', 'Remove')} onClick={() => removeProduct(p.id)} className={`${iconBtn} text-bad hover:!bg-bad/10`}>
        <Trash2 size={16} />
      </button>
    </div>
  )

  const level = (p: Product) =>
    p.minStock > 0 ? (
      <div className="mt-1 w-24 sm:ml-auto">
        <Bar value={Math.min(p.stock, p.minStock * 3)} max={p.minStock * 3} color={p.stock <= p.minStock ? C.bad : C.ok} />
      </div>
    ) : null
  const marginOf = (p: Product) => (p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0)

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title={t('Controle de estoque', 'Inventory control')}
        subtitle={t('Produtos, custos, margens e movimentações. Vendas e compras atualizam o estoque automaticamente.', 'Products, costs, margins and movements. Sales and purchases update stock automatically.')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} /> {t('Novo produto', 'New product')}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="ok" icon={<Wallet size={20} />} label={t('Valor em estoque (custo)', 'Inventory value (cost)')} value={money(cost)} sub={t('a preço de custo', 'at cost price')} />
        <KpiTile
          tone="violet"
          icon={<Tag size={20} />}
          label={t('Potencial de venda', 'Sales potential')}
          value={money(potential)}
          sub={potentialMargin === null ? t('a preço de tabela', 'at list price') : `${t('a preço de tabela', 'at list price')} · ${potentialMargin.toFixed(1).replace('.', t(',', '.'))}%`}
        />
        <KpiTile tone="sky" icon={<Layers size={20} />} label={t('Produtos', 'Products')} value={String(data.products.length)} sub={`${categories} ${categories === 1 ? t('categoria', 'category') : t('categorias', 'categories')}`} />
        <KpiTile
          tone="warn"
          icon={<AlertTriangle size={20} />}
          label={t('Abaixo do mínimo', 'Below minimum')}
          value={String(low.length)}
          valueTone={low.length ? 'bad' : undefined}
          sub={low.length ? t('Reposição necessária', 'Restock needed') : t('Tudo em dia', 'All good')}
        />
      </div>

      {low.length > 0 ? (
        <TCard tint="warn" className="p-4 sm:p-5">
          <PanelTitle icon={<AlertTriangle size={18} />} title={t('Reposição sugerida', 'Suggested restock')} subtitle={t('Produtos no estoque mínimo ou abaixo dele. Toque para registrar uma entrada.', 'Products at or below minimum stock. Tap to record a stock-in.')} />
          <div className="mt-3 flex flex-wrap gap-2">
            {low.slice(0, 8).map((p) => (
              <button
                key={p.id}
                onClick={() => setMove({ product: p, kind: 'in' })}
                className="flex min-h-9 items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-3 text-xs font-semibold transition hover:bg-warn/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
              >
                <ArrowDownToLine size={13} className="text-warn" />
                <span className="max-w-[180px] truncate">{p.name}</span>
                <span className="num text-warn">
                  {num(p.stock)}/{num(p.minStock)}
                </span>
              </button>
            ))}
            {low.length > 8 ? (
              <button onClick={() => setView('low')} className="min-h-9 rounded-full border border-line px-3 text-xs font-semibold text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60">
                +{low.length - 8} {t('ver todos', 'view all')}
              </button>
            ) : null}
          </div>
        </TCard>
      ) : null}

      <TCard className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:px-5">
          <PanelTitle icon={<Boxes size={18} />} title={t('Produtos', 'Products')} subtitle={`${list.length} ${list.length === 1 ? t('produto', 'product') : t('produtos', 'products')}`} />
          <PillTabs
            label={t('Filtro', 'Filter')}
            value={view}
            onChange={(v) => {
              setView(v)
              setLimit(30)
            }}
            items={[
              { id: 'all', label: `${t('Todos', 'All')} (${data.products.length})` },
              { id: 'low', label: `${t('Abaixo do mínimo', 'Below minimum')} (${low.length})` },
            ]}
          />
        </div>
        <div className="flex items-center gap-2 border-b border-line px-4 focus-within:bg-fill/5 sm:px-5">
          <Search size={16} className="text-subtle" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setLimit(30)
            }}
            placeholder={t('Buscar por nome, SKU ou categoria', 'Search by name, SKU or category')}
            aria-label={t('Buscar produtos', 'Search products')}
            className="min-h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
        </div>

        {list.length === 0 ? (
          <Empty
            icon={<Boxes size={22} />}
            title={data.products.length ? t('Nada encontrado', 'Nothing found') : t('Nenhum produto cadastrado', 'No products yet')}
            text={t('Cadastre seus produtos para controlar estoque, custo e margem.', 'Add your products to track stock, cost and margin.')}
            action={
              !data.products.length ? (
                <Button onClick={() => setEditing('new')}>
                  <Plus size={16} /> {t('Cadastrar produto', 'Add product')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>{t('Produto', 'Product')}</th>
                    <th className={th}>{t('Categoria', 'Category')}</th>
                    <th className={`${th} text-right`}>{t('Estoque', 'Stock')}</th>
                    <th className={`${th} text-right`}>{t('Custo', 'Cost')}</th>
                    <th className={`${th} text-right`}>{t('Preço', 'Price')}</th>
                    <th className={`${th} text-right`}>{t('Margem', 'Margin')}</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const margin = marginOf(p)
                    const isLow = p.stock <= p.minStock
                    return (
                      <tr key={p.id} className="transition hover:bg-fill/5">
                        <td className={td}>
                          <div className="font-semibold">{p.name}</div>
                          <div className="mono text-xs text-subtle">{p.sku || t('sem SKU', 'no SKU')}</div>
                        </td>
                        <td className={td}>{p.category}</td>
                        <td className={`${td} num text-right`}>
                          {isLow ? <Badge tone="bad">{num(p.stock)} {p.unit}</Badge> : `${num(p.stock)} ${p.unit}`}
                          {level(p)}
                        </td>
                        <td className={`${td} num text-right`}>{money(p.cost)}</td>
                        <td className={`${td} num text-right`}>{money(p.price)}</td>
                        <td className={`${td} num text-right ${margin < 20 ? 'text-warn' : 'text-ok'}`}>{pct(margin).replace('+', '')}</td>
                        <td className={`${td} text-right`}>{actions(p)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </TableWrap>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {shown.map((p) => {
                const margin = marginOf(p)
                const isLow = p.stock <= p.minStock
                return (
                  <li key={p.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{p.name}</p>
                        <p className="mono truncate text-xs text-subtle">
                          {p.sku || t('sem SKU', 'no SKU')} · {p.category}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {isLow ? <Badge tone="bad">{num(p.stock)} {p.unit}</Badge> : <span className="num text-sm font-semibold">{num(p.stock)} {p.unit}</span>}
                        {level(p)}
                      </div>
                    </div>
                    <dl className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-subtle">{t('Custo', 'Cost')}</dt>
                        <dd className="num font-semibold">{money(p.cost)}</dd>
                      </div>
                      <div>
                        <dt className="text-subtle">{t('Preço', 'Price')}</dt>
                        <dd className="num font-semibold">{money(p.price)}</dd>
                      </div>
                      <div>
                        <dt className="text-subtle">{t('Margem', 'Margin')}</dt>
                        <dd className={`num font-semibold ${margin < 20 ? 'text-warn' : 'text-ok'}`}>{pct(margin).replace('+', '')}</dd>
                      </div>
                    </dl>
                    {actions(p)}
                  </li>
                )
              })}
            </ul>

            {list.length > shown.length ? (
              <div className="border-t border-line p-3 text-center">
                <Button variant="ghost" small onClick={() => setLimit((l) => l + 30)}>
                  {t('Ver mais', 'View more')} ({list.length - shown.length})
                </Button>
              </div>
            ) : null}
          </>
        )}
      </TCard>

      <ProductModal product={editing} onClose={() => setEditing(null)} />
      <MoveModal target={move} onClose={() => setMove(null)} />
      <HistoryModal product={history} onClose={() => setHistory(null)} />
    </div>
  )
}
