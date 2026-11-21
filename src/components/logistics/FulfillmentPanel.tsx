import { useState } from 'react'
import { CheckCircle2, ClipboardCheck, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Field, inputCls } from '@/components/ui'
import { useStore } from '@/lib/store'
import { allPicked, fulfillmentOf, needsFulfillment, pickedOf, trackedItems } from '@/lib/stock-checks'
import { num } from '@/lib/format'
import { t } from '@/lib/i18n'
import { parseNum } from '@/lib/format'
import type { Shipment } from '@/lib/types'
import { dateTimeText, explain } from './labels'

/**
 * Expedição de remessas de saída: separar, embalar (conferindo o estoque), comprovante de entrega e encerramento.
 * Nenhuma etapa baixa estoque: a venda ligada já baixou, e sem venda só conferimos o saldo.
 */
export function FulfillmentPanel({ s }: { s: Shipment }) {
  const { pickShipmentItem, packShipment, recordShipmentPod, closeShipmentFulfillment } = useStore()
  const f = fulfillmentOf(s)
  const tracked = trackedItems(s.items)
  const picking = needsFulfillment(s)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [pod, setPod] = useState({ receivedBy: '', reference: '', note: '' })
  const [error, setError] = useState('')

  if (s.direction !== 'outbound') return null
  if (!picking && s.status !== 'delivered') return null

  const run = (res: { ok: true } | { ok: false; errors: Parameters<typeof explain>[0] }, okText?: string) => {
    if (!res.ok) {
      setError(explain(res.errors))
      return false
    }
    setError('')
    if (okText) toast.success(okText)
    return true
  }

  const canPick = picking && s.status === 'ready' && !f.packedAt
  const stockText =
    f.stockCheck?.mode === 'sale_deducted'
      ? t(`Estoque já baixado pela venda ${s.orderRef?.label ?? ''}. Nada é baixado de novo.`, `Stock was already deducted by sale ${s.orderRef?.label ?? ''}. Nothing is deducted again.`)
      : t('Saldo conferido, sem baixa. Registre a saída pela aba Vendas ou Estoque.', 'Balance checked, nothing deducted. Record the outflow in Sales or Inventory.')

  return (
    <section aria-label={t('Expedição', 'Fulfillment')} className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <PackageCheck size={16} className="text-violet" /> {t('Expedição', 'Fulfillment')}
        </h3>
        {f.closedAt ? <Badge tone="ok">{t('Encerrada', 'Closed')}</Badge> : f.packedAt ? <Badge tone="accent">{t('Embalada', 'Packed')}</Badge> : null}
      </div>

      {picking ? (
        <>
          <ul className="divide-y divide-line rounded-lg border border-line" aria-label={t('Itens para separar', 'Items to pick')}>
            {tracked.map((i) => {
              const picked = pickedOf(s, i.id)
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {i.name} {i.sku ? <span className="mono text-xs text-subtle">{i.sku}</span> : null}
                  </span>
                  <span className="num shrink-0 font-semibold" aria-label={t('Separado', 'Picked')}>
                    {num(picked)}/{num(i.qty)}
                  </span>
                  {canPick ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <input
                        aria-label={`${t('Quantidade separada de', 'Picked quantity of')} ${i.name}`}
                        className={`${inputCls} !h-9 !w-20 text-right`}
                        inputMode="decimal"
                        value={qty[i.id] ?? ''}
                        placeholder={String(picked)}
                        onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })}
                      />
                      <Button
                        small
                        variant="ghost"
                        onClick={() => {
                          const raw = qty[i.id]
                          const v = raw === undefined || raw.trim() === '' ? NaN : parseNum(raw)
                          if (run(pickShipmentItem(s.id, i.id, v))) setQty({ ...qty, [i.id]: '' })
                        }}
                      >
                        {t('Salvar', 'Save')}
                      </Button>
                      <Button small variant="subtle" onClick={() => run(pickShipmentItem(s.id, i.id, i.qty))}>
                        {t('Separar tudo', 'Pick all')}
                      </Button>
                    </span>
                  ) : picked >= i.qty ? (
                    <CheckCircle2 size={16} className="text-ok" aria-label={t('Separado', 'Picked')} />
                  ) : null}
                </li>
              )
            })}
          </ul>
          {s.status === 'draft' ? <p className="text-xs text-subtle">{t('Marque a remessa como pronta para separar os itens.', 'Mark the shipment as ready to pick the items.')}</p> : null}
          {canPick ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-subtle">{t('A embalagem confere o estoque e libera o despacho.', 'Packing checks stock and unlocks dispatch.')}</p>
              <Button small disabled={!allPicked(s)} onClick={() => run(packShipment(s.id), t('Remessa embalada.', 'Shipment packed.'))}>
                <ClipboardCheck size={14} /> {t('Embalar e conferir estoque', 'Pack and check stock')}
              </Button>
            </div>
          ) : null}
          {f.packedAt ? (
            <p className="text-sm text-muted">
              {t('Embalada em', 'Packed on')} {dateTimeText(f.packedAt)}
              {f.packedBy ? ` · ${f.packedBy}` : ''}. {stockText}
            </p>
          ) : null}
        </>
      ) : null}

      {s.status === 'delivered' ? (
        f.pod ? (
          <div className="rounded-lg border border-line bg-fill/5 p-3 text-sm">
            <p className="font-semibold">{t('Comprovante de entrega', 'Proof of delivery')}</p>
            <p className="text-muted">
              {t('Recebido por', 'Received by')} {f.pod.receivedBy}
              {f.pod.reference ? ` · ${f.pod.reference}` : ''}
            </p>
            {f.pod.note ? <p className="text-muted">{f.pod.note}</p> : null}
            <p className="mt-0.5 text-xs text-subtle">
              {dateTimeText(f.pod.at)} · {t('informado manualmente por', 'entered manually by')} {f.pod.recordedBy}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t('Comprovante de entrega', 'Proof of delivery')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={t('Quem recebeu', 'Received by')}>
                <input className={inputCls} value={pod.receivedBy} maxLength={80} onChange={(e) => { setPod({ ...pod, receivedBy: e.target.value }); setError('') }} />
              </Field>
              <Field label={t('Referência (opcional)', 'Reference (optional)')}>
                <input className={inputCls} value={pod.reference} maxLength={60} onChange={(e) => setPod({ ...pod, reference: e.target.value })} />
              </Field>
            </div>
            <Field label={t('Observação (opcional)', 'Note (optional)')}>
              <input className={inputCls} value={pod.note} maxLength={300} onChange={(e) => setPod({ ...pod, note: e.target.value })} />
            </Field>
            <div className="flex justify-end">
              <Button small onClick={() => run(recordShipmentPod(s.id, pod), t('Comprovante registrado.', 'Proof of delivery recorded.'))}>
                {t('Registrar comprovante', 'Record proof')}
              </Button>
            </div>
          </div>
        )
      ) : null}

      {s.status === 'delivered' && f.pod && !f.closedAt ? (
        <div className="flex justify-end">
          <Button small onClick={() => run(closeShipmentFulfillment(s.id), t('Expedição encerrada.', 'Fulfillment closed.'))}>
            {t('Encerrar expedição', 'Close fulfillment')}
          </Button>
        </div>
      ) : null}
      {f.closedAt ? <p className="text-xs text-subtle">{t('Encerrada em', 'Closed on')} {dateTimeText(f.closedAt)}</p> : null}

      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </section>
  )
}
