import { useState } from 'react'
import { PackageX, Plus, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty, Field, Modal, inputCls } from '@/components/ui'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { useStore } from '@/lib/store'
import { useNetwork } from '@/lib/network'
import { returnsForEnvironment, shipmentsForEnvironment } from '@/lib/selectors'
import { returnableQty, isReturnFinal } from '@/lib/returns'
import { num, parseNum } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { ReturnAuthorization, ReturnCondition, ReturnDecision, ReturnStatus } from '@/lib/types'
import { dateTimeText, explain } from './labels'

const statusLabel = (s: ReturnStatus): string =>
  ({
    requested: t('Solicitada', 'Requested'),
    authorized: t('Autorizada', 'Authorized'),
    rejected: t('Recusada', 'Rejected'),
    inspected: t('Inspecionada', 'Inspected'),
    closed: t('Encerrada', 'Closed'),
    cancelled: t('Cancelada', 'Cancelled'),
  })[s]
const statusTone = (s: ReturnStatus): 'ok' | 'bad' | 'warn' | 'neutral' | 'accent' => (s === 'closed' ? 'ok' : s === 'rejected' ? 'bad' : s === 'cancelled' ? 'neutral' : s === 'requested' ? 'warn' : 'accent')
export const ReturnBadge = ({ status }: { status: ReturnStatus }) => <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>

const conditionLabel = (c: ReturnCondition): string => ({ good: t('Bom estado', 'Good'), damaged: t('Danificado', 'Damaged'), defective: t('Defeito', 'Defective') })[c]
const decisionLabel = (d: ReturnDecision): string => ({ restock: t('Reestocar', 'Restock'), discard: t('Descartar', 'Discard'), return_to_supplier: t('Devolver ao fornecedor', 'Return to supplier') })[d]
const actionLabel = (a: string): string =>
  ({
    requested: t('Solicitada', 'Requested'),
    authorized: t('Autorizada', 'Authorized'),
    rejected: t('Recusada', 'Rejected'),
    shipment_created: t('Remessa de retorno criada', 'Return shipment created'),
    inspected: t('Inspecionada', 'Inspected'),
    closed: t('Encerrada', 'Closed'),
    cancelled: t('Cancelada', 'Cancelled'),
  })[a] ?? a

// ---------- Nova devolução ----------

export function ReturnRequestModal({ open, shipmentId, onClose, onCreated }: { open: boolean; shipmentId: string | null; onClose: () => void; onCreated: () => void }) {
  const { data, requestReturn } = useStore()
  const network = useNetwork()
  const scopedShipments = shipmentsForEnvironment(data, network)
  const candidates = scopedShipments.filter((s) => s.direction === 'outbound' && s.status === 'delivered' && s.items.some((i) => returnableQty(data, s.id, i.id) > 0))
  const [loaded, setLoaded] = useState<string | null>(null)
  const [sel, setSel] = useState('')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const key = open ? `open:${shipmentId ?? ''}` : null
  if (key !== loaded) {
    setLoaded(key)
    setSel(shipmentId ?? candidates[0]?.id ?? '')
    setQty({})
    setReason('')
    setError('')
  }
  const ship = scopedShipments.find((s) => s.id === sel)

  const submit = () => {
    if (!ship) return
    const lines = ship.items.map((i) => ({ itemId: i.id, qty: qty[i.id]?.trim() ? parseNum(qty[i.id] ?? '') : 0 })).filter((l) => l.qty !== 0)
    const res = requestReturn({ shipmentId: ship.id, lines, reason })
    if (!res.ok) {
      setError(explain(res.errors))
      return
    }
    toast.success(`${res.value.id}: ${t('devolução solicitada.', 'return requested.')}`)
    onCreated()
  }

  return (
    <Modal open={open} title={t('Solicitar devolução', 'Request a return')} onClose={onClose}>
      {candidates.length === 0 && !ship ? (
        <p className="text-sm text-muted">{t('Não há remessas de saída entregues com itens que possam ser devolvidos.', 'There are no delivered outbound shipments with returnable items.')}</p>
      ) : (
        <div className="space-y-3">
          <Field label={t('Remessa entregue', 'Delivered shipment')}>
            <select className={inputCls} value={sel} onChange={(e) => { setSel(e.target.value); setQty({}); setError('') }}>
              {(ship && !candidates.some((c) => c.id === ship.id) ? [ship, ...candidates] : candidates).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} · {s.recipientName}
                </option>
              ))}
            </select>
          </Field>
          {ship ? (
            <ul className="space-y-2">
              {ship.items.map((i) => {
                const max = returnableQty(data, ship.id, i.id)
                return (
                  <li key={i.id} className="grid grid-cols-[1fr_96px] items-center gap-2 rounded-lg border border-line p-2.5">
                    <span className="min-w-0 text-sm">
                      <span className="block truncate font-medium">{i.name}</span>
                      <span className="text-xs text-subtle">
                        {t('enviado', 'shipped')} {num(i.qty)} · {t('pode devolver', 'returnable')} {num(max)}
                      </span>
                    </span>
                    <input aria-label={`${t('Quantidade a devolver de', 'Quantity to return of')} ${i.name}`} className={`${inputCls} text-right`} inputMode="decimal" disabled={max <= 0} value={qty[i.id] ?? ''} placeholder="0" onChange={(e) => { setQty({ ...qty, [i.id]: e.target.value }); setError('') }} />
                  </li>
                )
              })}
            </ul>
          ) : null}
          <Field label={t('Motivo da devolução', 'Return reason')}>
            <textarea className={`${inputCls} min-h-20 py-2`} value={reason} maxLength={300} onChange={(e) => { setReason(e.target.value); setError('') }} />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('Cancelar', 'Cancel')}
            </Button>
            <Button onClick={submit}>{t('Solicitar', 'Request')}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ---------- Cartão de devolução ----------

interface InspRow {
  received: string
  condition: ReturnCondition
  decision: ReturnDecision | ''
}

function ReturnCard({ r, onOpenShipment }: { r: ReturnAuthorization; onOpenShipment: (id: string) => void }) {
  const { data, authorizeReturn, rejectReturn, cancelReturn, createReturnShipment, inspectReturn, resolveReturn } = useStore()
  const [mode, setMode] = useState<'none' | 'reject' | 'inspect' | 'resolve'>('none')
  const [reasonText, setReasonText] = useState('')
  const [rows, setRows] = useState<Record<string, InspRow>>({})
  const [notes, setNotes] = useState('')
  const [res, setRes] = useState<{ kind: 'refund' | 'replacement' | 'none'; reference: string; note: string }>({ kind: 'refund', reference: '', note: '' })
  const [error, setError] = useState('')

  const fail = (errors: Parameters<typeof explain>[0]) => setError(explain(errors))
  const retShip = r.returnShipmentId ? data.shipments.find((s) => s.id === r.returnShipmentId) : undefined
  const arrived = !r.returnShipmentId || retShip?.status === 'delivered'
  const row = (itemId: string, qty: number): InspRow => rows[itemId] ?? { received: String(qty), condition: 'good', decision: '' }
  const patch = (itemId: string, qty: number, p: Partial<InspRow>) => { setRows({ ...rows, [itemId]: { ...row(itemId, qty), ...p } }); setError('') }

  const done = (result: { ok: true } | { ok: false; errors: Parameters<typeof explain>[0] }, text: string) => {
    if (!result.ok) return fail(result.errors)
    toast.success(text)
    setMode('none')
    setReasonText('')
    setError('')
  }

  const submitInspection = () => {
    const out = inspectReturn(r.id, {
      lines: r.lines.map((l) => {
        const x = row(l.itemId, l.qty)
        return { itemId: l.itemId, receivedQty: x.received.trim() === '' ? NaN : parseNum(x.received), condition: x.condition, decision: x.decision || undefined }
      }),
      notes,
    })
    if (!out.ok) return fail(out.errors)
    const qty = out.value.restocked.reduce((s, x) => s + x.qty, 0)
    toast.success(qty > 0 ? t(`Inspeção registrada. ${num(qty)} un voltaram ao estoque.`, `Inspection recorded. ${num(qty)} units went back to stock.`) : t('Inspeção registrada. Nenhum item voltou ao estoque.', 'Inspection recorded. No items went back to stock.'))
    setMode('none')
    setError('')
  }

  return (
    <TCard className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="display flex flex-wrap items-center gap-2 text-base font-semibold">
            <span className="mono">{r.id}</span> <ReturnBadge status={r.status} />
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            {t('Remessa', 'Shipment')}{' '}
            <button type="button" className="mono font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => onOpenShipment(r.shipmentId)}>
              {r.shipmentId}
            </button>
            {r.saleId ? ` · ${t('Venda', 'Sale')} ${r.saleId}` : ''} · {dateTimeText(r.createdAt)}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {r.lines.map((l) => {
          const insp = r.inspection?.lines.find((x) => x.itemId === l.itemId)
          return (
            <li key={l.itemId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <span className="num text-xs text-muted">
                ×{num(l.qty)}
                {insp ? ` · ${t('recebido', 'received')} ${num(insp.receivedQty)} · ${conditionLabel(insp.condition)}${insp.decision ? ` · ${decisionLabel(insp.decision)}` : ''}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-sm text-muted">
        <span className="font-medium text-ink">{t('Motivo', 'Reason')}:</span> {r.reason}
      </p>
      {r.inspection?.notes ? <p className="text-sm text-muted">{r.inspection.notes}</p> : null}
      {r.resolution ? (
        <p className="rounded-lg border border-line bg-fill/5 p-2.5 text-sm">
          <b>{r.resolution.kind === 'refund' ? t('Reembolso', 'Refund') : r.resolution.kind === 'replacement' ? t('Troca', 'Replacement') : t('Sem reembolso ou troca', 'No refund or replacement')}</b>
          {r.resolution.reference ? ` · ${r.resolution.reference}` : ''}
          {r.resolution.note ? ` · ${r.resolution.note}` : ''}
          <span className="block text-xs text-subtle">{t('Registrado manualmente. Nenhum lançamento financeiro foi feito automaticamente.', 'Recorded manually. No financial entry was made automatically.')}</span>
        </p>
      ) : null}
      {r.returnShipmentId ? (
        <p className="text-sm text-muted">
          {t('Remessa de retorno', 'Return shipment')}{' '}
          <button type="button" className="mono font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => onOpenShipment(r.returnShipmentId as string)}>
            {r.returnShipmentId}
          </button>
          {retShip ? ` · ${retShip.status}` : ''}
        </p>
      ) : null}

      {/* Ações */}
      {!isReturnFinal(r) && mode === 'none' ? (
        <div className="flex flex-wrap gap-2">
          {r.status === 'requested' ? (
            <>
              <Button small onClick={() => { const x = authorizeReturn(r.id); if (x.ok) toast.success(t('Devolução autorizada.', 'Return authorized.')); else fail(x.errors) }}>
                {t('Autorizar', 'Authorize')}
              </Button>
              <Button small variant="ghost" onClick={() => { setMode('reject'); setError('') }}>
                {t('Recusar', 'Reject')}
              </Button>
            </>
          ) : null}
          {r.status === 'authorized' ? (
            <>
              {!r.returnShipmentId ? (
                <Button small variant="subtle" onClick={() => { const x = createReturnShipment(r.id); if (x.ok) toast.success(`${x.value.shipmentId}: ${t('remessa de retorno criada.', 'return shipment created.')}`); else fail(x.errors) }}>
                  {t('Criar remessa de retorno', 'Create return shipment')}
                </Button>
              ) : null}
              <Button small disabled={!arrived} title={!arrived ? t('Aguardando a remessa de retorno chegar.', 'Waiting for the return shipment to arrive.') : undefined} onClick={() => { setMode('inspect'); setError('') }}>
                {t('Inspecionar e decidir', 'Inspect and decide')}
              </Button>
            </>
          ) : null}
          {r.status === 'inspected' ? (
            <Button small onClick={() => { setMode('resolve'); setError('') }}>
              {t('Resolver e encerrar', 'Resolve and close')}
            </Button>
          ) : null}
          {r.status === 'requested' || r.status === 'authorized' ? (
            <Button small variant="ghost" onClick={() => done(cancelReturn(r.id), t('Devolução cancelada.', 'Return cancelled.'))}>
              {t('Cancelar devolução', 'Cancel return')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === 'reject' ? (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <Field label={t('Motivo da recusa (obrigatório)', 'Rejection reason (required)')}>
            <input className={inputCls} value={reasonText} maxLength={300} onChange={(e) => { setReasonText(e.target.value); setError('') }} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button small variant="ghost" onClick={() => setMode('none')}>
              {t('Voltar', 'Back')}
            </Button>
            <Button small variant="danger" onClick={() => done(rejectReturn(r.id, reasonText), t('Devolução recusada.', 'Return rejected.'))}>
              {t('Recusar devolução', 'Reject return')}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'inspect' ? (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <p className="text-xs text-subtle">{t('Nada volta ao estoque sem esta inspeção. Só itens em bom estado podem ser reestocados, e reestocar soma ao estoque na hora.', 'Nothing goes back to stock without this inspection. Only items in good condition can be restocked, and restocking adds to stock immediately.')}</p>
          {r.lines.map((l) => {
            const x = row(l.itemId, l.qty)
            const gone = x.received.trim() !== '' && parseNum(x.received) === 0
            return (
              <div key={l.itemId} className="rounded-lg border border-line p-2.5">
                <p className="text-sm font-medium">
                  {l.name} <span className="text-xs text-subtle">· {t('esperado', 'expected')} {num(l.qty)}</span>
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <Field label={t('Recebido', 'Received')}>
                    <input className={`${inputCls} text-right`} inputMode="decimal" value={x.received} onChange={(e) => patch(l.itemId, l.qty, { received: e.target.value })} />
                  </Field>
                  <Field label={t('Condição', 'Condition')}>
                    <select className={inputCls} value={x.condition} onChange={(e) => patch(l.itemId, l.qty, { condition: e.target.value as ReturnCondition })}>
                      {(['good', 'damaged', 'defective'] as const).map((c) => (
                        <option key={c} value={c}>
                          {conditionLabel(c)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('Destino', 'Outcome')}>
                    <select className={inputCls} disabled={gone} value={x.decision} onChange={(e) => patch(l.itemId, l.qty, { decision: e.target.value as ReturnDecision | '' })}>
                      <option value="">{t('Escolha…', 'Choose…')}</option>
                      {(['restock', 'discard', 'return_to_supplier'] as const).map((d) => (
                        <option key={d} value={d} disabled={d === 'restock' && x.condition !== 'good'}>
                          {decisionLabel(d)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            )
          })}
          <Field label={t('Observações (obrigatório se houver divergência ou item fora de bom estado)', 'Notes (required if there is a discrepancy or a non-good item)')}>
            <textarea className={`${inputCls} min-h-16 py-2`} value={notes} maxLength={300} onChange={(e) => { setNotes(e.target.value); setError('') }} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button small variant="ghost" onClick={() => setMode('none')}>
              {t('Voltar', 'Back')}
            </Button>
            <Button small onClick={submitInspection}>
              {t('Confirmar inspeção', 'Confirm inspection')}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'resolve' ? (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('Resolução', 'Resolution')}>
              <select className={inputCls} value={res.kind} onChange={(e) => { setRes({ ...res, kind: e.target.value as typeof res.kind }); setError('') }}>
                <option value="refund">{t('Reembolso', 'Refund')}</option>
                <option value="replacement">{t('Troca', 'Replacement')}</option>
                <option value="none">{t('Nenhuma', 'None')}</option>
              </select>
            </Field>
            <Field label={t('Referência (reembolso ou troca)', 'Reference (refund or replacement)')}>
              <input className={inputCls} value={res.reference} maxLength={60} onChange={(e) => { setRes({ ...res, reference: e.target.value }); setError('') }} />
            </Field>
          </div>
          <Field label={t('Observação (opcional)', 'Note (optional)')}>
            <input className={inputCls} value={res.note} maxLength={300} onChange={(e) => setRes({ ...res, note: e.target.value })} />
          </Field>
          <p className="text-xs text-subtle">{t('Só registra a resolução. O reembolso ou a troca devem ser feitos em Vendas e Contabilidade.', 'This only records the resolution. Refunds or replacements must be handled in Sales and Accounting.')}</p>
          <div className="flex justify-end gap-2">
            <Button small variant="ghost" onClick={() => setMode('none')}>
              {t('Voltar', 'Back')}
            </Button>
            <Button small onClick={() => done(resolveReturn(r.id, res), t('Devolução encerrada.', 'Return closed.'))}>
              {t('Encerrar devolução', 'Close return')}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t('Histórico', 'History')}</summary>
        <ol className="mt-2 space-y-1.5 border-l border-line pl-4">
          {r.events.map((e) => (
            <li key={e.id} className="text-sm">
              <span className="font-medium">{actionLabel(e.action)}</span>
              {e.note ? <span className="text-muted"> · {e.note}</span> : null}
              <span className="block text-xs text-subtle">
                {dateTimeText(e.at)} · {e.actor}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </TCard>
  )
}

// ---------- Aba Devoluções ----------

type Filter = 'all' | 'open' | 'closed'

export function ReturnsPanel({ onNew, onOpenShipment }: { onNew: () => void; onOpenShipment: (id: string) => void }) {
  const { data } = useStore()
  const network = useNetwork()
  const returns = returnsForEnvironment(data, network)
  const [filter, setFilter] = useState<Filter>('open')
  const open = returns.filter((r) => !isReturnFinal(r))
  const list = filter === 'all' ? returns : filter === 'open' ? open : returns.filter(isReturnFinal)

  return (
    <div className="space-y-4">
      <TCard className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PanelTitle icon={<Undo2 size={18} />} title={t('Devoluções', 'Returns')} subtitle={t('Logística reversa: autorizar, receber, inspecionar e resolver', 'Reverse logistics: authorize, receive, inspect and resolve')} />
          <div className="flex flex-wrap items-center gap-2">
            <PillTabs
              label={t('Filtro de devoluções', 'Returns filter')}
              value={filter}
              onChange={(v) => setFilter(v)}
              items={[
                { id: 'open', label: `${t('Em andamento', 'In progress')} (${open.length})` },
                { id: 'closed', label: t('Finalizadas', 'Finished') },
                { id: 'all', label: t('Todas', 'All') },
              ]}
            />
            <Button onClick={onNew}>
              <Plus size={16} /> {t('Nova devolução', 'New return')}
            </Button>
          </div>
        </div>
        <p className="mt-3 rounded-xl bg-fill/5 px-3 py-2 text-xs text-muted text-pretty">
          {t('Itens devolvidos nunca voltam ao estoque sem inspeção, e itens danificados ou com defeito nunca são reestocados automaticamente. Reembolsos e trocas são apenas registrados.', 'Returned items never go back to stock without an inspection, and damaged or defective items are never restocked automatically. Refunds and replacements are only recorded.')}
        </p>
      </TCard>
      {list.length === 0 ? (
        <TCard className="p-4">
          <Empty icon={<PackageX size={22} />} title={filter === 'open' ? t('Nenhuma devolução em andamento', 'No returns in progress') : t('Nenhuma devolução encontrada', 'No returns found')} text={t('Devoluções começam em uma remessa de saída já entregue.', 'Returns start from an already delivered outbound shipment.')} action={<Button onClick={onNew}>{t('Nova devolução', 'New return')}</Button>} />
        </TCard>
      ) : (
        <ul className="space-y-4">
          {list.map((r) => (
            <li key={r.id}>
              <ReturnCard r={r} onOpenShipment={onOpenShipment} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
