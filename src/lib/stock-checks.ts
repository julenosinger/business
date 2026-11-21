// Verificações de estoque e de pedido usadas pela logística (fase 1B). Módulo puro: só lê o estado, nunca altera estoque.
//
// Estratégia de compatibilidade com o que já existe no app:
// - Vendas (aba Vendas) já baixam o estoque no momento da venda. Uma remessa de saída ligada a uma venda NUNCA baixa de novo:
//   só confere que os itens pertencem à venda e que a soma enviada não passa do vendido.
// - Remessa de saída sem venda: apenas confere que há saldo em estoque. Não baixa (a baixa é feita em Vendas ou Estoque).
// - Compras (aba Compras) somam o estoque no registro, a não ser que tenham sido registradas "aguardando recebimento".
//   O recebimento de mercadorias soma o estoque só nesse caso, uma única vez (ver receiving.ts).
import type { AppData, Fulfillment, Shipment } from './types'

type Line = { productId?: string; qty: number }

/** O que as verificações precisam saber de uma remessa (existente ou em criação). */
export interface Subject {
  id?: string
  direction: Shipment['direction']
  orderRef?: { kind: 'sale' | 'purchase'; id?: string }
  items: readonly Line[]
}

export const trackedItems = <T extends Line>(items: readonly T[]): T[] => items.filter((i) => !!i.productId)

/** Só remessas de saída com itens do estoque passam por separação e embalagem. */
export const needsFulfillment = (s: Pick<Shipment, 'direction' | 'items'>): boolean => s.direction === 'outbound' && trackedItems(s.items).length > 0

export const fulfillmentOf = (s: Pick<Shipment, 'fulfillment'>): Fulfillment => s.fulfillment ?? { picks: {} }

export const pickedOf = (s: Pick<Shipment, 'fulfillment'>, itemId: string): number => fulfillmentOf(s).picks[itemId] ?? 0

export const allPicked = (s: Pick<Shipment, 'items' | 'fulfillment'>): boolean => trackedItems(s.items).every((i) => pickedOf(s, (i as { id: string }).id) >= i.qty)

const IGNORED_STATUSES: readonly Shipment['status'][] = ['cancelled', 'returned']

/** Quantidade de um produto já comprometida em outras remessas ativas da mesma venda ou compra. */
function committed(d: AppData, kind: 'sale' | 'purchase', orderId: string, productId: string, exceptId?: string): number {
  return d.shipments
    .filter((s) => s.id !== exceptId && !IGNORED_STATUSES.includes(s.status) && s.orderRef?.kind === kind && s.orderRef.id === orderId)
    .flatMap((s) => s.items)
    .filter((i) => i.productId === productId)
    .reduce((sum, i) => sum + i.qty, 0)
}

export type CoverageError = 'unknown_sale' | 'unknown_purchase' | 'item_not_in_order' | 'exceeds_order_qty' | 'purchase_already_received'

/** Itens da remessa dentro do que foi vendido ou comprado, somando as outras remessas do mesmo pedido. */
export function checkOrderCoverage(d: AppData, s: Subject): CoverageError[] {
  const ref = s.orderRef
  if (!ref?.id) return []
  const errors = new Set<CoverageError>()
  let orderItems: readonly { productId: string; qty: number }[] = []
  if (ref.kind === 'sale') {
    const sale = d.sales.find((x) => x.id === ref.id)
    if (!sale || sale.canceledAt) return ['unknown_sale']
    orderItems = sale.items
  } else {
    const purchase = d.purchases.find((x) => x.id === ref.id)
    if (!purchase) return ['unknown_purchase']
    if (purchase.receiptId && !s.id) errors.add('purchase_already_received')
    orderItems = purchase.items
  }
  const needed = new Map<string, number>()
  for (const i of trackedItems(s.items)) needed.set(i.productId as string, (needed.get(i.productId as string) ?? 0) + i.qty)
  for (const [productId, qty] of needed) {
    const line = orderItems.find((x) => x.productId === productId)
    if (!line) errors.add('item_not_in_order')
    else if (committed(d, ref.kind, ref.id, productId, s.id) + qty > line.qty + 1e-9) errors.add('exceeds_order_qty')
  }
  return [...errors]
}

export type StockCheckResult = { ok: true; mode: 'sale_deducted' | 'on_hand' } | { ok: false; errors: ('insufficient_stock' | CoverageError)[] }

/** Conferência antes do despacho de uma remessa de saída. Não altera nada. */
export function checkOutboundStock(d: AppData, s: Subject): StockCheckResult {
  if (s.orderRef?.kind === 'sale' && s.orderRef.id) {
    const errors = checkOrderCoverage(d, s)
    return errors.length ? { ok: false, errors } : { ok: true, mode: 'sale_deducted' }
  }
  const needed = new Map<string, number>()
  for (const i of trackedItems(s.items)) needed.set(i.productId as string, (needed.get(i.productId as string) ?? 0) + i.qty)
  for (const [productId, qty] of needed) {
    const product = d.products.find((p) => p.id === productId)
    if (!product || product.stock < qty) return { ok: false, errors: ['insufficient_stock'] }
  }
  return { ok: true, mode: 'on_hand' }
}
