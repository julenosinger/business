// Recebimento de mercadorias (fase 1B). É o único ponto da logística que soma estoque, e só depois de uma conferência validada.
//
// Regras:
// - Só remessas de entrada já entregues (chegada física confirmada) podem ser recebidas, e uma única vez por remessa.
// - Mudar o status para "entregue" nunca soma estoque. O estoque só muda ao confirmar o recebimento.
// - Compra ligada que aguardava recebimento (stockPosted = false): soma o estoque aceito agora e marca a compra como lançada.
// - Compra ligada já lançada (stockPosted = true, fluxo padrão da aba Compras): o estoque já foi somado, então nada é somado de novo.
// - Sem compra ligada: o usuário precisa escolher explicitamente entre somar ou registrar que o estoque já foi lançado.
// - Itens danificados não entram no estoque. A decisão sobre eles (devolver, descartar, reestocar) fica para a fase de devoluções.
import type { AppData, GoodsReceipt, PurchaseRef, ReceiptLine, ReceiptStockMode, StockMove } from './types'
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
 * (alocação determinística e auditável). Devolve também `excess` (quantidade além da compra),
 * que NÃO é valorizada automaticamente pelo último custo — exige tratamento explícito.
 */
export function allocatePurchaseValue(queue: { cost: number; qty: number }[], needed: number): { value: number; excess: number } {
  let value = 0
  let remaining = needed
  while (remaining > 0 && queue.length > 0) {
    const head = queue[0]
    const take = Math.min(head.qty, remaining)
    value += take * head.cost
    head.qty -= take
    remaining -= take
    if (head.qty <= 0) queue.shift()
  }
  return { value, excess: remaining }
}

/** Consome `needed` unidades da fila (FIFO) sem devolver valor — usado para os recebimentos anteriores. */
function consumeFifo(queue: { cost: number; qty: number }[], needed: number): void {
  let remaining = needed
  while (remaining > 0 && queue.length > 0) {
    const head = queue[0]
    const take = Math.min(head.qty, remaining)
    head.qty -= take
    remaining -= take
    if (head.qty <= 0) queue.shift()
  }
}

/**
 * Fila de custos RESTANTE de uma compra, após consumir os recebimentos anteriores em ordem cronológica.
 * Deriva a alocação do histórico imutável de recebimentos (não reconstrói a fila original a cada recebimento).
 */
export function remainingPurchaseAllocation(purchase: PurchaseRef, receipts: readonly GoodsReceipt[]): Map<string, { cost: number; qty: number }[]> {
  const queue = new Map<string, { cost: number; qty: number }[]>()
  for (const pi of purchase.items) {
    const arr = queue.get(pi.productId) ?? []
    arr.push({ cost: pi.cost, qty: pi.qty })
    queue.set(pi.productId, arr)
  }
  const prior = receipts.filter((r) => r.purchaseId === purchase.id).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  for (const r of prior) {
    for (const line of r.lines) {
      if (!line.productId || line.acceptedQty <= 0) continue
      consumeFifo(queue.get(line.productId) ?? [], line.acceptedQty)
    }
  }
  return queue
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

  // Define se o estoque entra agora (permite recebimentos parciais sucessivos).
  const purchase = cur.orderRef?.kind === 'purchase' && cur.orderRef.id ? d.purchases.find((p) => p.id === cur.orderRef?.id) : undefined
  if (cur.orderRef?.kind === 'purchase' && cur.orderRef.id && !purchase) return fail('unknown_purchase')
  const totalQty = purchase ? purchase.items.reduce((s, i) => s + i.qty, 0) : 0
  const receivedSoFar = purchase?.receivedQty ?? 0
  let stockMode: ReceiptStockMode
  if (purchase) {
    if (!purchase.stockPosted) {
      stockMode = 'posted' // primeira entrada de estoque de compra que aguardava recebimento
    } else if (receivedSoFar > 0 && receivedSoFar < totalQty) {
      stockMode = 'posted' // recebimento parcial: ainda entra estoque
    } else {
      stockMode = 'already_counted' // compra imediata ou já integralmente recebida
    }
  } else {
    if (input.stockChoice !== 'post' && input.stockChoice !== 'already_counted') return fail('stock_mode_required')
    stockMode = input.stockChoice === 'post' ? 'posted' : 'already_counted'
  }

  const receiptId = nextReceiptId(d.receipts)
  const posted: { productId: string; qty: number }[] = []
  let products = d.products
  const moves: StockMove[] = []
  let hasExcess = false
  // Alocação determinística: fila RESTANTE após consumir os recebimentos anteriores (histórico imutável).
  const allocQueue = purchase ? remainingPurchaseAllocation(purchase, d.receipts) : new Map<string, { cost: number; qty: number }[]>()
  if (stockMode === 'posted') {
    for (const l of lines) {
      if (!l.productId || l.acceptedQty <= 0) continue
      const product = products.find((p) => p.id === l.productId)
      if (!product) return fail('unknown_product')
      // Produto na compra: aloca por linha (excedente não é valorizado automaticamente). Fora da compra: custo atual.
      let value: number
      if (allocQueue.has(l.productId)) {
        const r = allocatePurchaseValue(allocQueue.get(l.productId) ?? [], l.acceptedQty)
        value = r.value
        if (r.excess > 0) hasExcess = true
      } else {
        value = l.acceptedQty * product.cost
      }
      products = products.map((p) =>
        p.id === l.productId
          ? { ...p, stock: round2(p.stock + l.acceptedQty), cost: weightedAverageFromValue(p.stock, p.cost, l.acceptedQty, value) }
          : p,
      )
      moves.push({ id: uid(), productId: l.productId, kind: 'in', qty: l.acceptedQty, date: today, note: `${receiptId} · ${cur.id}`, environment: cur.environment ?? env })
      posted.push({ productId: l.productId, qty: l.acceptedQty })
    }
  }

  const acceptedTotal = round2(lines.reduce((s, l) => s + (l.acceptedQty ?? 0), 0))
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
  const ev = event({ kind: 'receipt', at: now, description: receiptId, fields: [stockMode, ...(hasExcess ? ['excess'] : [])], actor: clean(actor, 60) })
  const next: AppData = {
    ...replace(d, { ...cur, receiptId, events: [...cur.events, ev], updatedAt: now }),
    products,
    moves: moves.length ? [...moves, ...d.moves] : d.moves,
    receipts: [receipt, ...d.receipts],
    purchases: purchase && stockMode === 'posted' ? d.purchases.map((p) => (p.id === purchase.id ? { ...p, stockPosted: true, receiptId, receivedQty: round2(receivedSoFar + acceptedTotal) } : p)) : d.purchases,
  }
  return { ok: true, data: next, value: { receiptId, stockMode, posted } }
}
