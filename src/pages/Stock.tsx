import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, History, Layers, Pencil, Plus, Search, Tag, Trash2, Wallet } from 'lucide-react'
import { Badge, Button, Empty, Field, Modal, TableWrap, inputCls, td, th } from '@/components/ui'
import { Bar, C } from '@/components/charts'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { useStore } from '@/lib/store'
import { useNetwork } from '@/lib/network'
import { contactsForEnvironment, lowStockForEnvironment, productsForEnvironment, stockValueForEnvironment } from '@/lib/selectors'
import { fmtDate, money, num, parseNum, pct } from '@/lib/format'
import { t } from '@/lib/i18n'
import { barcodeIsValid } from '@/lib/product'
import { isSandbox } from '@/lib/environment-policy'
import type { Product } from '@/lib/types'

type Tab = 'general' | 'prices' | 'stock' | 'suppliers' | 'logistics' | 'fiscal'

interface Form {
  name: string
  sku: string
  brand: string
  manufacturer: string
  category: string
  subcategory: string
  barcode: string
  unit: string
  description: string
  active: boolean
  referenceCost: string
  cost: string
  price: string
  wholesalePrice: string
  stock: string
  minStock: string
  maxStock: string
  reorderPoint: string
  location: string
  storageUnit: string
  primarySupplierId: string
  alternateSupplierIds: string[]
  supplierSku: string
  purchasePrice: string
  leadTimeDays: string
  minOrderQty: string
  netWeight: string
  grossWeight: string
  height: string
  width: string
  depth: string
  unitsPerPackage: string
  storageConditions: string
  originCountry: string
  hsCode: string
  ncm: string
  taxRef: string
}

const blank: Form = {
  name: '', sku: '', brand: '', manufacturer: '', category: '', subcategory: '', barcode: '', unit: 'un', description: '', active: true,
  referenceCost: '', cost: '', price: '', wholesalePrice: '', stock: '0', minStock: '0', maxStock: '', reorderPoint: '', location: '', storageUnit: '',
  primarySupplierId: '', alternateSupplierIds: [], supplierSku: '', purchasePrice: '', leadTimeDays: '', minOrderQty: '',
  netWeight: '', grossWeight: '', height: '', width: '', depth: '', unitsPerPackage: '', storageConditions: '',
  originCountry: '', hsCode: '', ncm: '', taxRef: '',
}

const fromProduct = (p: Product): Form => ({
  name: p.name, sku: p.sku, brand: p.brand ?? '', manufacturer: p.manufacturer ?? '', category: p.category, subcategory: p.subcategory ?? '',
  barcode: p.barcode ?? '', unit: p.unit, description: p.description ?? '', active: p.active !== false,
  referenceCost: p.referenceCost !== undefined ? String(p.referenceCost) : '', cost: String(p.cost), price: String(p.price),
  wholesalePrice: p.wholesalePrice !== undefined ? String(p.wholesalePrice) : '', stock: String(p.stock), minStock: String(p.minStock),
  maxStock: p.maxStock !== undefined ? String(p.maxStock) : '', reorderPoint: p.reorderPoint !== undefined ? String(p.reorderPoint) : '',
  location: p.location ?? '', storageUnit: p.storageUnit ?? '', primarySupplierId: p.primarySupplierId ?? '',
  alternateSupplierIds: p.alternateSupplierIds ?? [], supplierSku: p.supplierSku ?? '', purchasePrice: p.purchasePrice !== undefined ? String(p.purchasePrice) : '',
  leadTimeDays: p.leadTimeDays !== undefined ? String(p.leadTimeDays) : '', minOrderQty: p.minOrderQty !== undefined ? String(p.minOrderQty) : '',
  netWeight: p.netWeight !== undefined ? String(p.netWeight) : '', grossWeight: p.grossWeight !== undefined ? String(p.grossWeight) : '',
  height: p.height !== undefined ? String(p.height) : '', width: p.width !== undefined ? String(p.width) : '', depth: p.depth !== undefined ? String(p.depth) : '',
  unitsPerPackage: p.unitsPerPackage !== undefined ? String(p.unitsPerPackage) : '', storageConditions: p.storageConditions ?? '',
  originCountry: p.originCountry ?? '', hsCode: p.hsCode ?? '', ncm: p.ncm ?? '', taxRef: p.taxRef ?? '',
})

const optNum = (s: string): number | undefined => {
  const v = parseNum(s)
  return s.trim() === '' || Number.isNaN(v) ? undefined : v
}

function ProductModal({ product, onClose }: { product: Product | 'new' | null; onClose: () => void }) {
  const { data, addProduct, updateProduct } = useStore()
  const network = useNetwork()
  const editing = product && product !== 'new' ? product : null
  const suppliers = contactsForEnvironment(data, network).filter((c) => c.kind === 'supplier')
  const [tab, setTab] = useState<Tab>('general')
  const [form, setForm] = useState<Form>(blank)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const key = product === null ? null : editing ? editing.id : 'new'
  if (key !== loadedFor) {
    setLoadedFor(key)
    setTab('general')
    setForm(editing ? fromProduct(editing) : blank)
  }
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setSelect = (k: keyof Form) => (e: React.ChangeEvent<HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const toggleAlt = (id: string) =>
    setForm((f) => ({ ...f, alternateSupplierIds: f.alternateSupplierIds.includes(id) ? f.alternateSupplierIds.filter((x) => x !== id) : [...f.alternateSupplierIds, id] }))

  const cost = Math.max(0, parseNum(form.cost) || 0)
  const price = Math.max(0, parseNum(form.price) || 0)
  const valid = form.name.trim() !== ''
  const barcodeInvalid = form.barcode.trim() !== '' && !barcodeIsValid(form.barcode)
  const margin = price > 0 ? ((price - cost) / price) * 100 : 0
  const markup = cost > 0 ? ((price - cost) / cost) * 100 : 0

  const save = () => {
    const base = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      brand: form.brand.trim() || undefined,
      manufacturer: form.manufacturer.trim() || undefined,
      category: form.category.trim() || 'Geral',
      subcategory: form.subcategory.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      unit: form.unit.trim() || 'un',
      description: form.description.trim() || undefined,
      active: form.active,
      price,
      referenceCost: optNum(form.referenceCost),
      wholesalePrice: optNum(form.wholesalePrice),
      minStock: Math.max(0, parseNum(form.minStock) || 0),
      maxStock: optNum(form.maxStock),
      reorderPoint: optNum(form.reorderPoint),
      location: form.location.trim() || undefined,
      storageUnit: form.storageUnit.trim() || undefined,
      primarySupplierId: form.primarySupplierId || undefined,
      alternateSupplierIds: form.alternateSupplierIds.length ? form.alternateSupplierIds : undefined,
      supplierSku: form.supplierSku.trim() || undefined,
      purchasePrice: optNum(form.purchasePrice),
      leadTimeDays: optNum(form.leadTimeDays),
      minOrderQty: optNum(form.minOrderQty),
      netWeight: optNum(form.netWeight),
      grossWeight: optNum(form.grossWeight),
      height: optNum(form.height),
      width: optNum(form.width),
      depth: optNum(form.depth),
      unitsPerPackage: optNum(form.unitsPerPackage),
      storageConditions: form.storageConditions.trim() || undefined,
      originCountry: form.originCountry.trim() || undefined,
      hsCode: form.hsCode.trim() || undefined,
      ncm: form.ncm.trim() || undefined,
      taxRef: form.taxRef.trim() || undefined,
    }
    if (editing) {
      if (updateProduct(editing.id, base)) onClose()
    } else {
      const stock = Math.max(0, parseNum(form.stock) || 0)
      if (addProduct({ ...base, cost, stock })) onClose()
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: t('Geral', 'General') },
    { id: 'prices', label: t('Preços', 'Prices') },
    { id: 'stock', label: t('Estoque', 'Stock') },
    { id: 'suppliers', label: t('Fornecedores', 'Suppliers') },
    { id: 'logistics', label: t('Logística', 'Logistics') },
    { id: 'fiscal', label: t('Fiscal', 'Fiscal') },
  ]

  return (
    <Modal
      open={product !== null}
      onClose={onClose}
      icon={<Tag size={20} />}
      title={editing ? t('Editar produto', 'Edit product') : t('Novo produto', 'New product')}
      subtitle={editing ? editing.name : t('Cadastro completo de produto.', 'Full product registration.')}
      size="form"
    >
      <div className="mb-4">
        <PillTabs label={t('Abas do produto', 'Product tabs')} value={tab} onChange={(v) => setTab(v)} items={tabs} />
      </div>

      {tab === 'general' ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label={t('Nome', 'Name')} required>
              <input className={inputCls} value={form.name} onChange={set('name')} placeholder={t('Ex.: Café especial 500g', 'E.g. Specialty coffee 500g')} />
            </Field>
          </div>
          <Field label="SKU">
            <input className={inputCls} value={form.sku} onChange={set('sku')} />
          </Field>
          <Field label={t('Código de barras', 'Barcode')} hint={barcodeInvalid ? t('GTIN/EAN/UPC inválido.', 'Invalid GTIN/EAN/UPC.') : undefined}>
            <input className={inputCls} inputMode="numeric" value={form.barcode} onChange={set('barcode')} placeholder="789…" />
          </Field>
          <Field label={t('Marca', 'Brand')}>
            <input className={inputCls} value={form.brand} onChange={set('brand')} />
          </Field>
          <Field label={t('Fabricante', 'Manufacturer')}>
            <input className={inputCls} value={form.manufacturer} onChange={set('manufacturer')} />
          </Field>
          <Field label={t('Categoria', 'Category')}>
            <input className={inputCls} value={form.category} onChange={set('category')} />
          </Field>
          <Field label={t('Subcategoria', 'Subcategory')}>
            <input className={inputCls} value={form.subcategory} onChange={set('subcategory')} />
          </Field>
          <Field label={t('Unidade de medida', 'Unit of measure')}>
            <input className={inputCls} value={form.unit} onChange={set('unit')} />
          </Field>
          <div className="col-span-2">
            <Field label={t('Descrição', 'Description')}>
              <textarea className={`${inputCls} min-h-20 resize-y py-2.5`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
          </div>
          <label className="col-span-2 flex cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3 py-2.5">
            <input type="checkbox" className="size-4 accent-violet" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            <span className="text-sm">{t('Produto ativo', 'Active product')}</span>
          </label>
        </div>
      ) : null}

      {tab === 'prices' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Custo de referência comercial', 'Commercial reference cost')}>
            <input className={inputCls} inputMode="decimal" value={form.referenceCost} onChange={set('referenceCost')} placeholder="0,00" />
          </Field>
          <Field label={t('Custo médio contábil', 'Average accounting cost')} hint={editing ? t('Atualizado pelas compras (custo médio ponderado).', 'Updated by purchases (weighted average cost).') : t('Custo inicial (atualizado pelas compras).', 'Initial cost (updated by purchases).')}>
            <input className={inputCls} inputMode="decimal" value={form.cost} onChange={set('cost')} readOnly={!!editing} disabled={!!editing} placeholder="0,00" />
          </Field>
          <Field label={t('Preço de venda', 'Sale price')}>
            <input className={inputCls} inputMode="decimal" value={form.price} onChange={set('price')} placeholder="0,00" />
          </Field>
          <Field label={t('Preço de atacado', 'Wholesale price')}>
            <input className={inputCls} inputMode="decimal" value={form.wholesalePrice} onChange={set('wholesalePrice')} placeholder="0,00" />
          </Field>
          <div className="col-span-2 grid grid-cols-3 gap-2 rounded-xl bg-fill/5 p-3 text-sm">
            <div>
              <div className="text-xs text-subtle">{t('Lucro bruto unitário', 'Unit gross profit')}</div>
              <div className="num font-semibold">{money(price - cost)}</div>
            </div>
            <div>
              <div className="text-xs text-subtle">{t('Margem bruta', 'Gross margin')}</div>
              <div className={`num font-semibold ${margin < 0 ? 'text-bad' : 'text-ok'}`}>{margin.toFixed(1).replace('.', t(',', '.'))}%</div>
            </div>
            <div>
              <div className="text-xs text-subtle">{t('Markup', 'Markup')}</div>
              <div className={`num font-semibold ${markup < 0 ? 'text-bad' : 'text-ok'}`}>{markup.toFixed(1).replace('.', t(',', '.'))}%</div>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'stock' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Quantidade disponível', 'Available quantity')} hint={editing ? t('Alterações de quantidade usam movimentação/ajuste de estoque.', 'Quantity changes use stock movement/adjustment.') : t('Estoque inicial.', 'Opening stock.')}>
            <input className={inputCls} inputMode="decimal" value={form.stock} onChange={set('stock')} readOnly={!!editing} disabled={!!editing} />
          </Field>
          <Field label={t('Estoque mínimo', 'Minimum stock')}>
            <input className={inputCls} inputMode="decimal" value={form.minStock} onChange={set('minStock')} />
          </Field>
          <Field label={t('Estoque máximo', 'Maximum stock')}>
            <input className={inputCls} inputMode="decimal" value={form.maxStock} onChange={set('maxStock')} />
          </Field>
          <Field label={t('Ponto de reposição', 'Reorder point')}>
            <input className={inputCls} inputMode="decimal" value={form.reorderPoint} onChange={set('reorderPoint')} />
          </Field>
          <Field label={t('Localização no depósito', 'Warehouse location')}>
            <input className={inputCls} value={form.location} onChange={set('location')} />
          </Field>
          <Field label={t('Unidade de armazenamento', 'Storage unit')}>
            <input className={inputCls} value={form.storageUnit} onChange={set('storageUnit')} />
          </Field>
          <p className="col-span-2 text-xs text-subtle">{t('Método de valorização: custo médio ponderado móvel.', 'Valuation method: moving weighted average cost.')}</p>
        </div>
      ) : null}

      {tab === 'suppliers' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Fornecedor principal', 'Primary supplier')}>
            <select className={inputCls} value={form.primarySupplierId} onChange={setSelect('primarySupplierId')}>
              <option value="">{t('Nenhum', 'None')}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label={t('Código no fornecedor', 'Supplier SKU')}>
            <input className={inputCls} value={form.supplierSku} onChange={set('supplierSku')} />
          </Field>
          <Field label={t('Preço de referência de aquisição', 'Reference purchase price')}>
            <input className={inputCls} inputMode="decimal" value={form.purchasePrice} onChange={set('purchasePrice')} placeholder="0,00" />
          </Field>
          <Field label={t('Prazo estimado de entrega (dias)', 'Estimated lead time (days)')}>
            <input className={inputCls} inputMode="numeric" value={form.leadTimeDays} onChange={set('leadTimeDays')} />
          </Field>
          <Field label={t('Quantidade mínima do pedido', 'Minimum order quantity')}>
            <input className={inputCls} inputMode="decimal" value={form.minOrderQty} onChange={set('minOrderQty')} />
          </Field>
          {suppliers.length > 1 ? (
            <div className="col-span-2">
              <span className="label mb-1.5 block">{t('Fornecedores alternativos', 'Alternate suppliers')}</span>
              <div className="flex flex-wrap gap-2">
                {suppliers.filter((s) => s.id !== form.primarySupplierId).map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs">
                    <input type="checkbox" className="size-3.5 accent-violet" checked={form.alternateSupplierIds.includes(s.id)} onChange={() => toggleAlt(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'logistics' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Peso líquido', 'Net weight')}>
            <input className={inputCls} inputMode="decimal" value={form.netWeight} onChange={set('netWeight')} />
          </Field>
          <Field label={t('Peso bruto', 'Gross weight')}>
            <input className={inputCls} inputMode="decimal" value={form.grossWeight} onChange={set('grossWeight')} />
          </Field>
          <Field label={t('Altura', 'Height')}>
            <input className={inputCls} inputMode="decimal" value={form.height} onChange={set('height')} />
          </Field>
          <Field label={t('Largura', 'Width')}>
            <input className={inputCls} inputMode="decimal" value={form.width} onChange={set('width')} />
          </Field>
          <Field label={t('Profundidade', 'Depth')}>
            <input className={inputCls} inputMode="decimal" value={form.depth} onChange={set('depth')} />
          </Field>
          <Field label={t('Unidades por embalagem', 'Units per package')}>
            <input className={inputCls} inputMode="decimal" value={form.unitsPerPackage} onChange={set('unitsPerPackage')} />
          </Field>
          <div className="col-span-2">
            <Field label={t('Condições de armazenamento', 'Storage conditions')}>
              <input className={inputCls} value={form.storageConditions} onChange={set('storageConditions')} />
            </Field>
          </div>
        </div>
      ) : null}

      {tab === 'fiscal' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('País de origem', 'Country of origin')}>
            <input className={inputCls} value={form.originCountry} onChange={set('originCountry')} />
          </Field>
          <Field label={t('HS Code', 'HS Code')}>
            <input className={inputCls} value={form.hsCode} onChange={set('hsCode')} />
          </Field>
          <Field label={t('NCM', 'NCM')}>
            <input className={inputCls} value={form.ncm} onChange={set('ncm')} />
          </Field>
          <Field label={t('Referência fiscal complementar', 'Additional tax reference')}>
            <input className={inputCls} value={form.taxRef} onChange={set('taxRef')} />
          </Field>
          <p className="col-span-2 text-xs text-subtle">{t('Informações cadastrais; nenhum cálculo de imposto é feito nesta fase.', 'Registration information; no tax calculation is performed at this stage.')}</p>
        </div>
      ) : null}

      {isSandbox(network) ? <p className="mt-3 text-xs text-subtle">{t('Sandbox: validações comerciais relaxadas para experimentação.', 'Sandbox: relaxed business validations for experimentation.')}</p> : null}

      <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onClose}>{t('Cancelar', 'Cancel')}</Button>
        <Button disabled={!valid} onClick={save}>{t('Salvar', 'Save')}</Button>
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
  const network = useNetwork()
  const products = productsForEnvironment(data, network)
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>('all')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [limit, setLimit] = useState(30)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [move, setMove] = useState<{ product: Product; kind: 'in' | 'out' | 'adjust' } | null>(null)
  const [history, setHistory] = useState<Product | null>(null)

  const low = lowStockForEnvironment(data, network)
  const brandSet = useMemo(() => [...new Set(products.map((p) => p.brand).filter((b): b is string => !!b))].sort(), [products])
  const categorySet = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products.filter(
      (p) =>
        (view === 'all' || p.stock <= p.minStock) &&
        (!filterCategory || p.category === filterCategory) &&
        (!filterBrand || p.brand === filterBrand) &&
        (filterStatus === 'all' || (filterStatus === 'active' ? p.active !== false : p.active === false)) &&
        (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.category.toLowerCase().includes(s) || (p.brand ?? '').toLowerCase().includes(s) || (p.barcode ?? '').toLowerCase().includes(s)),
    )
  }, [products, q, view, filterCategory, filterBrand, filterStatus])
  const shown = list.slice(0, limit)
  const potential = products.reduce((s, p) => s + p.stock * p.price, 0)
  const cost = stockValueForEnvironment(data, network)
  const categories = new Set(products.map((p) => p.category)).size
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
        <KpiTile tone="sky" icon={<Layers size={20} />} label={t('Produtos', 'Products')} value={String(products.length)} sub={`${categories} ${categories === 1 ? t('categoria', 'category') : t('categorias', 'categories')}`} />
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
              { id: 'all', label: `${t('Todos', 'All')} (${products.length})` },
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
            placeholder={t('Buscar por nome, marca, SKU ou código de barras', 'Search by name, brand, SKU or barcode')}
            aria-label={t('Buscar produtos', 'Search products')}
            className="min-h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
        </div>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2 sm:px-5">
          {categorySet.length > 1 ? (
            <select className={`${inputCls} !w-auto`} value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setLimit(30) }} aria-label={t('Filtrar por categoria', 'Filter by category')}>
              <option value="">{t('Todas as categorias', 'All categories')}</option>
              {categorySet.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : null}
          {brandSet.length > 1 ? (
            <select className={`${inputCls} !w-auto`} value={filterBrand} onChange={(e) => { setFilterBrand(e.target.value); setLimit(30) }} aria-label={t('Filtrar por marca', 'Filter by brand')}>
              <option value="">{t('Todas as marcas', 'All brands')}</option>
              {brandSet.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          ) : null}
          <select className={`${inputCls} !w-auto`} value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value as 'all' | 'active' | 'inactive'); setLimit(30) }} aria-label={t('Filtrar por status', 'Filter by status')}>
            <option value="all">{t('Todos os status', 'All statuses')}</option>
            <option value="active">{t('Ativos', 'Active')}</option>
            <option value="inactive">{t('Inativos', 'Inactive')}</option>
          </select>
        </div>

        {list.length === 0 ? (
          <Empty
            icon={<Boxes size={22} />}
            title={products.length ? t('Nada encontrado', 'Nothing found') : t('Nenhum produto cadastrado', 'No products yet')}
            text={t('Cadastre seus produtos para controlar estoque, custo e margem.', 'Add your products to track stock, cost and margin.')}
            action={
              !products.length ? (
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
                      <tr key={p.id} className={`transition hover:bg-fill/5 ${p.active === false ? 'opacity-60' : ''}`}>
                        <td className={td}>
                          <div className="flex items-center gap-2 font-semibold">
                            {p.name}
                            {p.active === false ? <Badge tone="neutral">{t('Inativo', 'Inactive')}</Badge> : null}
                          </div>
                          <div className="mono text-xs text-subtle">
                            {p.sku || t('sem SKU', 'no SKU')}
                            {p.brand ? ` · ${p.brand}` : ''}
                          </div>
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
                  <li key={p.id} className={`space-y-3 p-4 ${p.active === false ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {p.name}
                          {p.active === false ? <span className="ml-2 align-middle"><Badge tone="neutral">{t('Inativo', 'Inactive')}</Badge></span> : null}
                        </p>
                        <p className="mono truncate text-xs text-subtle">
                          {p.sku || t('sem SKU', 'no SKU')}{p.brand ? ` · ${p.brand}` : ''} · {p.category}
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
