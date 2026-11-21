import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, History, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Stat, TableWrap, inputCls, td, th } from '@/components/ui'
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

export function Stock() {
  const { data, removeProduct } = useStore()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [move, setMove] = useState<{ product: Product; kind: 'in' | 'out' | 'adjust' } | null>(null)
  const [history, setHistory] = useState<Product | null>(null)

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return data.products.filter((p) => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.category.toLowerCase().includes(s))
  }, [data.products, q])
  const low = lowStock(data)
  const potential = data.products.reduce((s, p) => s + p.stock * p.price, 0)

  return (
    <div>
      <PageHeader
        title={t('Controle de estoque', 'Inventory control')}
        subtitle={t('Produtos, custos, margens e movimentações. Vendas e compras atualizam o estoque automaticamente.', 'Products, costs, margins and movements. Sales and purchases update stock automatically.')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} /> {t('Novo produto', 'New product')}
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Valor em estoque (custo)', 'Inventory value (cost)')} value={money(stockValue(data))} icon={<Boxes size={16} />} />
        <Stat label={t('Potencial de venda', 'Sales potential')} value={money(potential)} sub={t('a preço de tabela', 'at list price')} />
        <Stat label={t('Produtos', 'Products')} value={String(data.products.length)} />
        <Stat label={t('Abaixo do mínimo', 'Below minimum')} value={String(low.length)} tone={low.length ? 'bad' : undefined} icon={<AlertTriangle size={16} />} />
      </div>

      <Card className="!p-0">
        <div className="flex items-center gap-2 border-b border-line p-3">
          <Search size={16} className="text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Buscar por nome, SKU ou categoria', 'Search by name, SKU or category')}
            aria-label={t('Buscar produtos', 'Search products')}
            className="min-h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
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
              {list.map((p) => {
                const margin = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0
                const isLow = p.stock <= p.minStock
                return (
                  <tr key={p.id}>
                    <td className={td}>
                      <div className="font-semibold">{p.name}</div>
                      <div className="mono text-xs text-subtle">{p.sku || t('sem SKU', 'no SKU')}</div>
                    </td>
                    <td className={td}>{p.category}</td>
                    <td className={`${td} num text-right`}>
                      {isLow ? <Badge tone="bad">{num(p.stock)} {p.unit}</Badge> : `${num(p.stock)} ${p.unit}`}
                    </td>
                    <td className={`${td} num text-right`}>{money(p.cost)}</td>
                    <td className={`${td} num text-right`}>{money(p.price)}</td>
                    <td className={`${td} num text-right ${margin < 20 ? 'text-warn' : 'text-ok'}`}>{pct(margin).replace('+', '')}</td>
                    <td className={`${td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <button title={t('Entrada', 'Stock in')} aria-label={t('Entrada', 'Stock in')} onClick={() => setMove({ product: p, kind: 'in' })} className="flex size-9 items-center justify-center rounded-lg text-ok hover:bg-surface-strong">
                          <ArrowDownToLine size={16} />
                        </button>
                        <button title={t('Saída', 'Stock out')} aria-label={t('Saída', 'Stock out')} onClick={() => setMove({ product: p, kind: 'out' })} className="flex size-9 items-center justify-center rounded-lg text-warn hover:bg-surface-strong">
                          <ArrowUpFromLine size={16} />
                        </button>
                        <button title={t('Histórico', 'History')} aria-label={t('Histórico', 'History')} onClick={() => setHistory(p)} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-strong">
                          <History size={16} />
                        </button>
                        <button title={t('Editar', 'Edit')} aria-label={t('Editar', 'Edit')} onClick={() => setEditing(p)} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-strong">
                          <Pencil size={16} />
                        </button>
                        <button
                          title={t('Remover', 'Remove')}
                          aria-label={t('Remover', 'Remove')}
                          onClick={() => removeProduct(p.id)}
                          className="flex size-9 items-center justify-center rounded-lg text-bad hover:bg-bad/10"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <ProductModal product={editing} onClose={() => setEditing(null)} />
      <MoveModal target={move} onClose={() => setMove(null)} />
      <HistoryModal product={history} onClose={() => setHistory(null)} />
    </div>
  )
}
