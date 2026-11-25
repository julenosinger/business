// Recebimento de mercadorias (fase 1B). É o único ponto da logística que soma estoque, e só depois de uma conferência validada.
//
// Regras:
// - Só remessas de entrada já entregues (chegada física confirmada) podem ser recebidas, e uma única vez por remessa.
// - Mudar o status para "entregue" nunca soma estoque. O estoque só muda ao confirmar o recebimento.
// - Compra ligada que aguardava recebimento (stockPosted = false): soma o estoque aceito agora e marca a compra como lançada.
// - Compra ligada já lançada (stockPosted = true, fluxo padrão da aba Compras): o estoque já foi somado, então nada é somado de novo.
// - Sem compra ligada: o usuário precisa escolher explicitamente entre somar ou registrar que o estoque já foi lançado.
// - Itens danificados não entram no estoque. A decisão sobre eles (devolver, descartar, reestocar) fica para a fase de devoluções.
import type { AppData, GoodsReceipt, ReceiptLine, ReceiptStockMode, StockMove } from './types'
import type { NetworkId } from './network'
import { weightedAverageFromValue } from './costing'
import { DEFAULT_ORG, clean, event, fail, replace, round2, uid, type Outcome } from './logistics'

export interface ReceiptLineInput {
  itemId: string
  receivedQty: number
  damagedQty: number
}

export interface ReceiptInput {
  lines: ReceiptLineInput[]
  notes: string
  /** Obrigatório só quando a remessa não está ligada a uma compra registrada. */
  stockChoice?: 'post' | 'already_counted'
}

export function nextPurchaseId(purchases: readonly { id: string }[]): string {
  const max = purchases.reduce((m, p) => {
    const n = /^PUR-(\d+)$/.exec(p.id)
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `PUR-${String(max + 1).padStart(4, '0')}`
}

export function nextReceiptId(receipts: readonly GoodsReceipt[]): string {
  const max = receipts.reduce((m, r) => {
    const n = /^GR-(\d+)$/.exec(r.id)
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `GR-${String(max + 1).padStart(4, '0')}`
}

const isQty = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/**
 * Valor de aquisição alocado a `needed` unidades, consumindo as linhas da compra em ordem
 * (alocação determinística e auditável). Excedente além da compra usa o último custo conhecido.
 */
export function allocatePurchaseValue(queue: { cost: number; qty: number }[], needed: number, fallbackCost: number): number {
  if (needed <= 0) return 0
  let value = 0
  let remaining = needed
  let lastCost = fallbackCost
  while (remaining > 0) {
    const head = queue[0]
    if (!head) {
      value += remaining * lastCost
      break
    }
    lastCost = head.cost
    const take = Math.min(head.qty, remaining)
    value += take * head.cost
    head.qty -= take
    remaining -= take
    if (head.qty <= 0) queue.shift()
  }
  return value
}

export interface ReceiptResult {
  receiptId: string
  stockMode: ReceiptStockMode
  /** Entradas de estoque feitas (vazio quando o estoque não muda). */
  posted: { productId: string; qty: number }[]
}

/** `now` é o instante (ISO) e `today` a data local (YYYY-MM-DD) usada nas movimentações de estoque. */
export function receiveGoods(d: AppData, shipmentId: string, input: ReceiptInput, now: string, today: string, actor: string, env: NetworkId = 'mainnet'): Outcome<ReceiptResult> {
  const cur = d.shipments.find((s) => s.id === shipmentId)
  if (!cur) return fail('not_found')
  if (cur.direction !== 'inbound') return fail('not_inbound')
  // Remessas de devolução só voltam ao estoque pela inspeção da devolução (itens não inspecionados nunca entram).
  if (cur.returnId) return fail('return_shipment')
  if (cur.status !== 'delivered') return fail('not_delivered')
  if (cur.receiptId) return fail('already_received')

  // Cada item da remessa precisa ser conferido exatamente uma vez.
  if (input.lines.length !== cur.items.length || new Set(input.lines.map((l) => l.itemId)).size !== cur.items.length) return fail('invalid_receipt')
  const lines: ReceiptLine[] = []
  for (const item of cur.items) {
    const l = input.lines.find((x) => x.itemId === item.id)
    if (!l || !isQty(l.receivedQty) || !isQty(l.damagedQty) || l.damagedQty > l.receivedQty) return fail('invalid_receipt')
    const received = round2(l.receivedQty)
    const damaged = round2(l.damagedQty)
    lines.push({
      itemId: item.id,
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      expectedQty: item.qty,
      receivedQty: received,
      damagedQty: damaged,
      acceptedQty: round2(received - damaged),
      discrepancy: damaged > 0 ? 'damaged' : received < item.qty ? 'short' : received > item.qty ? 'over' : 'none',
    })
  }
  const notes = clean(input.notes, 300)
  if (lines.some((l) => l.discrepancy !== 'none') && notes.length < 3) return fail('receipt_note_required')

  // Define se o estoque entra agora.
  const purchase = cur.orderRef?.kind === 'purchase' && cur.orderRef.id ? d.purchases.find((p) => p.id === cur.orderRef?.id) : undefined
  if (cur.orderRef?.kind === 'purchase' && cur.orderRef.id && !purchase) return fail('unknown_purchase')
  let stockMode: ReceiptStockMode
  if (purchase) {
    if (!purchase.stockPosted && purchase.receiptId) return fail('purchase_already_received')
    stockMode = purchase.stockPosted ? 'already_counted' : 'posted'
  } else {
    if (input.stockChoice !== 'post' && input.stockChoice !== 'already_counted') return fail('stock_mode_required')
    stockMode = input.stockChoice === 'post' ? 'posted' : 'already_counted'
  }

  const receiptId = nextReceiptId(d.receipts)
  const posted: { productId: string; qty: number }[] = []
  let products = d.products
  const moves: StockMove[] = []
  // Alocação determinística do custo de aquisição: linhas da compra são consumidas em ordem por produto,
  // permitindo o mesmo produto em múltiplas linhas com custos diferentes (sem depender de `items.find`).
  const allocQueue = new Map<string, { cost: number; qty: number }[]>()
  if (purchase) {
    for (const pi of purchase.items) {
      const arr = allocQueue.get(pi.productId) ?? []
      arr.push({ cost: pi.cost, qty: pi.qty })
      allocQueue.set(pi.productId, arr)
    }
  }
  if (stockMode === 'posted') {
    for (const l of lines) {
      if (!l.productId || l.acceptedQty <= 0) continue
      const product = products.find((p) => p.id === l.productId)
      if (!product) return fail('unknown_product')
      const value = allocatePurchaseValue(allocQueue.get(l.productId) ?? [], l.acceptedQty, product.cost)
      products = products.map((p) =>
        p.id === l.productId
          ? { ...p, stock: round2(p.stock + l.acceptedQty), cost: value > 0 ? weightedAverageFromValue(p.stock, p.cost, l.acceptedQty, value) : p.cost }
          : p,
      )
      moves.push({ id: uid(), productId: l.productId, kind: 'in', qty: l.acceptedQty, date: today, note: `${receiptId} · ${cur.id}`, environment: cur.environment ?? env })
      posted.push({ productId: l.productId, qty: l.acceptedQty })
    }
  }

  const receipt: GoodsReceipt = {
    id: receiptId,
    orgId: DEFAULT_ORG,
    shipmentId: cur.id,
    purchaseId: purchase?.id,
    lines,
    stockMode,
    notes,
    receivedAt: now,
    receivedBy: clean(actor, 60),
    environment: cur.environment ?? env,
  }
  const ev = event({ kind: 'receipt', at: now, description: receiptId, fields: [stockMode], actor: clean(actor, 60) })
  const next: AppData = {
    ...replace(d, { ...cur, receiptId, events: [...cur.events, ev], updatedAt: now }),
    products,
    moves: moves.length ? [...moves, ...d.moves] : d.moves,
    receipts: [receipt, ...d.receipts],
    purchases: purchase && stockMode === 'posted' ? d.purchases.map((p) => (p.id === purchase.id ? { ...p, stockPosted: true, receiptId } : p)) : d.purchases,
  }
  return { ok: true, data: next, value: { receiptId, stockMode, posted } }
}
