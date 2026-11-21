import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Modal, inputCls } from '@/components/ui'
import { useStore } from '@/lib/store'
import { CURRENCIES, DIRECTIONS, type ShipmentInput } from '@/lib/logistics'
import { money, parseNum } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { CurrencyCode, Shipment, ShipmentDirection } from '@/lib/types'
import { directionLabel, explain } from './labels'

interface PkgRow {
  key: number
  weightKg: string
  lengthCm: string
  widthCm: string
  heightCm: string
}
interface ItemRow {
  key: number
  productId: string
  name: string
  sku: string
  qty: string
}
interface Form {
  direction: ShipmentDirection
  orderKind: 'none' | 'sale' | 'purchase'
  saleId: string
  purchaseId: string
  purchaseLabel: string
  senderName: string
  recipientName: string
  originName: string
  originCity: string
  originCountry: string
  destName: string
  destCity: string
  destCountry: string
  carrier: string
  carrierId: string
  trackingNumber: string
  method: string
  declaredValue: string
  currency: CurrencyCode
  freightCost: string
  estimatedDelivery: string
  packages: PkgRow[]
  items: ItemRow[]
}

let seq = 1

const PKG_LABEL = (): Record<'weightKg' | 'lengthCm' | 'widthCm' | 'heightCm', string> => ({
  weightKg: t('Peso (kg)', 'Weight (kg)'),
  lengthCm: t('Compr. (cm)', 'Length (cm)'),
  widthCm: t('Larg. (cm)', 'Width (cm)'),
  heightCm: t('Alt. (cm)', 'Height (cm)'),
})

const blankPkg = (): PkgRow => ({ key: seq++, weightKg: '', lengthCm: '', widthCm: '', heightCm: '' })
const blankItem = (): ItemRow => ({ key: seq++, productId: '', name: '', sku: '', qty: '1' })
const numOrZero = (s: string): number => (s.trim() === '' ? 0 : parseNum(s))

interface Props {
  target: Shipment | 'new' | null
  onClose: () => void
  onSaved: (id: string) => void
}

export function ShipmentForm({ target, onClose, onSaved }: Props) {
  const { data, createShipment, updateShipment } = useStore()
  const editing = target && target !== 'new' ? target : null
  const [loaded, setLoaded] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [error, setError] = useState('')

  const key = target === null ? null : editing ? editing.id : 'new'
  if (key !== loaded) {
    setLoaded(key)
    setError('')
    if (!target) setForm(null)
    else if (editing)
      setForm({
        direction: editing.direction,
        orderKind: editing.orderRef?.kind ?? 'none',
        saleId: editing.orderRef?.kind === 'sale' ? (editing.orderRef.id ?? '') : '',
        purchaseId: editing.orderRef?.kind === 'purchase' ? (editing.orderRef.id ?? '') : '',
        purchaseLabel: editing.orderRef?.kind === 'purchase' ? editing.orderRef.label : '',
        senderName: editing.senderName,
        recipientName: editing.recipientName,
        originName: editing.origin.name,
        originCity: editing.origin.city,
        originCountry: editing.origin.country,
        destName: editing.destination.name,
        destCity: editing.destination.city,
        destCountry: editing.destination.country,
        carrier: editing.carrier,
        carrierId: editing.carrierId ?? '',
        trackingNumber: editing.trackingNumber,
        method: editing.method,
        declaredValue: editing.declaredValue ? String(editing.declaredValue) : '',
        currency: editing.currency,
        freightCost: editing.freightCost ? String(editing.freightCost) : '',
        estimatedDelivery: editing.estimatedDelivery ?? '',
        packages: editing.packages.map((p) => ({ key: seq++, weightKg: String(p.weightKg), lengthCm: String(p.lengthCm), widthCm: String(p.widthCm), heightCm: String(p.heightCm) })),
        items: editing.items.map((i) => ({ key: seq++, productId: i.productId ?? '', name: i.name, sku: i.sku, qty: String(i.qty) })),
      })
    else
      setForm({
        direction: 'outbound',
        orderKind: 'none',
        saleId: '',
        purchaseId: '',
        purchaseLabel: '',
        senderName: data.settings.company,
        recipientName: '',
        originName: '',
        originCity: '',
        originCountry: '',
        destName: '',
        destCity: '',
        destCountry: '',
        carrier: '',
        carrierId: '',
        trackingNumber: '',
        method: '',
        declaredValue: '',
        currency: data.settings.currency,
        freightCost: '',
        estimatedDelivery: '',
        packages: [blankPkg()],
        items: [blankItem()],
      })
  }

  if (!form) return <Modal open={false} onClose={onClose} title="" children={null} />

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const text = (k: keyof Form) => ({ className: inputCls, value: form[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value as never) })
  const sales = data.sales.filter((s) => !s.canceledAt).slice(0, 100)

  const pickDirection = (d: ShipmentDirection) =>
    setForm((f) => {
      if (!f) return f
      const me = data.settings.company
      return {
        ...f,
        direction: d,
        orderKind: (d === 'outbound' && f.orderKind === 'sale') || (d === 'inbound' && f.orderKind === 'purchase') ? f.orderKind : 'none',
        saleId: d === 'outbound' ? f.saleId : '',
        purchaseId: d === 'inbound' ? f.purchaseId : '',
        senderName: d === 'outbound' && !f.senderName ? me : f.senderName,
        recipientName: d === 'inbound' && !f.recipientName ? me : f.recipientName,
      }
    })

  const pickSale = (id: string) =>
    setForm((f) => {
      if (!f) return f
      const sale = data.sales.find((s) => s.id === id)
      if (!sale) return { ...f, saleId: id }
      const noItems = f.items.every((i) => !i.productId && !i.name)
      return {
        ...f,
        saleId: id,
        recipientName: f.recipientName || sale.customerName,
        items: noItems ? sale.items.map((i) => ({ key: seq++, productId: i.productId, name: i.name, sku: data.products.find((p) => p.id === i.productId)?.sku ?? '', qty: String(i.qty) })) : f.items,
      }
    })

  const pickPurchase = (id: string) =>
    setForm((f) => {
      if (!f) return f
      const purchase = data.purchases.find((p) => p.id === id)
      if (!purchase) return { ...f, purchaseId: id }
      const noItems = f.items.every((i) => !i.productId && !i.name)
      return {
        ...f,
        purchaseId: id,
        purchaseLabel: purchase.supplierName,
        senderName: f.senderName || purchase.supplierName,
        items: noItems ? purchase.items.map((i) => ({ key: seq++, productId: i.productId, name: i.name, sku: i.sku, qty: String(i.qty) })) : f.items,
      }
    })

  const patchPkg = (key: number, p: Partial<PkgRow>) => set('packages', form.packages.map((x) => (x.key === key ? { ...x, ...p } : x)))
  const patchItem = (key: number, p: Partial<ItemRow>) => set('items', form.items.map((x) => (x.key === key ? { ...x, ...p } : x)))

  const submit = () => {
    const input: ShipmentInput = {
      direction: form.direction,
      orderRef:
        form.orderKind === 'sale'
          ? { kind: 'sale', id: form.saleId, label: form.saleId }
          : form.orderKind === 'purchase'
            ? { kind: 'purchase', id: form.purchaseId || undefined, label: form.purchaseLabel }
            : undefined,
      origin: { name: form.originName, city: form.originCity, country: form.originCountry },
      destination: { name: form.destName, city: form.destCity, country: form.destCountry },
      senderName: form.senderName,
      recipientName: form.recipientName,
      carrier: form.carrier,
      carrierId: form.carrierId || undefined,
      trackingNumber: form.trackingNumber,
      method: form.method,
      packages: form.packages.filter((p) => [p.weightKg, p.lengthCm, p.widthCm, p.heightCm].some((v) => v.trim() !== '')).map((p) => ({ weightKg: numOrZero(p.weightKg), lengthCm: numOrZero(p.lengthCm), widthCm: numOrZero(p.widthCm), heightCm: numOrZero(p.heightCm) })),
      items: form.items.filter((i) => i.productId || i.name.trim()).map((i) => ({ productId: i.productId || undefined, name: i.name, sku: i.sku, qty: parseNum(i.qty) })),
      declaredValue: numOrZero(form.declaredValue),
      currency: form.currency,
      freightCost: numOrZero(form.freightCost),
      estimatedDelivery: form.estimatedDelivery || undefined,
    }
    const res = editing ? updateShipment(editing.id, input) : createShipment(input)
    if (!res.ok) {
      setError(explain(res.errors))
      return
    }
    toast.success(editing ? t('Remessa atualizada.', 'Shipment updated.') : t('Remessa criada como rascunho.', 'Shipment created as a draft.'))
    const id = editing ? editing.id : (res.value as { id: string }).id
    onClose()
    onSaved(id)
  }

  const section = 'mt-5 border-t border-line pt-4 first:mt-0 first:border-t-0 first:pt-0'
  const h = 'mb-3 text-xs font-semibold uppercase tracking-wider text-subtle'

  return (
    <Modal open onClose={onClose} title={editing ? `${t('Editar remessa', 'Edit shipment')} ${editing.id}` : t('Nova remessa', 'New shipment')} wide>
      <div>
        <section className={section}>
          <h3 className={h}>{t('Tipo e pedido', 'Type and order')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Tipo de remessa', 'Shipment type')} hint={editing ? t('O tipo não muda depois de criada.', 'The type cannot change after creation.') : undefined}>
              <select className={inputCls} value={form.direction} disabled={!!editing} onChange={(e) => pickDirection(e.target.value as ShipmentDirection)}>
                {DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {directionLabel(d)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Pedido relacionado', 'Related order')}>
              <select className={inputCls} value={form.orderKind} onChange={(e) => set('orderKind', e.target.value as Form['orderKind'])}>
                <option value="none">{t('Nenhum', 'None')}</option>
                {form.direction === 'outbound' ? <option value="sale">{t('Venda', 'Sale')}</option> : null}
                {form.direction === 'inbound' ? <option value="purchase">{t('Compra', 'Purchase')}</option> : null}
              </select>
            </Field>
          </div>
          {form.orderKind === 'sale' ? (
            <div className="mt-3">
              <Field label={t('Venda', 'Sale')}>
                <select className={inputCls} value={form.saleId} onChange={(e) => pickSale(e.target.value)}>
                  <option value="">{t('Selecione', 'Select')}</option>
                  {sales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.customerName} · {money(s.total)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}
          {form.orderKind === 'purchase' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t('Compra registrada', 'Recorded purchase')} hint={t('Compras feitas na aba Compras. Vincular valida os itens e evita receber duas vezes.', 'Purchases made in the Purchases tab. Linking validates items and prevents receiving twice.')}>
                <select className={inputCls} value={form.purchaseId} onChange={(e) => pickPurchase(e.target.value)}>
                  <option value="">{t('Nenhuma (referência manual)', 'None (manual reference)')}</option>
                  {data.purchases
                    .filter((p) => !p.receiptId || p.id === form.purchaseId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id} · {p.supplierName} · {money(p.total)}
                        {p.stockPosted ? '' : ` · ${t('aguardando recebimento', 'awaiting receipt')}`}
                      </option>
                    ))}
                </select>
              </Field>
              {!form.purchaseId ? (
                <Field label={t('Referência manual', 'Manual reference')} hint={t('Texto livre, sem vínculo.', 'Free text, not linked.')}>
                  <input {...text('purchaseLabel')} maxLength={80} />
                </Field>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className={section}>
          <h3 className={h}>{t('Partes e rota', 'Parties and route')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Remetente', 'Sender')}>
              <input {...text('senderName')} maxLength={80} />
            </Field>
            <Field label={t('Destinatário', 'Recipient')}>
              <input {...text('recipientName')} maxLength={80} />
            </Field>
            <div className="space-y-3">
              <Field label={t('Origem: local', 'Origin: place')}>
                <input {...text('originName')} maxLength={80} placeholder={t('Ex.: Armazém central', 'E.g. Central warehouse')} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('Cidade', 'City')}>
                  <input {...text('originCity')} maxLength={80} />
                </Field>
                <Field label={t('País', 'Country')}>
                  <input {...text('originCountry')} maxLength={60} />
                </Field>
              </div>
            </div>
            <div className="space-y-3">
              <Field label={t('Destino: local', 'Destination: place')}>
                <input {...text('destName')} maxLength={80} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('Cidade', 'City')}>
                  <input {...text('destCity')} maxLength={80} />
                </Field>
                <Field label={t('País', 'Country')}>
                  <input {...text('destCountry')} maxLength={60} />
                </Field>
              </div>
            </div>
          </div>
        </section>

        <section className={section}>
          <h3 className={h}>{t('Transporte', 'Transport')}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('Transportadora', 'Carrier')}>
              <select
                className={inputCls}
                value={form.carrierId}
                onChange={(e) => {
                  const c = data.carriers.find((x) => x.id === e.target.value)
                  setForm({ ...form, carrierId: e.target.value, carrier: c ? c.name : form.carrierId ? '' : form.carrier })
                }}
              >
                <option value="">{t('Outra (digitar nome)', 'Other (type a name)')}</option>
                {data.carriers
                  .filter((c) => c.active || c.id === form.carrierId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.active ? '' : ` (${t('inativa', 'inactive')})`}
                    </option>
                  ))}
              </select>
              {!form.carrierId ? <input {...text('carrier')} className={`${inputCls} mt-2`} maxLength={60} placeholder={t('Nome da transportadora', 'Carrier name')} /> : null}
            </Field>
            <Field label={t('Código de rastreio', 'Tracking number')}>
              <input {...text('trackingNumber')} className={`${inputCls} mono`} maxLength={40} />
            </Field>
            <Field label={t('Método de envio', 'Shipping method')}>
              <input {...text('method')} list="ship-methods" maxLength={40} />
              <datalist id="ship-methods">
                {[t('Padrão', 'Standard'), t('Expresso', 'Express'), t('Econômico', 'Economy'), t('Aéreo', 'Air freight'), t('Marítimo', 'Sea freight'), t('Rodoviário', 'Road freight')].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
          </div>
        </section>

        <section className={section}>
          <h3 className={h}>{t('Volumes (peso e dimensões)', 'Packages (weight and dimensions)')}</h3>
          <div className="space-y-2">
            {form.packages.map((p) => (
              <div key={p.key} className="grid grid-cols-[repeat(4,minmax(0,1fr))_40px] items-end gap-2">
                {(['weightKg', 'lengthCm', 'widthCm', 'heightCm'] as const).map((f) => (
                  <label key={f} className="block">
                    <span className="mb-1 block text-[11px] text-subtle">
                      {PKG_LABEL()[f]}
                    </span>
                    <input className={inputCls} inputMode="decimal" value={p[f]} onChange={(e) => patchPkg(p.key, { [f]: e.target.value })} />
                  </label>
                ))}
                <button type="button" aria-label={t('Remover volume', 'Remove package')} onClick={() => set('packages', form.packages.filter((x) => x.key !== p.key))} className="flex size-10 items-center justify-center rounded-lg text-bad hover:bg-bad/10">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <Button variant="ghost" small onClick={() => set('packages', [...form.packages, blankPkg()])}>
              <Plus size={14} /> {t('Adicionar volume', 'Add package')}
            </Button>
          </div>
        </section>

        <section className={section}>
          <h3 className={h}>{t('Itens', 'Items')}</h3>
          <p className="mb-2 text-xs text-subtle">{t('Registrar itens não altera o estoque.', 'Recording items does not change inventory.')}</p>
          <div className="space-y-2">
            {form.items.map((it) => (
              <div key={it.key} className="grid grid-cols-[minmax(0,1fr)_84px_40px] items-center gap-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    aria-label={t('Produto', 'Product')}
                    className={inputCls}
                    value={it.productId}
                    onChange={(e) => {
                      const p = data.products.find((x) => x.id === e.target.value)
                      patchItem(it.key, { productId: e.target.value, name: p ? p.name : it.name, sku: p ? p.sku : it.sku })
                    }}
                  >
                    <option value="">{t('Item avulso', 'One-off item')}</option>
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {it.productId ? null : <input aria-label={t('Nome do item', 'Item name')} className={inputCls} placeholder={t('Nome do item', 'Item name')} value={it.name} maxLength={80} onChange={(e) => patchItem(it.key, { name: e.target.value })} />}
                </div>
                <input aria-label={t('Quantidade', 'Quantity')} className={inputCls} inputMode="decimal" value={it.qty} onChange={(e) => patchItem(it.key, { qty: e.target.value })} />
                <button type="button" aria-label={t('Remover item', 'Remove item')} onClick={() => set('items', form.items.filter((x) => x.key !== it.key))} className="flex size-10 items-center justify-center rounded-lg text-bad hover:bg-bad/10">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <Button variant="ghost" small onClick={() => set('items', [...form.items, blankItem()])}>
              <Plus size={14} /> {t('Adicionar item', 'Add item')}
            </Button>
          </div>
        </section>

        <section className={section}>
          <h3 className={h}>{t('Valores e prazo', 'Values and schedule')}</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t('Valor declarado', 'Declared value')}>
              <input {...text('declaredValue')} inputMode="decimal" placeholder="0,00" />
            </Field>
            <Field label={t('Moeda', 'Currency')}>
              <select className={inputCls} value={form.currency} onChange={(e) => set('currency', e.target.value as CurrencyCode)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Frete', 'Freight')}>
              <input {...text('freightCost')} inputMode="decimal" placeholder="0,00" />
            </Field>
            <Field label={t('Entrega prevista', 'Estimated delivery')}>
              <input type="date" className={inputCls} value={form.estimatedDelivery} onChange={(e) => set('estimatedDelivery', e.target.value)} />
            </Field>
          </div>
        </section>

        {error ? (
          <p role="alert" className="mt-4 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar', 'Cancel')}
          </Button>
          <Button onClick={submit}>{editing ? t('Salvar alterações', 'Save changes') : t('Criar remessa', 'Create shipment')}</Button>
        </div>
      </div>
    </Modal>
  )
}
