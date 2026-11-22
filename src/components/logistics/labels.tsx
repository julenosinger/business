import { clsx } from 'clsx'
import { Badge } from '@/components/ui'
import { formatCurrency } from '@/lib/format'
import { locale, t } from '@/lib/i18n'
import type { ErrorCode } from '@/lib/logistics'
import type { CurrencyCode, Shipment, ShipmentDirection, ShipmentDocumentType, ShipmentEvent, ShipmentStatus } from '@/lib/types'

export const statusLabel = (s: ShipmentStatus): string =>
  ({
    draft: t('Rascunho', 'Draft'),
    ready: t('Pronta', 'Ready'),
    dispatched: t('Despachada', 'Dispatched'),
    in_transit: t('Em trânsito', 'In transit'),
    out_for_delivery: t('Saiu para entrega', 'Out for delivery'),
    delivered: t('Entregue', 'Delivered'),
    cancelled: t('Cancelada', 'Cancelled'),
    returned: t('Devolvida', 'Returned'),
    delayed: t('Atrasada', 'Delayed'),
    exception: t('Exceção', 'Exception'),
  })[s]

type Tone = 'ok' | 'bad' | 'warn' | 'neutral' | 'accent'

export const statusTone = (s: ShipmentStatus): Tone =>
  ({ draft: 'neutral', ready: 'accent', dispatched: 'accent', in_transit: 'accent', out_for_delivery: 'accent', delivered: 'ok', cancelled: 'neutral', returned: 'warn', delayed: 'warn', exception: 'bad' })[s] as Tone

/** Cor usada nos gráficos para cada status. */
export const statusColor = (s: ShipmentStatus): string =>
  ({
    draft: 'rgb(var(--fill-rgb) / 0.35)',
    ready: 'rgb(var(--blue-rgb))',
    dispatched: 'rgb(var(--accent-rgb))',
    in_transit: 'rgb(var(--violet-rgb))',
    out_for_delivery: '#3aa6b0',
    delivered: 'rgb(var(--ok-rgb))',
    cancelled: 'rgb(var(--fill-rgb) / 0.2)',
    returned: '#d1679f',
    delayed: 'rgb(var(--warn-rgb))',
    exception: 'rgb(var(--bad-rgb))',
  })[s]

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
}

export const directionLabel = (d: ShipmentDirection): string => ({ inbound: t('Entrada', 'Inbound'), outbound: t('Saída', 'Outbound'), transfer: t('Transferência', 'Transfer') })[d]

export function DirectionBadge({ direction, className }: { direction: ShipmentDirection; className?: string }) {
  return <span className={clsx('inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-muted', className)}>{directionLabel(direction)}</span>
}

export const documentLabel = (d: ShipmentDocumentType): string =>
  ({
    invoice: t('Nota fiscal / fatura', 'Invoice'),
    packing_list: t('Romaneio (packing list)', 'Packing list'),
    bill_of_lading: t('Conhecimento de transporte', 'Bill of lading'),
    proof_of_delivery: t('Comprovante de entrega', 'Proof of delivery'),
    other: t('Outro', 'Other'),
  })[d]

export const fieldLabel = (k: string): string =>
  (
    ({
      orderRef: t('pedido', 'order'),
      origin: t('origem', 'origin'),
      destination: t('destino', 'destination'),
      senderName: t('remetente', 'sender'),
      recipientName: t('destinatário', 'recipient'),
      carrier: t('transportadora', 'carrier'),
      carrierId: t('transportadora cadastrada', 'registered carrier'),
      freight: t('custos de frete', 'freight costs'),
      international: t('dados internacionais', 'international data'),
      trackingNumber: t('código de rastreio', 'tracking number'),
      method: t('método', 'method'),
      packages: t('volumes', 'packages'),
      items: t('itens', 'items'),
      declaredValue: t('valor declarado', 'declared value'),
      currency: t('moeda', 'currency'),
      freightCost: t('frete', 'freight'),
      estimatedDelivery: t('previsão de entrega', 'estimated delivery'),
    }) as Record<string, string>
  )[k] ?? k

export const fulfillmentStepLabel = (step?: string): string =>
  step === 'pick'
    ? t('Item separado', 'Item picked')
    : step === 'pack'
      ? t('Remessa embalada e estoque conferido', 'Shipment packed and stock checked')
      : step === 'pod'
        ? t('Comprovante de entrega registrado', 'Proof of delivery recorded')
        : step === 'close'
          ? t('Expedição encerrada', 'Fulfillment closed')
          : t('Expedição', 'Fulfillment')

/** Texto principal de um registro da linha do tempo. */
export function eventTitle(e: ShipmentEvent): string {
  switch (e.kind) {
    case 'created':
      return t('Remessa criada', 'Shipment created')
    case 'status':
      return e.fromStatus && e.toStatus ? `${statusLabel(e.fromStatus)} → ${statusLabel(e.toStatus)}` : t('Status alterado', 'Status changed')
    case 'tracking':
      return e.description
    case 'edit':
      return `${t('Dados editados', 'Details edited')}: ${(e.fields ?? []).map(fieldLabel).join(', ')}`
    case 'document':
      return `${t('Documento registrado', 'Document recorded')}: ${e.fields?.[0] ? documentLabel(e.fields[0] as ShipmentDocumentType) : ''}`
    case 'fulfillment':
      return fulfillmentStepLabel(e.fields?.[0])
    case 'freight':
      return t('Custo lançado em contas a pagar', 'Cost posted to payables')
    case 'receipt':
      return e.fields?.[0] === 'posted'
        ? t('Mercadorias recebidas e estoque atualizado', 'Goods received and stock updated')
        : t('Mercadorias recebidas (estoque já lançado)', 'Goods received (stock already counted)')
  }
}

/** Texto secundário (motivo, referência ou local). */
export function eventDetail(e: ShipmentEvent): string {
  if (e.kind === 'tracking') return e.location ?? ''
  return e.description
}

export function explain(errors: readonly ErrorCode[]): string {
  const msg: Record<ErrorCode, string> = {
    not_found: t('Remessa não encontrada.', 'Shipment not found.'),
    not_allowed: t('Esta ação não é permitida no status atual.', 'This action is not allowed in the current status.'),
    locked: t('Remessas entregues, canceladas ou devolvidas não podem ser editadas.', 'Delivered, cancelled or returned shipments cannot be edited.'),
    note_required: t('Informe o motivo (mínimo de 3 caracteres).', 'Enter the reason (at least 3 characters).'),
    invalid_direction: t('Tipo de remessa inválido.', 'Invalid shipment type.'),
    missing_recipient: t('Informe o destinatário.', 'Enter the recipient.'),
    missing_destination: t('Informe a cidade e o país de destino.', 'Enter the destination city and country.'),
    missing_contents: t('Adicione ao menos um item ou volume.', 'Add at least one item or package.'),
    missing_carrier: t('Informe a transportadora antes de despachar.', 'Enter the carrier before dispatching.'),
    invalid_tracking: t('Código de rastreio inválido (3 a 40 caracteres: letras, números e - . _ /).', 'Invalid tracking number (3 to 40 characters: letters, numbers and - . _ /).'),
    invalid_number: t('Valores e medidas devem ser números iguais ou maiores que zero.', 'Amounts and measurements must be numbers of zero or more.'),
    invalid_date: t('Data inválida. Entregas não podem estar no futuro nem antes da criação.', 'Invalid date. Deliveries cannot be in the future or before creation.'),
    invalid_currency: t('Moeda inválida.', 'Invalid currency.'),
    unknown_sale: t('Venda não encontrada ou cancelada.', 'Sale not found or cancelled.'),
    unknown_product: t('Produto não encontrado no estoque.', 'Product not found in inventory.'),
    invalid_item: t('Cada item precisa de nome e quantidade maior que zero.', 'Each item needs a name and a quantity above zero.'),
    empty_description: t('Descreva o evento (mínimo de 3 caracteres).', 'Describe the event (at least 3 characters).'),
    duplicate_event: t('Este evento de rastreio já foi registrado.', 'This tracking event was already recorded.'),
    future_event: t('O evento não pode estar no futuro.', 'The event cannot be in the future.'),
    invalid_document: t('Informe o tipo e a referência do documento.', 'Enter the document type and reference.'),
    duplicate_document: t('Este documento já foi registrado.', 'This document was already recorded.'),
    only_draft_removable: t('Só rascunhos podem ser apagados. Cancele a remessa para manter o histórico.', 'Only drafts can be deleted. Cancel the shipment to keep its history.'),
    not_picked: t('Separe todos os itens antes de continuar.', 'Pick all items before continuing.'),
    not_packed: t('Embale a remessa (conferência de estoque) antes de despachar.', 'Pack the shipment (stock check) before dispatching.'),
    insufficient_stock: t('Estoque insuficiente para esta remessa.', 'Not enough stock for this shipment.'),
    item_not_in_order: t('Há item que não faz parte do pedido ligado.', 'An item is not part of the linked order.'),
    exceeds_order_qty: t('A quantidade passa do total do pedido (somando as outras remessas dele).', 'The quantity exceeds the order total (including its other shipments).'),
    unknown_purchase: t('Compra não encontrada.', 'Purchase not found.'),
    purchase_already_received: t('Esta compra já foi recebida.', 'This purchase was already received.'),
    invalid_qty: t('Quantidade inválida.', 'Invalid quantity.'),
    not_outbound: t('Só vale para remessas de saída com itens do estoque.', 'Only applies to outbound shipments with inventory items.'),
    not_ready: t('A separação só é feita com a remessa pronta.', 'Picking is only done while the shipment is ready.'),
    already_packed: t('A remessa já foi embalada.', 'The shipment is already packed.'),
    not_inbound: t('Só remessas de entrada podem ser recebidas.', 'Only inbound shipments can be received.'),
    not_delivered: t('A remessa precisa estar entregue (chegada confirmada).', 'The shipment must be delivered (arrival confirmed).'),
    already_received: t('Esta remessa já foi recebida. O estoque não é somado duas vezes.', 'This shipment was already received. Stock is never added twice.'),
    invalid_receipt: t('Confira todos os itens: recebido não pode ser negativo e os danificados não podem passar do recebido.', 'Check every item: received cannot be negative and damaged cannot exceed received.'),
    receipt_note_required: t('Há divergência: descreva o que aconteceu nas observações.', 'There is a discrepancy: describe what happened in the notes.'),
    stock_mode_required: t('Escolha se o estoque deve ser somado ou se já foi lançado.', 'Choose whether to add the stock or whether it was already counted.'),
    invalid_name: t('Informe quem recebeu (mínimo de 2 caracteres).', 'Enter who received it (at least 2 characters).'),
    pod_exists: t('O comprovante de entrega já foi registrado.', 'The proof of delivery was already recorded.'),
    pod_required: t('Registre o comprovante de entrega antes de encerrar.', 'Record the proof of delivery before closing.'),
    already_closed: t('A expedição já foi encerrada.', 'Fulfillment is already closed.'),
    duplicate_carrier: t('Já existe uma transportadora com este nome.', 'A carrier with this name already exists.'),
    invalid_url: t('O modelo de rastreio precisa ser um link https que contenha {tracking}.', 'The tracking template must be an https link containing {tracking}.'),
    invalid_email: t('E-mail inválido.', 'Invalid email.'),
    carrier_in_use: t('Esta transportadora tem remessas. Desative-a em vez de remover.', 'This carrier has shipments. Deactivate it instead of removing it.'),
    inactive_carrier: t('Esta transportadora está inativa.', 'This carrier is inactive.'),
    unknown_carrier: t('Transportadora não encontrada.', 'Carrier not found.'),
    invalid_service_level: t('Nível de serviço inválido: informe o nome e prazos inteiros (mínimo menor ou igual ao máximo).', 'Invalid service level: enter a name and whole-day lead times (minimum not above maximum).'),
    freight_posted: t('O custo já foi lançado em contas a pagar e não pode mais ser alterado aqui.', 'The cost was already posted to payables and can no longer be changed here.'),
    already_posted: t('O custo desta remessa já foi lançado em contas a pagar.', 'This shipment cost was already posted to payables.'),
    currency_mismatch: t('A moeda da remessa é diferente da moeda do app. Não há conversão automática.', 'The shipment currency differs from the app currency. There is no automatic conversion.'),
    nothing_to_post: t('Não há custo para lançar.', 'There is no cost to post.'),
    not_international: t('Só remessas que cruzam fronteira têm dados internacionais.', 'Only cross-border shipments have international data.'),
    invalid_hs: t('Código HS/NCM inválido para o país (confira a quantidade de dígitos).', 'Invalid HS/NCM code for the country (check the number of digits).'),
    invalid_incoterm: t('Incoterm inválido.', 'Invalid Incoterm.'),
    return_shipment: t('Esta é uma remessa de devolução: o estoque só volta pela inspeção da devolução.', 'This is a return shipment: stock only comes back through the return inspection.'),
    exceeds_returnable: t('A quantidade passa do que ainda pode ser devolvido.', 'The quantity exceeds what can still be returned.'),
    restock_not_allowed: t('Só itens em bom estado podem voltar ao estoque.', 'Only items in good condition can go back to stock.'),
    decision_required: t('Escolha o destino de cada item recebido (reestocar, descartar ou devolver ao fornecedor).', 'Choose what to do with each received item (restock, discard or return to supplier).'),
    return_not_arrived: t('A remessa de retorno ainda não foi entregue.', 'The return shipment has not been delivered yet.'),
    invalid_resolution: t('Escolha a resolução e informe a referência (exigida para reembolso e troca).', 'Choose the resolution and enter a reference (required for refund and replacement).'),
  }
  return [...new Set(errors)].map((e) => msg[e]).join(' ')
}

/** Valor monetário em qualquer moeda (a moeda da remessa pode diferir da moeda de exibição). */
export function formatAmount(n: number, currency: string): string {
  return formatCurrency(n, currency as CurrencyCode)
}

export const routeText = (s: Shipment): string => `${s.origin.city || s.origin.name || '—'} → ${s.destination.city || s.destination.name || '—'}`

/** Valor para <input type="datetime-local"> no horário local. */
export function localDateTime(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function dateTimeText(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })
}
