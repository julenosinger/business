import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  CAT_PAYROLL,
  CAT_PURCHASE,
  CAT_SALES,
  type Account,
  type AppData,
  type Contact,
  type Employee,
  type Entry,
  type PayMethod,
  type PaymentRequest,
  type Product,
  type Sale,
  type Settings,
  type ShipmentDocumentType,
  type ShipmentStatus,
  type TreasuryOp,
} from './types'
import { addDays, round2, setCurrency, today } from './format'
import * as logistics from './logistics'
import * as fulfillment from './fulfillment'
import * as receiving from './receiving'
import * as carriers from './carriers'
import * as freight from './freight'
import * as international from './international'
import * as returns from './returns'
import { buildDemoData } from './demo'
import { emptyLedger, normalizeLedger, setAdapterFlag, closePeriod, reopenPeriod, setPeriodReview, isDateClosed, type AdapterFlagName, type Ctx, type OpResult } from './accounting/engine'
import { autoPost } from './accounting/autopost'
import * as chartOps from './accounting/chart-ops'
import * as reviewOps from './accounting/reviews'
import { confirmFee, registerFee, type FeeInput } from './accounting/engine'
import type { LedgerState, PostErrorCode } from './accounting/types'
import { syncAdded, syncRemoved, syncUpdated, type SyncCtx } from './accounting/cashbook-sync'
import { t } from './i18n'

const STORAGE_KEY = 'gbos:v1'

export const uid = (): string => crypto.randomUUID().slice(0, 12)

export const emptySettings = (): Settings => ({
  company: t('Minha Empresa', 'My Company'),
  branch: t('Matriz', 'Headquarters'),
  owner: t('Empreendedor', 'Entrepreneur'),
  // Instalações novas começam em USDC. Quem já escolheu outra moeda mantém a sua (o que está salvo prevalece).
  currency: 'USDC',
  usdcRate: null,
  approvalLimit: null,
})

/** Ator e contexto de lançamento no razão: o proprietário cadastrado nas Configurações (usuário humano). */
function ledgerCtx(d: AppData): SyncCtx {
  return { now: new Date().toISOString(), actor: { id: d.settings.owner.trim() || 'local-user', kind: 'user' }, currency: d.settings.currency }
}

/** Executa a sincronização com o razão sem nunca propagar exceção: o Livro-Caixa tem prioridade. */
export function guardLedger(d: AppData, run: (ctx: SyncCtx) => AppData['ledger']): AppData['ledger'] {
  try {
    return run(ledgerCtx(d))
  } catch {
    return d.ledger
  }
}

export function emptyData(): AppData {
  return {
    products: [],
    moves: [],
    contacts: [],
    entries: [],
    accounts: [],
    sales: [],
    employees: [],
    treasuryOps: [],
    requests: [],
    shipments: [],
  carriers: [],
  returns: [],
  purchases: [],
  receipts: [],
    ledger: emptyLedger(),
    settings: emptySettings(),
  }
}

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyData()
    const parsed = JSON.parse(raw) as Partial<AppData>
    const base = emptyData()
    return { ...base, ...parsed, ledger: normalizeLedger(parsed.ledger), settings: { ...base.settings, ...(parsed.settings ?? {}) } }
  } catch {
    return emptyData()
  }
}

export type LedgerResult<T> = { ok: true; value: T } | { ok: false; errors: PostErrorCode[] }

export interface SaleInput {
  customerId?: string
  method: PayMethod
  dueDate?: string
  items: { productId: string; qty: number; price: number }[]
}

export interface PurchaseInput {
  supplierId?: string
  paidNow: boolean
  dueDate: string
  items: { productId: string; qty: number; cost: number }[]
  /** Registra a compra sem somar o estoque: ele só entra no recebimento de mercadorias (aba Logística). */
  awaitReceipt?: boolean
}

/** Resultado de uma operação de logística para a interface (sem o estado interno). */
export type LogisticsResult<T> = { ok: true; value: T } | { ok: false; errors: logistics.ErrorCode[] }

export interface Store {
  data: AppData
  addProduct: (p: Omit<Product, 'id'>) => void
  updateProduct: (id: string, patch: Partial<Product>) => void
  removeProduct: (id: string) => void
  moveStock: (productId: string, kind: 'in' | 'out' | 'adjust', qty: number, note: string) => void
  addContact: (c: Omit<Contact, 'id'>) => void
  updateContact: (id: string, patch: Partial<Contact>) => void
  removeContact: (id: string) => void
  addEntry: (e: Omit<Entry, 'id'>) => void
  /** Liga/desliga um adaptador do razão contábil. Cada um só trata registros criados DEPOIS de ligado. */
  setLedgerAdapter: (name: AdapterFlagName, on: boolean) => void
  createLedgerAccount: (input: chartOps.AccountInput) => LedgerResult<{ code: string }>
  updateLedgerAccount: (code: string, patch: chartOps.AccountPatch) => LedgerResult<{ code: string }>
  setLedgerAccountActive: (code: string, active: boolean) => LedgerResult<{ code: string }>
  deleteLedgerAccount: (code: string) => LedgerResult<{ code: string }>
  /** Decisão humana na conciliação (confirmar/falhar uma liquidação pendente com evidência, ou dispensar um item). */
  reviewLedgerItem: (input: reviewOps.ReviewInput) => LedgerResult<{ reviewId: string; entryId: string | null }>
  recordLedgerFxRate: (input: reviewOps.FxInput) => LedgerResult<{ id: string }>
  registerLedgerFee: (input: FeeInput) => LedgerResult<{ feeId: string; duplicate: boolean; entryId: string | null }>
  confirmLedgerFee: (dedupeKey: string, patch: { amountMinor?: string; relatedRef?: string; accountingDate: string }) => LedgerResult<{ entryId: string | null }>
  /** Fechamento de período contábil (bloqueia lançamentos no mês, com auditoria). */
  closeAccountingPeriod: (key: string) => LedgerResult<{ key: string }>
  reopenAccountingPeriod: (key: string, reason: string) => LedgerResult<{ key: string }>
  setAccountingPeriodReview: (key: string) => LedgerResult<{ key: string }>
  updateEntry: (id: string, patch: Partial<Entry>) => void
  removeEntry: (id: string) => void
  addAccount: (a: Omit<Account, 'id' | 'status' | 'source'> & { source?: Account['source'] }) => string
  updateAccount: (id: string, patch: Partial<Account>) => void
  settleAccount: (id: string, treasuryTx?: string) => void
  removeAccount: (id: string) => void
  recordSale: (input: SaleInput) => void
  cancelSale: (id: string) => void
  recordPurchase: (input: PurchaseInput) => void
  addEmployee: (e: Omit<Employee, 'id'>) => void
  updateEmployee: (id: string, patch: Partial<Employee>) => void
  removeEmployee: (id: string) => void
  runPayroll: (month: string, dueDate: string) => number
  addRequest: (r: Omit<PaymentRequest, 'id' | 'status' | 'createdAt'>) => string
  updateRequest: (id: string, patch: Partial<PaymentRequest>) => void
  receiveRequest: (id: string, txHash: string, payer: string, explorerUrl: string) => void
  addTreasuryOp: (op: Omit<TreasuryOp, 'id' | 'date'>) => void
  createShipment: (input: logistics.ShipmentInput) => LogisticsResult<{ id: string }>
  updateShipment: (id: string, input: logistics.ShipmentInput) => LogisticsResult<{ changed: string[] }>
  transitionShipment: (id: string, to: ShipmentStatus, opts?: logistics.TransitionOptions) => LogisticsResult<{ status: ShipmentStatus }>
  addShipmentEvent: (id: string, input: logistics.TrackingInput) => LogisticsResult<{ eventId: string }>
  addShipmentDocument: (id: string, input: { type: ShipmentDocumentType; reference: string }) => LogisticsResult<{ documentId: string }>
  removeShipmentDraft: (id: string) => LogisticsResult<{ id: string }>
  pickShipmentItem: (id: string, itemId: string, qty: number) => LogisticsResult<{ picked: number }>
  packShipment: (id: string) => LogisticsResult<{ mode: 'sale_deducted' | 'on_hand' }>
  recordShipmentPod: (id: string, input: fulfillment.PodInput) => LogisticsResult<{ id: string }>
  closeShipmentFulfillment: (id: string) => LogisticsResult<{ id: string }>
  receiveShipmentGoods: (id: string, input: receiving.ReceiptInput) => LogisticsResult<receiving.ReceiptResult>
  createCarrier: (input: carriers.CarrierInput) => LogisticsResult<{ id: string }>
  updateCarrier: (id: string, input: carriers.CarrierInput) => LogisticsResult<{ id: string }>
  setCarrierActive: (id: string, active: boolean) => LogisticsResult<{ id: string }>
  removeCarrier: (id: string) => LogisticsResult<{ id: string }>
  setShipmentFreight: (id: string, input: freight.FreightInput) => LogisticsResult<{ total: number }>
  postShipmentFreight: (id: string, dueDate: string) => LogisticsResult<{ accountId: string; amount: number }>
  setShipmentInternational: (id: string, input: international.InternationalInput) => LogisticsResult<{ id: string }>
  requestReturn: (input: returns.ReturnRequestInput) => LogisticsResult<{ id: string }>
  authorizeReturn: (id: string, note?: string) => LogisticsResult<{ id: string }>
  rejectReturn: (id: string, note: string) => LogisticsResult<{ id: string }>
  cancelReturn: (id: string, note?: string) => LogisticsResult<{ id: string }>
  createReturnShipment: (id: string) => LogisticsResult<{ shipmentId: string }>
  inspectReturn: (id: string, input: returns.InspectionInput) => LogisticsResult<{ restocked: { productId: string; qty: number }[] }>
  resolveReturn: (id: string, input: returns.ResolutionInput) => LogisticsResult<{ id: string }>
  updateSettings: (patch: Partial<Settings>) => void
  importData: (next: AppData) => void
  loadDemo: () => void
  resetAll: () => void
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(load)

  setCurrency(data.settings.currency)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      toast.error(t('Não foi possível salvar os dados neste navegador. Exporte um backup agora.', 'Could not save data in this browser. Export a backup now.'))
    }
  }, [data])

  // Pede ao navegador para não apagar os dados automaticamente quando faltar espaço.
  useEffect(() => {
    void navigator.storage?.persist?.()
  }, [])

  const store = useMemo<Store>(() => {
    /**
     * Toda mudança passa por aqui: o razão contábil acompanha na MESMA atualização de estado (atômico na memória).
     * `auto: false` é só para substituição total dos dados (backup, demonstração, apagar tudo), que não gera lançamentos.
     */
    const apply = (fn: (d: AppData) => AppData, auto = true): void =>
      setData((d) => {
        const n = fn(d)
        if (!auto || n === d) return n
        return autoPost(d, n, { today: today(), actorId: n.settings.owner.trim() || 'local-user', now: new Date().toISOString() })
      })
    const set = (fn: (d: AppData) => AppData) => apply(fn)

    /** Operações do razão (plano de contas, revisões, câmbio, taxas): valida agora e reaplica no estado mais recente. */
    const runLedger = <T,>(op: (l: LedgerState, ctx: Ctx) => OpResult<T>): LedgerResult<T> => {
      const mk = (d: AppData): Ctx => ({ now: new Date().toISOString(), actor: { id: d.settings.owner.trim() || 'local-user', kind: 'user' } })
      const out = op(data.ledger, mk(data))
      if (!out.ok) {
        setData((d) => ({ ...d, ledger: op(d.ledger, mk(d)).ledger }))
        return { ok: false, errors: out.errors }
      }
      setData((d) => {
        const again = op(d.ledger, mk(d))
        return { ...d, ledger: again.ledger }
      })
      return { ok: true, value: out.value }
    }

    /** Aplica uma mudança destrutiva e oferece desfazer por alguns segundos. */
    const undoable = (fn: (d: AppData) => AppData, message: string, auto = true) => {
      const snapshot = data
      apply(fn, auto)
      toast(message, {
        duration: 8000,
        action: { label: t('Desfazer', 'Undo'), onClick: () => setData(snapshot) },
      })
    }

    const actor = (): string => data.settings.owner || 'user'

    /** Valida no estado atual (para responder à interface) e reaplica no estado mais recente. */
    const runShipmentOp = <T,>(op: (d: AppData, now: string) => logistics.Outcome<T>): LogisticsResult<T> => {
      const now = new Date().toISOString()
      const out = op(data, now)
      if (!out.ok) return out
      apply((d) => {
        const again = op(d, now)
        return again.ok ? again.data : d
      })
      return { ok: true, value: out.value }
    }

    const settle = (d: AppData, id: string, treasuryTx?: string): AppData => {
      const acc = d.accounts.find((a) => a.id === id)
      if (!acc || acc.status === 'paid') return d
      const date = today()
      const entry: Entry = {
        id: uid(),
        date,
        type: acc.kind === 'payable' ? 'out' : 'in',
        category: acc.category,
        description: acc.description,
        amount: acc.amount,
      }
      return {
        ...d,
        entries: [entry, ...d.entries],
        accounts: d.accounts.map((a) => (a.id === id ? { ...a, status: 'paid', paidAt: date, treasuryTx } : a)),
      }
    }

    return {
      data,
      addProduct: (p) =>
        set((d) => {
          const id = uid()
          const first = p.stock > 0 ? [{ id: uid(), productId: id, kind: 'in' as const, qty: p.stock, date: today(), note: t('Estoque inicial', 'Opening stock') }] : []
          return { ...d, products: [{ ...p, id }, ...d.products], moves: [...first, ...d.moves] }
        }),
      updateProduct: (id, patch) => set((d) => ({ ...d, products: d.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removeProduct: (id) => undoable((d) => ({ ...d, products: d.products.filter((p) => p.id !== id) }), t('Produto removido.', 'Product removed.')),
      moveStock: (productId, kind, qty, note) =>
        set((d) => {
          const delta = kind === 'in' ? qty : kind === 'out' ? -qty : 0
          return {
            ...d,
            products: d.products.map((p) =>
              p.id === productId ? { ...p, stock: kind === 'adjust' ? qty : Math.max(0, p.stock + delta) } : p,
            ),
            moves: [{ id: uid(), productId, kind, qty, date: today(), note }, ...d.moves],
          }
        }),
      addContact: (c) => set((d) => ({ ...d, contacts: [{ ...c, id: uid() }, ...d.contacts] })),
      updateContact: (id, patch) => set((d) => ({ ...d, contacts: d.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeContact: (id) => undoable((d) => ({ ...d, contacts: d.contacts.filter((c) => c.id !== id) }), t('Cadastro removido.', 'Record removed.')),
      // Livro-Caixa continua sendo a fonte do caixa. O razão acompanha na MESMA atualização de estado
      // (atômico dentro da memória) e nunca derruba o lançamento manual: erros viram eventos rejeitados na auditoria.
      addEntry: (e) => {
        if (isDateClosed(data.ledger, e.date)) {
          toast.error(t('Período fechado: este mês está fechado e não aceita novos lançamentos. Reabra o período para lançar.', 'Closed period: this month is closed and does not accept new entries. Reopen the period to post.'))
          return
        }
        set((d) => {
          const entry = { ...e, id: uid() }
          return { ...d, entries: [entry, ...d.entries], ledger: guardLedger(d, (ctx) => syncAdded(d.ledger, entry, ctx)) }
        })
      },
      createLedgerAccount: (input) => runLedger((l, ctx) => chartOps.createAccount(l, input, ctx)),
      updateLedgerAccount: (code, patch) => runLedger((l, ctx) => chartOps.updateAccount(l, code, patch, ctx)),
      setLedgerAccountActive: (code, active) => runLedger((l, ctx) => chartOps.setAccountActive(l, code, active, ctx)),
      deleteLedgerAccount: (code) => runLedger((l, ctx) => chartOps.deleteAccount(l, code, ctx)),
      reviewLedgerItem: (input) => runLedger((l, ctx) => reviewOps.recordReview(l, input, ctx)),
      recordLedgerFxRate: (input) => runLedger((l, ctx) => reviewOps.recordFxRate(l, input, ctx)),
      registerLedgerFee: (input) => runLedger((l, ctx) => registerFee(l, input, ctx)),
      confirmLedgerFee: (dedupeKey, patch) => runLedger((l, ctx) => confirmFee(l, dedupeKey, patch, ctx)),
      closeAccountingPeriod: (key) => runLedger((l, ctx) => closePeriod(l, key, ctx)),
      reopenAccountingPeriod: (key, reason) => runLedger((l, ctx) => reopenPeriod(l, key, reason, ctx)),
      setAccountingPeriodReview: (key) => runLedger((l, ctx) => setPeriodReview(l, key, ctx)),
      setLedgerAdapter: (name, on) => set((d) => ({ ...d, ledger: setAdapterFlag(d.ledger, name, on, ledgerCtx(d)) })),
      updateEntry: (id, patch) => {
        const before = data.entries.find((e) => e.id === id)
        if (!before) return
        const after = { ...before, ...patch }
        const financial = (['type', 'amount', 'date', 'category'] as const).some((k) => before[k] !== after[k])
        if (financial && (isDateClosed(data.ledger, before.date) || isDateClosed(data.ledger, after.date))) {
          toast.error(t('Período fechado: edições financeiras neste mês estão bloqueadas. Reabra o período para ajustar.', 'Closed period: financial edits in this month are blocked. Reopen the period to adjust.'))
          return
        }
        set((d) => {
          const b = d.entries.find((e) => e.id === id)
          if (!b) return d
          const a = { ...b, ...patch }
          return { ...d, entries: d.entries.map((e) => (e.id === id ? a : e)), ledger: guardLedger(d, (ctx) => syncUpdated(d.ledger, b, a, ctx)) }
        })
      },
      removeEntry: (id) => {
        const gone = data.entries.find((e) => e.id === id)
        if (gone && isDateClosed(data.ledger, gone.date)) {
          toast.error(t('Período fechado: este lançamento não pode ser removido. Reabra o período para ajustar.', 'Closed period: this entry cannot be removed. Reopen the period to adjust.'))
          return
        }
        undoable((d) => {
          const g = d.entries.find((e) => e.id === id)
          return { ...d, entries: d.entries.filter((e) => e.id !== id), ledger: g ? guardLedger(d, (ctx) => syncRemoved(d.ledger, g, ctx)) : d.ledger }
        }, t('Lançamento removido.', 'Entry removed.'))
      },
      addAccount: (a) => {
        const id = uid()
        set((d) => ({ ...d, accounts: [{ ...a, id, status: 'open', source: a.source ?? 'manual' }, ...d.accounts] }))
        return id
      },
      updateAccount: (id, patch) => set((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      settleAccount: (id, treasuryTx) => set((d) => settle(d, id, treasuryTx)),
      removeAccount: (id) => undoable((d) => ({ ...d, accounts: d.accounts.filter((a) => a.id !== id) }), t('Conta removida.', 'Bill removed.')),
      cancelSale: (id) =>
        undoable((d) => {
          const sale = d.sales.find((s) => s.id === id)
          if (!sale || sale.canceledAt) return d
          const date = today()
          const acc = sale.accountId ? d.accounts.find((a) => a.id === sale.accountId) : undefined
          const needsRefund = sale.method !== 'prazo' || acc?.status === 'paid'
          const next: AppData = {
            ...d,
            sales: d.sales.map((s) => (s.id === id ? { ...s, canceledAt: date } : s)),
            products: d.products.map((p) => {
              const it = sale.items.find((i) => i.productId === p.id)
              return it ? { ...p, stock: p.stock + it.qty } : p
            }),
            moves: [
              ...sale.items.map((i) => ({
                id: uid(),
                productId: i.productId,
                kind: 'in' as const,
                qty: i.qty,
                date,
                note: t(`Cancelamento da venda ${sale.id}`, `Sale ${sale.id} canceled`),
              })),
              ...d.moves,
            ],
          }
          if (acc && acc.status === 'open') next.accounts = d.accounts.filter((a) => a.id !== acc.id)
          if (needsRefund) {
            next.entries = [
              {
                id: uid(),
                date,
                type: 'out',
                category: CAT_SALES,
                description: t(`Estorno da venda para ${sale.customerName}`, `Refund of sale to ${sale.customerName}`),
                amount: sale.total,
              },
              ...d.entries,
            ]
          }
          return next
        }, t('Venda cancelada. Estoque e caixa foram ajustados.', 'Sale canceled. Stock and cash were adjusted.')),
      recordSale: (input) =>
        set((d) => {
          const customer = d.contacts.find((c) => c.id === input.customerId)
          const date = today()
          const saleId = uid()
          const items = input.items.flatMap((it) => {
            const p = d.products.find((x) => x.id === it.productId)
            return p ? [{ productId: p.id, name: p.name, qty: it.qty, price: it.price, cost: p.cost }] : []
          })
          const total = round2(items.reduce((s, i) => s + i.qty * i.price, 0))
          const cogs = round2(items.reduce((s, i) => s + i.qty * i.cost, 0))
          const customerName = customer?.name ?? t('Consumidor final', 'Walk-in customer')
          const next: AppData = {
            ...d,
            products: d.products.map((p) => {
              const it = items.find((i) => i.productId === p.id)
              return it ? { ...p, stock: Math.max(0, p.stock - it.qty) } : p
            }),
            moves: [
              ...items.map((i) => ({ id: uid(), productId: i.productId, kind: 'out' as const, qty: i.qty, date, note: t(`Venda ${saleId}`, `Sale ${saleId}`) })),
              ...d.moves,
            ],
          }
          let accountId: string | undefined
          if (input.method === 'prazo') {
            accountId = uid()
            const acc: Account = {
              id: accountId,
              kind: 'receivable',
              description: t(`Venda a prazo (${items.length} ${items.length === 1 ? 'item' : 'itens'})`, `Credit sale (${items.length} ${items.length === 1 ? 'item' : 'items'})`),
              contactId: customer?.id,
              contactName: customerName,
              amount: total,
              dueDate: input.dueDate ?? addDays(date, 30),
              category: CAT_SALES,
              status: 'open',
              source: 'sale',
            }
            next.accounts = [acc, ...d.accounts]
          } else {
            next.entries = [
              { id: uid(), date, type: 'in', category: CAT_SALES, description: t(`Venda para ${customerName} (${input.method})`, `Sale to ${customerName} (${input.method})`), amount: total },
              ...d.entries,
            ]
          }
          const sale: Sale = { id: saleId, date, customerId: customer?.id, customerName, items, total, cogs, method: input.method, accountId }
          next.sales = [sale, ...d.sales]
          return next
        }),
      recordPurchase: (input) =>
        set((d) => {
          const supplier = d.contacts.find((c) => c.id === input.supplierId)
          const date = today()
          const total = round2(input.items.reduce((s, i) => s + i.qty * i.cost, 0))
          const name = supplier?.name ?? t('Fornecedor avulso', 'One-off supplier')
          const awaiting = !!input.awaitReceipt
          const next: AppData = {
            ...d,
            // Fluxo padrão: a compra soma o estoque na hora. Aguardando recebimento: o estoque só entra no recebimento.
            products: awaiting
              ? d.products
              : d.products.map((p) => {
                  const it = input.items.find((i) => i.productId === p.id)
                  return it ? { ...p, stock: p.stock + it.qty, cost: it.cost } : p
                }),
            moves: awaiting
              ? d.moves
              : [
                  ...input.items.map((i) => ({ id: uid(), productId: i.productId, kind: 'in' as const, qty: i.qty, date, note: t(`Compra de ${name}`, `Purchase from ${name}`) })),
                  ...d.moves,
                ],
            purchases: [
              {
                id: receiving.nextPurchaseId(d.purchases),
                date,
                supplierId: supplier?.id,
                supplierName: name,
                items: input.items.map((i) => {
                  const p = d.products.find((x) => x.id === i.productId)
                  return { productId: i.productId, name: p?.name ?? '', sku: p?.sku ?? '', qty: i.qty, cost: i.cost }
                }),
                total,
                stockPosted: !awaiting,
                createdAt: new Date().toISOString(),
              },
              ...d.purchases,
            ],
          }
          const description = t(`Compra de mercadorias - ${name}`, `Merchandise purchase - ${name}`)
          if (input.paidNow) {
            next.entries = [{ id: uid(), date, type: 'out', category: CAT_PURCHASE, description, amount: total }, ...d.entries]
          } else {
            next.accounts = [
              {
                id: uid(),
                kind: 'payable',
                description,
                contactId: supplier?.id,
                contactName: name,
                amount: total,
                dueDate: input.dueDate,
                category: CAT_PURCHASE,
                status: 'open',
                source: 'purchase',
              },
              ...d.accounts,
            ]
          }
          return next
        }),
      addEmployee: (e) => set((d) => ({ ...d, employees: [{ ...e, id: uid() }, ...d.employees] })),
      updateEmployee: (id, patch) => set((d) => ({ ...d, employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
      removeEmployee: (id) => undoable((d) => ({ ...d, employees: d.employees.filter((e) => e.id !== id) }), t('Funcionário removido.', 'Employee removed.')),
      runPayroll: (month, dueDate) => {
        const pending = (d: AppData) =>
          d.employees
            .filter((e) => e.active)
            .filter((e) => !d.accounts.some((a) => a.source === 'payroll' && a.employeeId === e.id && a.description.endsWith(month)))
        const created = pending(data).length
        apply((d) => {
          const accs: Account[] = pending(d).map((e) => ({
            id: uid(),
            kind: 'payable',
            description: t(`Salário ${e.name} - ${month}`, `Salary ${e.name} - ${month}`),
            contactName: e.name,
            amount: e.salary,
            dueDate,
            category: CAT_PAYROLL,
            status: 'open',
            source: 'payroll',
            employeeId: e.id,
          }))
          return { ...d, accounts: [...accs, ...d.accounts] }
        })
        return created
      },
      addRequest: (r) => {
        const id = uid()
        set((d) => ({ ...d, requests: [{ ...r, id, status: 'open', createdAt: new Date().toISOString() }, ...d.requests] }))
        return id
      },
      updateRequest: (id, patch) => set((d) => ({ ...d, requests: d.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      receiveRequest: (id, txHash, payer, explorerUrl) =>
        set((d) => {
          const r = d.requests.find((x) => x.id === id)
          if (!r || r.status !== 'open') return d
          let next: AppData = {
            ...d,
            requests: d.requests.map((x) => (x.id === id ? { ...x, status: 'paid', txHash, payer, explorerUrl, paidAt: new Date().toISOString() } : x)),
          }
          if (d.accounts.some((a) => a.id === r.accountId && a.status === 'open')) {
            next = settle(next, r.accountId, explorerUrl)
          } else {
            next = {
              ...next,
              entries: [{ id: uid(), date: today(), type: 'in', category: 'Serviços prestados', description: r.description, amount: r.fiatAmount }, ...next.entries],
            }
          }
          return next
        }),
      // Logística: as regras ficam em lib/logistics.ts. Aqui só se valida no estado atual e aplica no próximo.
      // Remessas não alteram estoque nem financeiro.
      createShipment: (input) => runShipmentOp((d, now) => logistics.createShipment(d, input, now, actor())),
      updateShipment: (id, input) => runShipmentOp((d, now) => logistics.updateShipment(d, id, input, now, actor())),
      transitionShipment: (id, to, opts = {}) => runShipmentOp((d, now) => logistics.transitionShipment(d, id, to, opts, now, today(), actor())),
      addShipmentEvent: (id, input) => runShipmentOp((d, now) => logistics.addTrackingEvent(d, id, input, now, actor())),
      addShipmentDocument: (id, input) => runShipmentOp((d, now) => logistics.addDocument(d, id, input, now, actor())),
      pickShipmentItem: (id, itemId, qty) => runShipmentOp((d, now) => fulfillment.pickItem(d, id, itemId, qty, now, actor())),
      packShipment: (id) => runShipmentOp((d, now) => fulfillment.packShipment(d, id, now, actor())),
      recordShipmentPod: (id, input) => runShipmentOp((d, now) => fulfillment.recordPod(d, id, input, now, actor())),
      closeShipmentFulfillment: (id) => runShipmentOp((d, now) => fulfillment.closeFulfillment(d, id, now, actor())),
      // Único ponto da logística que soma estoque: só depois da conferência do recebimento e uma única vez.
      receiveShipmentGoods: (id, input) => runShipmentOp((d, now) => receiving.receiveGoods(d, id, input, now, today(), actor())),
      createCarrier: (input) => runShipmentOp((d, now) => carriers.createCarrier(d, input, now)),
      updateCarrier: (id, input) => runShipmentOp((d, now) => carriers.updateCarrier(d, id, input, now)),
      setCarrierActive: (id, active) => runShipmentOp((d, now) => carriers.setCarrierActive(d, id, active, now)),
      removeCarrier: (id) => runShipmentOp((d) => carriers.removeCarrier(d, id)),
      setShipmentFreight: (id, input) => runShipmentOp((d, now) => freight.setFreight(d, id, input, now, actor())),
      // Cria uma conta a pagar (Logística) uma única vez, na moeda do app. O pagamento segue pelo financeiro normal.
      postShipmentFreight: (id, dueDate) => runShipmentOp((d, now) => freight.postFreight(d, id, { dueDate }, now, d.settings.currency, actor())),
      setShipmentInternational: (id, input) => runShipmentOp((d, now) => international.setInternational(d, id, input, now, actor())),
      requestReturn: (input) => runShipmentOp((d, now) => returns.requestReturn(d, input, now, actor())),
      authorizeReturn: (id, note = '') => runShipmentOp((d, now) => returns.authorizeReturn(d, id, note, now, actor())),
      rejectReturn: (id, note) => runShipmentOp((d, now) => returns.rejectReturn(d, id, note, now, actor())),
      cancelReturn: (id, note = '') => runShipmentOp((d, now) => returns.cancelReturn(d, id, note, now, actor())),
      createReturnShipment: (id) => runShipmentOp((d, now) => returns.createReturnShipment(d, id, now, actor())),
      // Único ponto da devolução que mexe no estoque: só itens inspecionados em bom estado e com decisão de reestocar.
      inspectReturn: (id, input) => runShipmentOp((d, now) => returns.inspectReturn(d, id, input, now, today(), actor())),
      resolveReturn: (id, input) => runShipmentOp((d, now) => returns.resolveReturn(d, id, input, now, actor())),
      removeShipmentDraft: (id) => {
        const out = logistics.removeDraft(data, id)
        if (!out.ok) return out
        undoable((d) => {
          const again = logistics.removeDraft(d, id)
          return again.ok ? again.data : d
        }, t('Rascunho de remessa removido.', 'Draft shipment removed.'))
        return { ok: true, value: out.value }
      },
      addTreasuryOp: (op) => set((d) => ({ ...d, treasuryOps: [{ ...op, id: uid(), date: new Date().toISOString() }, ...d.treasuryOps] })),
      updateSettings: (patch) => set((d) => ({ ...d, settings: { ...d.settings, ...patch } })),
      importData: (next) => undoable(() => next, t('Backup restaurado.', 'Backup restored.'), false),
      loadDemo: () =>
        undoable(
          (d) => ({
            ...buildDemoData(d.settings.currency),
            // Mantém a configuração do razão (plano de contas, flags, regras fiscais); os lançamentos antigos
            // pertencem aos dados substituídos e saem junto com eles (o Desfazer restaura tudo).
            ledger: { ...emptyLedger(d.ledger.orgId), flags: d.ledger.flags, chart: d.ledger.chart, categoryMap: d.ledger.categoryMap, taxRules: d.ledger.taxRules, fxRates: d.ledger.fxRates },
            settings: { ...d.settings, company: t('Comércio Demonstração', 'Demo Store') },
          }),
          t('Dados de demonstração carregados.', 'Demo data loaded.'),
          false,
        ),
      resetAll: () => undoable(() => emptyData(), t('Todos os dados foram apagados.', 'All data was deleted.'), false),
    }
  }, [data])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore deve ser usado dentro de StoreProvider')
  return ctx
}
