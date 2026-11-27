import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { AlertTriangle, CalendarClock, FileText, Plus, ShoppingBag, Store, Trash2, Truck, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty, Field, Modal, inputCls } from '@/components/ui'
import { DateField } from '@/components/DateField'
import { isValidIso } from '@/lib/dates'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { PurchaseReconciliationPanel } from '@/components/accounting/PurchaseReconciliationPanel'
import { useStore } from '@/lib/store'
import { useNav, type ProfileIntent } from '@/lib/nav'
import { useNetwork } from '@/lib/network'
import { accountsForEnvironment, contactsForEnvironment, entriesForEnvironment, inPeriod, monthPeriod, productsForEnvironment } from '@/lib/selectors'
import { addDays, daysUntil, fmtDate, money, parseNum, today } from '@/lib/format'
import { t } from '@/lib/i18n'
import { CAT_PURCHASE, type Account } from '@/lib/types'
import { accountNote, openNote, purchaseNote } from '@/lib/note'

interface Line {
  key: number
  productId: string
  qty: string
  cost: string
}

let seq = 1

interface QuickForm {
  name: string
  sku: string
  brand: string
  category: string
  unit: string
  cost: string
  price: string
  minStock: string
}

const quickBlank: QuickForm = { name: '', sku: '', brand: '', category: '', unit: 'un', cost: '', price: '', minStock: '0' }

/** Cadastro rápido de produto a partir da aba Compras (quantidade inicial zero, sem movimentação). */
function QuickAddProductModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string, cost: number) => void }) {
  const { addProduct } = useStore()
  const [form, setForm] = useState<QuickForm>(quickBlank)
  const [loaded, setLoaded] = useState(false)
  if (open && !loaded) {
    setLoaded(true)
    setForm(quickBlank)
  } else if (!open && loaded) {
    setLoaded(false)
  }
  const set = (k: keyof QuickForm) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const cost = parseNum(form.cost)
  const price = parseNum(form.price)
  const valid = form.name.trim() !== '' && cost >= 0 && price >= 0 && !Number.isNaN(cost) && !Number.isNaN(price)
  const save = () => {
    const id = addProduct({
      sku: form.sku.trim(),
      name: form.name.trim(),
      brand: form.brand.trim() || undefined,
      category: form.category.trim() || 'Geral',
      unit: form.unit.trim() || 'un',
      cost,
      referenceCost: cost,
      price,
      minStock: Math.max(0, parseNum(form.minStock) || 0),
      stock: 0,
    })
    if (!id) return
    onCreated(id, cost)
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={t('Cadastrar novo produto', 'Add new product')} subtitle={t('O produto entra com quantidade zero; o estoque muda somente na compra.', 'The product starts with zero quantity; stock changes only on purchase.')}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label={t('Nome', 'Name')} required>
            <input className={inputCls} value={form.name} onChange={set('name')} placeholder={t('Ex.: Arroz 1kg', 'E.g. Rice 1kg')} />
          </Field>
        </div>
        <Field label="SKU">
          <input className={inputCls} value={form.sku} onChange={set('sku')} />
        </Field>
        <Field label={t('Marca', 'Brand')}>
          <input className={inputCls} value={form.brand} onChange={set('brand')} />
        </Field>
        <Field label={t('Categoria', 'Category')}>
          <input className={inputCls} value={form.category} onChange={set('category')} />
        </Field>
        <Field label={t('Custo de referência', 'Reference cost')}>
          <input className={inputCls} inputMode="decimal" value={form.cost} onChange={set('cost')} placeholder="0,00" />
        </Field>
        <Field label={t('Preço de venda', 'Sale price')}>
          <input className={inputCls} inputMode="decimal" value={form.price} onChange={set('price')} placeholder="0,00" />
        </Field>
        <Field label={t('Estoque mínimo', 'Minimum stock')}>
          <input className={inputCls} inputMode="decimal" value={form.minStock} onChange={set('minStock')} />
        </Field>
        <Field label={t('Unidade', 'Unit')}>
          <input className={inputCls} value={form.unit} onChange={set('unit')} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t('Cancelar', 'Cancel')}</Button>
        <Button disabled={!valid} onClick={save}>{t('Salvar', 'Save')}</Button>
      </div>
    </Modal>
  )
}

export function Purchases() {
  const { data, recordPurchase } = useStore()
  const { profileIntent, clearProfileIntent } = useNav()
  const network = useNetwork()
  const suppliers = contactsForEnvironment(data, network).filter((c) => c.kind === 'supplier')
  const products = productsForEnvironment(data, network)
  const scopedAccounts = accountsForEnvironment(data.accounts, network)
  const [supplierId, setSupplierId] = useState('')
  const [paidNow, setPaidNow] = useState(false)
  const [awaitReceipt, setAwaitReceipt] = useState(false)
  const [dueDate, setDueDate] = useState(addDays(today(), 15))
  const [lines, setLines] = useState<Line[]>([{ key: seq++, productId: '', qty: '', cost: '' }])
  const [quickAdd, setQuickAdd] = useState(false)
  const [quickAddLine, setQuickAddLine] = useState<number | null>(null)
  const submitting = useRef(false)
  const [limit, setLimit] = useState(15)
  const [supplierFilter, setSupplierFilter] = useState<{ id: string; name: string } | null>(null)

  // Consome a intenção de navegação vinda de um perfil (uma única vez por navegação).
  const [seenIntent, setSeenIntent] = useState<ProfileIntent | null>(null)
  if (profileIntent && profileIntent !== seenIntent) {
    setSeenIntent(profileIntent)
    if (profileIntent.kind === 'purchase') {
      if (suppliers.some((s) => s.id === profileIntent.supplierId)) setSupplierId(profileIntent.supplierId)
    } else if (profileIntent.kind === 'purchases') {
      if (suppliers.some((s) => s.id === profileIntent.supplierId)) setSupplierFilter({ id: profileIntent.supplierId, name: profileIntent.supplierName })
    }
  } else if (!profileIntent && seenIntent) {
    setSeenIntent(null)
  }
  useEffect(() => {
    if (profileIntent) clearProfileIntent()
  }, [profileIntent, clearProfileIntent])

  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const parsed = lines.map((l) => ({ ...l, q: parseNum(l.qty), c: parseNum(l.cost) }))
  const valid = (paidNow || isValidIso(dueDate)) && parsed.length > 0 && parsed.every((l) => l.productId && l.q > 0 && l.c >= 0 && !Number.isNaN(l.c))
  const total = parsed.reduce((s, l) => s + (l.q > 0 && l.c >= 0 ? l.q * l.c : 0), 0)

  const submit = () => {
    // Proteção contra duplo clique/submissão concorrente na mesma intenção.
    if (submitting.current) return
    submitting.current = true
    try {
      // Só limpa o formulário e confirma após sucesso efetivo (sem falso sucesso).
      const ok = recordPurchase({
        supplierId: supplierId || undefined,
        paidNow,
        dueDate,
        awaitReceipt,
        items: parsed.map((l) => ({ productId: l.productId, qty: l.q, cost: l.c })),
      })
      if (!ok) return
      toast.success(
        awaitReceipt
          ? t('Compra registrada. Aguardando recebimento na Logística Global.', 'Purchase recorded. Awaiting receipt in Global Logistics.')
          : t('Compra registrada. Liquide a obrigação na tesouraria quando pagar.', 'Purchase recorded. Settle the obligation in Treasury when you pay.'),
      )
      setLines([{ key: seq++, productId: '', qty: '', cost: '' }])
      setSupplierId('')
      setAwaitReceipt(false)
    } finally {
      submitting.current = false
    }
  }

  const history = [
    ...entriesForEnvironment(data, network).filter((e) => e.category === CAT_PURCHASE).map((e) => ({ id: e.id, date: e.date, desc: e.description, amount: e.amount, paid: true, contactId: undefined as string | undefined })),
    ...scopedAccounts
      .filter((a) => a.kind === 'payable' && a.category === CAT_PURCHASE && a.status === 'open')
      .map((a) => ({ id: a.id, date: a.dueDate, desc: a.description, amount: a.amount, paid: false, contactId: a.contactId })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  const filteredHistory = supplierFilter ? history.filter((h) => h.contactId === supplierFilter.id) : history
  const shown = filteredHistory.slice(0, limit)

  const month = monthPeriod(0)
  const paidMonth = entriesForEnvironment(data, network).filter((e) => e.category === CAT_PURCHASE && e.type === 'out' && inPeriod(e.date, month))
  const openPurchases = scopedAccounts.filter((a) => a.kind === 'payable' && a.category === CAT_PURCHASE && a.status === 'open')
  const openTotal = openPurchases.reduce((s, a) => s + a.amount, 0)
  const soon = openPurchases.filter((a) => daysUntil(a.dueDate) <= 7)
  const soonTotal = soon.reduce((s, a) => s + a.amount, 0)
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  const statusBadge = (paid: boolean) => (paid ? <Badge tone="ok">{t('Paga', 'Paid')}</Badge> : <Badge tone="warn">{t('A pagar', 'Payable')}</Badge>)

  // Gera a nota/comprovante de uma compra recente: prefere a compra registrada (com itens) e cai
  // para o comprovante da conta a pagar quando não há compra vinculada.
  const printNote = (h: { id: string; date: string; desc: string; amount: number; paid: boolean }) => {
    const account = data.accounts.find((a) => a.id === h.id)
    const purchase = account?.sourceId ? data.purchases.find((p) => p.id === account.sourceId) : undefined
    if (purchase) {
      openNote(purchaseNote(purchase, data.settings))
      return
    }
    if (account) {
      openNote(accountNote(account, data.settings))
      return
    }
    const entry = data.entries.find((e) => e.id === h.id)
    const linked = entry?.sourceId ? data.purchases.find((p) => p.id === entry.sourceId) : undefined
    if (linked) {
      openNote(purchaseNote(linked, data.settings))
      return
    }
    // Legado sem compra vinculada: comprovante simples da conta.
    const fallback: Account = {
      id: h.id,
      kind: 'payable',
      description: h.desc,
      contactName: data.settings.company,
      amount: h.amount,
      dueDate: h.date,
      category: CAT_PURCHASE,
      status: h.paid ? 'paid' : 'open',
      source: 'purchase',
    }
    openNote(accountNote(fallback, data.settings))
  }

  // Após cadastrar um produto pelo formulário, seleciona-o na linha de origem e preenche o custo.
  const handleQuickCreated = (id: string, cost: number) => {
    if (quickAddLine != null) patch(quickAddLine, { productId: id, cost: String(cost) })
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title={t('Compras', 'Purchases')}
        subtitle={t('Registre a entrada de mercadorias. O estoque e o custo são atualizados, e a obrigação vira conta a pagar até ser liquidada na tesouraria.', 'Record incoming goods. Stock and cost are updated, and the obligation becomes a payable until settled in Treasury.')}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="violet" icon={<Truck size={20} />} label={t('Pago no mês', 'Paid this month')} value={money(paidMonth.reduce((s, e) => s + e.amount, 0))} sub={count(paidMonth.length, t('pagamento', 'payment'), t('pagamentos', 'payments'))} />
        <KpiTile tone="warn" icon={<CalendarClock size={20} />} label={t('A pagar a fornecedores', 'Owed to suppliers')} value={money(openTotal)} sub={count(openPurchases.length, t('compra em aberto', 'open purchase'), t('compras em aberto', 'open purchases'))} />
        <KpiTile
          tone="bad"
          icon={<AlertTriangle size={20} />}
          label={t('Vencendo em 7 dias', 'Due within 7 days')}
          value={money(soonTotal)}
          valueTone={soonTotal > 0 ? 'bad' : undefined}
          sub={soon.length ? count(soon.length, t('compra', 'purchase'), t('compras', 'purchases')) : t('Nada a vencer', 'Nothing due')}
        />
        <KpiTile tone="sky" icon={<Store size={20} />} label={t('Fornecedores', 'Suppliers')} value={String(suppliers.length)} sub={suppliers.length ? t('cadastrados', 'registered') : t('Nenhum cadastrado', 'None registered')} />
      </div>

      <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <TCard className="p-4 sm:p-5">
          <PanelTitle icon={<ShoppingBag size={18} />} title={t('Nova compra', 'New purchase')} subtitle={t('Entrada de mercadorias no estoque', 'Goods received into inventory')} />
          <div className="mt-4">
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

                <div className="space-y-3">
                  <span className="label block">{t('Itens', 'Items')}</span>
                  {parsed.map((l) => (
                    <div key={l.key} className="rounded-xl border border-line bg-fill/5 p-2.5">
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_76px_100px_40px]">
                        <select
                          aria-label={t('Produto', 'Product')}
                          className={`${inputCls} col-span-3 sm:col-span-1`}
                          value={l.productId}
                          onChange={(e) => {
                            if (e.target.value === '__new__') {
                              setQuickAddLine(l.key)
                              setQuickAdd(true)
                              return
                            }
                            const p = products.find((x) => x.id === e.target.value)
                            patch(l.key, { productId: e.target.value, cost: p && !l.cost ? String(p.cost) : l.cost })
                          }}
                        >
                          <option value="">{t('Produto', 'Product')}</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                          <option value="__new__">{t('+ Cadastrar novo produto', '+ Add new product')}</option>
                        </select>
                        <input aria-label={t('Quantidade', 'Quantity')} className={inputCls} inputMode="decimal" placeholder={t('Qtd', 'Qty')} value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} />
                        <input aria-label={t('Custo unitário', 'Unit cost')} className={inputCls} inputMode="decimal" placeholder={t('Custo', 'Cost')} value={l.cost} onChange={(e) => patch(l.key, { cost: e.target.value })} />
                        <button
                          aria-label={t('Remover item', 'Remove item')}
                          disabled={lines.length === 1}
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                          className="flex size-10 items-center justify-center rounded-lg text-bad hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 disabled:opacity-30"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      {l.q > 0 && l.c >= 0 ? <p className="num mt-1.5 text-right text-xs text-subtle">{t('Subtotal', 'Subtotal')}: {money(l.q * l.c)}</p> : null}
                    </div>
                  ))}
                  <Button variant="ghost" small onClick={() => setLines((ls) => [...ls, { key: seq++, productId: '', qty: '', cost: '' }])}>
                    <Plus size={14} /> {t('Adicionar item', 'Add item')}
                  </Button>
                </div>

                <div>
                  <span className="label mb-1.5 block">{t('Pagamento', 'Payment')}</span>
                  <PillTabs
                    label={t('Pagamento', 'Payment')}
                    value={paidNow ? 'now' : 'credit'}
                    onChange={(v) => setPaidNow(v === 'now')}
                    items={[
                      { id: 'credit', label: t('A prazo', 'On credit') },
                      { id: 'now', label: t('Pago agora', 'Paid now') },
                    ]}
                  />
                </div>
                {!paidNow ? (
                  <Field label={t('Vencimento', 'Due date')}>
                    <DateField value={dueDate} onChange={setDueDate} />
                  </Field>
                ) : null}

                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line px-3 py-2.5">
                  <input type="checkbox" className="mt-0.5 size-4 accent-violet" checked={awaitReceipt} onChange={(e) => setAwaitReceipt(e.target.checked)} />
                  <span className="text-sm">
                    <span className="font-medium">{t('Aguardar recebimento da mercadoria', 'Wait for goods receipt')}</span>
                    <span className="block text-xs text-muted text-pretty">
                      {t('O estoque só aumenta quando você confirmar o recebimento na Logística Global. Deixe desmarcado para somar agora.', 'Stock only goes up when you confirm the receipt in Global Logistics. Leave unchecked to add it now.')}
                    </span>
                  </span>
                </label>

                <p className="rounded-xl bg-fill/5 px-3 py-2 text-xs text-muted text-pretty">
                  {awaitReceipt
                    ? t(
                        'Ao registrar: uma remessa de entrada é criada na Logística Global e uma conta a pagar é aberta. Estoque, custo e lançamento contábil só acontecem quando você marcar como recebido.',
                        'On save: an inbound shipment is created in Global Logistics and a payable is opened. Stock, cost and the accounting entry only happen when you mark it as received.',
                      )
                    : t(
                        'Ao registrar: o estoque aumenta, o custo dos produtos é atualizado e uma conta a pagar é aberta para você liquidar na tesouraria.',
                        'On save: stock goes up, product cost is updated and a payable is opened for you to settle in Treasury.',
                      )}
                </p>

                <div className="flex items-center justify-between border-t border-line pt-4">
                  <span className="text-sm text-muted">{t('Total da compra', 'Purchase total')}</span>
                  <span className="display num text-xl font-semibold">{money(total)}</span>
                </div>
                <Button className="w-full" disabled={!valid} onClick={submit}>
                  {t('Registrar compra', 'Record purchase')}
                </Button>
              </div>
          </div>
        </TCard>

        <TCard className="overflow-hidden">
          <div className="border-b border-line p-4 sm:px-5">
            <PanelTitle icon={<Truck size={18} />} title={t('Compras recentes', 'Recent purchases')} subtitle={count(filteredHistory.length, t('registro', 'record'), t('registros', 'records'))} />
            {supplierFilter ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="accent">{t('Fornecedor', 'Supplier')}: {supplierFilter.name}</Badge>
                <Button small variant="ghost" onClick={() => setSupplierFilter(null)}>
                  <X size={14} /> {t('Limpar filtro', 'Clear filter')}
                </Button>
              </div>
            ) : null}
          </div>
          {filteredHistory.length === 0 ? (
            <Empty icon={<ShoppingBag size={22} />} title={t('Nenhuma compra registrada', 'No purchases recorded')} />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {shown.map((h) => (
                  <li key={h.id} className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{h.desc}</p>
                      <p className="mt-0.5 text-xs text-subtle">
                        {h.paid ? '' : `${t('Vencimento', 'Due date')}: `}
                        {fmtDate(h.date)}
                      </p>
                    </div>
                    <div className="shrink-0 space-y-1 text-right">
                      <div className="num whitespace-nowrap text-sm font-semibold">{money(h.amount)}</div>
                      <div className="flex items-center justify-end gap-1.5">
                        {statusBadge(h.paid)}
                        <button
                          aria-label={t('Nota / PDF', 'Note / PDF')}
                          onClick={() => printNote(h)}
                          className="flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
                        >
                          <FileText size={14} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {filteredHistory.length > shown.length ? (
                <div className="border-t border-line p-3 text-center">
                  <Button variant="ghost" small onClick={() => setLimit((l) => l + 15)}>
                    {t('Ver mais', 'View more')} ({filteredHistory.length - shown.length})
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </TCard>
      </div>

      <PurchaseReconciliationPanel />

      <QuickAddProductModal open={quickAdd} onClose={() => setQuickAdd(false)} onCreated={handleQuickCreated} />
    </div>
  )
}
