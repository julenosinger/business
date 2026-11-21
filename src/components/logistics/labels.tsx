import { clsx } from 'clsx'
import { Badge } from '@/components/ui'
import { locale, t } from '@/lib/i18n'
import type { ErrorCode } from '@/lib/logistics'
import type { Shipment, ShipmentDirection, ShipmentDocumentType, ShipmentEvent, ShipmentStatus } from '@/lib/types'

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
  }
  return [...new Set(errors)].map((e) => msg[e]).join(' ')
}

/** Valor monetário em qualquer moeda (a moeda da remessa pode diferir da moeda de exibição). */
export function formatAmount(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currency}`
  }
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
