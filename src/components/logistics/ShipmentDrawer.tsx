import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { AlertTriangle, CheckCircle2, FilePlus2, FileText, PackageCheck, PackageOpen, Pencil, PlusCircle, Receipt, RefreshCw, Trash2, Truck, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Field, inputCls } from '@/components/ui'
import { DateField, DateTimeField } from '@/components/DateField'
import { isValidIso } from '@/lib/dates'
import { useStore } from '@/lib/store'
import { DOCUMENT_TYPES, isLocked, isOverdue, lastTrackingEvent, nextStatuses } from '@/lib/logistics'
import { fmtDate, num, today } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Shipment, ShipmentDocumentType, ShipmentEvent, ShipmentStatus } from '@/lib/types'
import { FulfillmentPanel } from './FulfillmentPanel'
import { FreightPanel } from './FreightPanel'
import { InternationalPanel } from './InternationalPanel'
import { ReturnBadge } from './ReturnsPanel'
import { trackingUrl } from '@/lib/carriers'
import { ReceivingPanel } from './ReceivingPanel'
import { DirectionBadge, StatusBadge, dateTimeText, documentLabel, eventDetail, eventTitle, explain, formatAmount, localDateTime, statusLabel } from './labels'

const TRACKABLE: readonly ShipmentStatus[] = ['dispatched', 'in_transit', 'out_for_delivery', 'delayed', 'exception', 'delivered', 'returned']
const NOTE_REQUIRED: readonly ShipmentStatus[] = ['delayed', 'exception', 'cancelled', 'returned']
const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'

function EventIcon({ e }: { e: ShipmentEvent }) {
  const cls = 'size-4'
  if (e.kind === 'tracking') return <Truck className={cls} />
  if (e.kind === 'document') return <FileText className={cls} />
  if (e.kind === 'edit') return <Pencil className={cls} />
  if (e.kind === 'fulfillment') return <PackageCheck className={cls} />
  if (e.kind === 'receipt') return <PackageOpen className={cls} />
  if (e.kind === 'freight') return <Receipt className={cls} />
  if (e.kind === 'status' && e.toStatus === 'delivered') return <CheckCircle2 className={cls} />
  if (e.kind === 'status' && (e.toStatus === 'exception' || e.toStatus === 'delayed')) return <AlertTriangle className={cls} />
  return <RefreshCw className={cls} />
}

function Timeline({ shipment }: { shipment: Shipment }) {
  const events = [...shipment.events].sort((a, b) => (b.occurredAt ?? b.at).localeCompare(a.occurredAt ?? a.at) || b.at.localeCompare(a.at))
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {events.map((e) => {
        const detail = eventDetail(e)
        return (
          <li key={e.id} className="relative">
            <span className="absolute -left-[31px] top-0.5 flex size-6 items-center justify-center rounded-full border border-line bg-panel text-muted">
              <EventIcon e={e} />
            </span>
            <p className="text-sm font-semibold text-pretty">{eventTitle(e)}</p>
            {detail ? <p className="text-sm text-muted text-pretty">{detail}</p> : null}
            <p className="mt-0.5 text-xs text-subtle">
              {e.kind === 'tracking' && e.occurredAt ? `${dateTimeText(e.occurredAt)} · ${t('registrado em', 'recorded on')} ${dateTimeText(e.at)}` : dateTimeText(e.at)} · {e.source === 'carrier' ? t('Transportadora (verificado)', 'Carrier (verified)') : t('Manual', 'Manual')} · {e.actor}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children || <span className="text-subtle">—</span>}</dd>
    </div>
  )
}

interface Props {
  shipment: Shipment | null
  onClose: () => void
  onEdit: (s: Shipment) => void
  /** Abre a solicitação de devolução desta remessa (aba Devoluções). */
  onRequestReturn: (shipmentId: string) => void
}

/** Detalhe da remessa: resumo, ações de status, rastreio manual, documentos e histórico de auditoria. */
export function ShipmentDrawer({ shipment, onClose, onEdit, onRequestReturn }: Props) {
  const { data, transitionShipment, addShipmentEvent, addShipmentDocument, removeShipmentDraft } = useStore()
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const open = shipment !== null

  const [pending, setPending] = useState<ShipmentStatus | null>(null)
  const [note, setNote] = useState('')
  const [deliveredAt, setDeliveredAt] = useState(today())
  const [error, setError] = useState('')
  const [trk, setTrk] = useState({ occurredAt: localDateTime(), location: '', description: '' })
  const [trkError, setTrkError] = useState('')
  const [doc, setDoc] = useState<{ type: ShipmentDocumentType; reference: string }>({ type: 'invoice', reference: '' })
  const [docError, setDocError] = useState('')
  const [seenId, setSeenId] = useState<string | null>(null)

  // Ao trocar de remessa, limpa os formulários internos.
  const id = shipment?.id ?? null
  if (id !== seenId) {
    setSeenId(id)
    setPending(null)
    setNote('')
    setError('')
    setTrk({ occurredAt: localDateTime(), location: '', description: '' })
    setTrkError('')
    setDoc({ type: 'invoice', reference: '' })
    setDocError('')
  }

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null && el.tabIndex >= 0)
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [open, onClose])

  const s = shipment
  const confirmTransition = () => {
    if (!s || !pending) return
    // Data de entrega digitada errada nunca vira "hoje" em silêncio.
    if (pending === 'delivered' && !isValidIso(deliveredAt)) {
      setError(explain(['invalid_date']))
      return
    }
    const res = transitionShipment(s.id, pending, { note, deliveredAt: pending === 'delivered' ? deliveredAt : undefined })
    if (!res.ok) {
      setError(explain(res.errors))
      return
    }
    toast.success(`${s.id}: ${statusLabel(pending)}`)
    setPending(null)
    setNote('')
    setError('')
  }

  const addEvent = () => {
    if (!s) return
    const ts = new Date(trk.occurredAt)
    if (Number.isNaN(ts.getTime())) {
      setTrkError(explain(['invalid_date']))
      return
    }
    const res = addShipmentEvent(s.id, { occurredAt: ts.toISOString(), location: trk.location, description: trk.description })
    if (!res.ok) {
      setTrkError(explain(res.errors))
      return
    }
    toast.success(t('Evento de rastreio registrado.', 'Tracking event recorded.'))
    setTrk({ occurredAt: localDateTime(), location: '', description: '' })
    setTrkError('')
  }

  const addDoc = () => {
    if (!s) return
    const res = addShipmentDocument(s.id, doc)
    if (!res.ok) {
      setDocError(explain(res.errors))
      return
    }
    setDoc({ type: doc.type, reference: '' })
    setDocError('')
  }

  const last = s ? lastTrackingEvent(s) : undefined
  const link = s ? trackingUrl(data.carriers.find((c) => c.id === s.carrierId), s.trackingNumber) : null
  const locked = s ? isLocked(s) : false
  const overdue = s ? isOverdue(s, today()) : false
  const totalWeight = s ? s.packages.reduce((sum, p) => sum + p.weightKg, 0) : 0
  const money = (n: number) => (s ? formatAmount(n, s.currency) : '')

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {s ? (
          <motion.div key="ship-drawer" className="fixed inset-0 z-50 !mt-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <div className="absolute inset-0 bg-black/60" onMouseDown={onClose} aria-hidden="true" />
            <motion.aside
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={`${t('Remessa', 'Shipment')} ${s.id}`}
              className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-line bg-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <header className="flex items-start justify-between gap-3 border-b border-line p-4 sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="display text-lg font-semibold">{s.id}</h2>
                    <StatusBadge status={s.status} />
                    <DirectionBadge direction={s.direction} />
                    {overdue ? <Badge tone="bad">{t('Prazo vencido', 'Overdue')}</Badge> : null}
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">
                    {s.origin.city || s.origin.name || '—'} → {s.destination.city || s.destination.name || '—'}
                  </p>
                </div>
                <button ref={closeRef} type="button" aria-label={t('Fechar detalhe', 'Close details')} onClick={onClose} className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line text-muted hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                  <X size={18} />
                </button>
              </header>

              <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-5">
                {/* Ações */}
                <section aria-label={t('Ações', 'Actions')}>
                  <div className="flex flex-wrap gap-2">
                    {nextStatuses(s.status).map((to) => (
                      <Button key={to} small variant={to === 'cancelled' || to === 'exception' || to === 'returned' ? 'ghost' : 'subtle'} onClick={() => { setPending(to); setError(''); setNote('') }}>
                        {statusLabel(to)}
                      </Button>
                    ))}
                    {!locked ? (
                      <Button small variant="ghost" onClick={() => onEdit(s)}>
                        <Pencil size={14} /> {t('Editar', 'Edit')}
                      </Button>
                    ) : null}
                    {s.status === 'draft' ? (
                      <Button
                        small
                        variant="danger"
                        onClick={() => {
                          const res = removeShipmentDraft(s.id)
                          if (res.ok) onClose()
                          else setError(explain(res.errors))
                        }}
                      >
                        <Trash2 size={14} /> {t('Apagar rascunho', 'Delete draft')}
                      </Button>
                    ) : null}
                  </div>
                  {nextStatuses(s.status).length === 0 ? <p className="mt-2 text-xs text-subtle">{t('Status final: nenhuma mudança é possível.', 'Final status: no further changes are possible.')}</p> : null}

                  {pending ? (
                    <div className="mt-3 space-y-3 rounded-xl border border-line bg-fill/5 p-3">
                      <p className="text-sm font-semibold">
                        {statusLabel(s.status)} → {statusLabel(pending)}
                      </p>
                      {pending === 'delivered' ? (
                        <Field label={t('Data real de entrega', 'Actual delivery date')}>
                          <DateField value={deliveredAt} min={s.createdAt.slice(0, 10)} max={today()} onChange={setDeliveredAt} />
                        </Field>
                      ) : null}
                      <Field label={NOTE_REQUIRED.includes(pending) ? t('Motivo (obrigatório)', 'Reason (required)') : t('Observação (opcional)', 'Note (optional)')}>
                        <textarea className={`${inputCls} min-h-20 py-2`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                      </Field>
                      {error ? (
                        <p role="alert" className="text-sm text-bad">
                          {error}
                        </p>
                      ) : null}
                      <div className="flex justify-end gap-2">
                        <Button small variant="ghost" onClick={() => { setPending(null); setError('') }}>
                          {t('Cancelar', 'Cancel')}
                        </Button>
                        <Button small onClick={confirmTransition}>
                          {t('Confirmar', 'Confirm')}
                        </Button>
                      </div>
                    </div>
                  ) : error ? (
                    <p role="alert" className="mt-2 text-sm text-bad">
                      {error}
                    </p>
                  ) : null}
                </section>

                <FulfillmentPanel s={s} />
                <ReceivingPanel s={s} />
                <FreightPanel s={s} />
                <InternationalPanel s={s} />
                {s.direction === 'outbound' && s.status === 'delivered' ? (
                  <section aria-label={t('Devoluções', 'Returns')} className="space-y-2 rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{t('Devoluções', 'Returns')}</h3>
                      <Button small variant="ghost" onClick={() => onRequestReturn(s.id)}>
                        {t('Solicitar devolução', 'Request a return')}
                      </Button>
                    </div>
                    {data.returns.filter((r) => r.shipmentId === s.id).length ? (
                      <ul className="divide-y divide-line rounded-lg border border-line">
                        {data.returns
                          .filter((r) => r.shipmentId === s.id)
                          .map((r) => (
                            <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                              <span className="mono font-semibold">{r.id}</span>
                              <ReturnBadge status={r.status} />
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-subtle">{t('Nenhuma devolução solicitada para esta remessa.', 'No returns requested for this shipment.')}</p>
                    )}
                  </section>
                ) : null}

                {/* Resumo */}
                <section aria-label={t('Resumo', 'Summary')}>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Row label={t('Transportadora', 'Carrier')}>{s.carrier}</Row>
                    <Row label={t('Código de rastreio', 'Tracking number')}>
                      {s.trackingNumber ? (
                        <>
                          <span className="mono">{s.trackingNumber}</span>
                          {link ? (
                            <a href={link} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                              {t('Abrir rastreio', 'Open tracking')}
                            </a>
                          ) : null}
                        </>
                      ) : (
                        ''
                      )}
                    </Row>
                    <Row label={t('Método', 'Method')}>{s.method}</Row>
                    <Row label={t('Pedido', 'Order')}>{s.orderRef ? `${s.orderRef.kind === 'sale' ? t('Venda', 'Sale') : t('Compra', 'Purchase')} · ${s.orderRef.label}` : ''}</Row>
                    <Row label={t('Remetente', 'Sender')}>{s.senderName}</Row>
                    <Row label={t('Destinatário', 'Recipient')}>{s.recipientName}</Row>
                    <Row label={t('Origem', 'Origin')}>{[s.origin.name, s.origin.city, s.origin.country].filter(Boolean).join(', ')}</Row>
                    <Row label={t('Destino', 'Destination')}>{[s.destination.name, s.destination.city, s.destination.country].filter(Boolean).join(', ')}</Row>
                    <Row label={t('Entrega prevista', 'Estimated delivery')}>{s.estimatedDelivery ? fmtDate(s.estimatedDelivery) : ''}</Row>
                    <Row label={t('Entrega real', 'Actual delivery')}>{s.deliveredAt ? fmtDate(s.deliveredAt) : ''}</Row>
                    <Row label={t('Valor declarado', 'Declared value')}>{s.declaredValue ? money(s.declaredValue) : ''}</Row>
                    <Row label={t('Frete', 'Freight')}>{s.freightCost ? money(s.freightCost) : ''}</Row>
                    <Row label={t('Volumes', 'Packages')}>{s.packages.length ? `${s.packages.length} · ${num(totalWeight)} kg` : ''}</Row>
                    <Row label={t('Atualizada em', 'Updated')}>{dateTimeText(s.updatedAt)}</Row>
                  </dl>
                </section>

                {/* Último evento verificado */}
                <section aria-label={t('Último evento de rastreio', 'Last tracking event')} className="rounded-xl border border-line bg-fill/5 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">{t('Último evento de rastreio', 'Last tracking event')}</h3>
                  {last ? (
                    <p className="mt-1 text-sm">
                      <span className="font-semibold">{last.description}</span>
                      {last.location ? ` · ${last.location}` : ''}
                      <span className="block text-xs text-subtle">
                        {dateTimeText(last.occurredAt ?? last.at)} · {last.source === 'carrier' ? t('enviado pela transportadora (verificado):', 'sent by the carrier (verified):') : t('informado manualmente por', 'entered manually by')} {last.actor}
                      </span>
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-muted">{t('Nenhum evento de rastreio registrado.', 'No tracking events recorded.')}</p>
                  )}
                  <p className="mt-2 text-xs text-subtle">{t('Os eventos são informados manualmente. Nenhuma integração com transportadoras está ativa.', 'Events are entered manually. No carrier integration is active.')}</p>
                </section>

                {/* Registrar rastreio */}
                {TRACKABLE.includes(s.status) ? (
                  <section aria-label={t('Registrar evento de rastreio', 'Record tracking event')}>
                    <h3 className="mb-2 text-sm font-semibold">{t('Registrar evento de rastreio', 'Record tracking event')}</h3>
                    <div className="space-y-3 rounded-xl border border-line p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={t('Quando ocorreu', 'When it happened')}>
                          <DateTimeField value={trk.occurredAt} max={localDateTime()} onChange={(v) => { setTrk({ ...trk, occurredAt: v }); setTrkError('') }} />
                        </Field>
                        <Field label={t('Local (opcional)', 'Location (optional)')}>
                          <input className={inputCls} value={trk.location} maxLength={80} onChange={(e) => { setTrk({ ...trk, location: e.target.value }); setTrkError('') }} />
                        </Field>
                      </div>
                      <Field label={t('O que aconteceu', 'What happened')}>
                        <input className={inputCls} value={trk.description} maxLength={300} onChange={(e) => { setTrk({ ...trk, description: e.target.value }); setTrkError('') }} placeholder={t('Ex.: Chegou ao centro de distribuição', 'E.g. Arrived at the distribution center')} />
                      </Field>
                      {trkError ? (
                        <p role="alert" className="text-sm text-bad">
                          {trkError}
                        </p>
                      ) : null}
                      <div className="flex justify-end">
                        <Button small onClick={addEvent}>
                          <PlusCircle size={14} /> {t('Registrar evento', 'Record event')}
                        </Button>
                      </div>
                    </div>
                  </section>
                ) : null}

                {/* Itens */}
                {s.items.length ? (
                  <section aria-label={t('Itens', 'Items')}>
                    <h3 className="mb-2 text-sm font-semibold">{t('Itens', 'Items')}</h3>
                    <ul className="divide-y divide-line rounded-xl border border-line">
                      {s.items.map((i) => (
                        <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate">
                            {i.name} {i.sku ? <span className="mono text-xs text-subtle">{i.sku}</span> : null}
                          </span>
                          <span className="num shrink-0 font-semibold">×{num(i.qty)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* Documentos */}
                <section aria-label={t('Documentos', 'Documents')}>
                  <h3 className="mb-2 text-sm font-semibold">{t('Documentos de apoio', 'Supporting documents')}</h3>
                  {s.documents.length ? (
                    <ul className="mb-3 divide-y divide-line rounded-xl border border-line">
                      {s.documents.map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate">
                            <span className="text-muted">{documentLabel(d.type)}</span> · <span className="mono">{d.reference}</span>
                          </span>
                          <span className="shrink-0 text-xs text-subtle">{dateTimeText(d.addedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {s.status !== 'cancelled' ? (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
                        <select aria-label={t('Tipo de documento', 'Document type')} className={inputCls} value={doc.type} onChange={(e) => setDoc({ ...doc, type: e.target.value as ShipmentDocumentType })}>
                          {DOCUMENT_TYPES.map((d) => (
                            <option key={d} value={d}>
                              {documentLabel(d)}
                            </option>
                          ))}
                        </select>
                        <input aria-label={t('Referência do documento', 'Document reference')} className={inputCls} value={doc.reference} maxLength={60} placeholder={t('Número ou referência', 'Number or reference')} onChange={(e) => { setDoc({ ...doc, reference: e.target.value }); setDocError('') }} />
                        <Button small variant="subtle" onClick={addDoc}>
                          <FilePlus2 size={14} /> {t('Adicionar', 'Add')}
                        </Button>
                      </div>
                      <p className="text-xs text-subtle">{t('Guarda só a referência. O envio de arquivos virá depois.', 'Only the reference is stored. File upload comes later.')}</p>
                      {docError ? (
                        <p role="alert" className="text-sm text-bad">
                          {docError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                {/* Linha do tempo */}
                <section aria-label={t('Histórico', 'History')}>
                  <h3 className="mb-3 text-sm font-semibold">{t('Histórico e auditoria', 'History and audit trail')}</h3>
                  <Timeline shipment={s} />
                </section>
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  )
}
