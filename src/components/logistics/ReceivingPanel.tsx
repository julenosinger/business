import { useState } from 'react'
import { PackageOpen } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Field, inputCls } from '@/components/ui'
import { useStore } from '@/lib/store'
import { num, parseNum } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Shipment } from '@/lib/types'
import { dateTimeText, explain } from './labels'

const discrepancyLabel = (d: string): string =>
  d === 'short' ? t('Falta', 'Short') : d === 'over' ? t('Sobra', 'Over') : d === 'damaged' ? t('Danificado', 'Damaged') : t('Ok', 'OK')

interface Row {
  received: string
  damaged: string
}

/**
 * Recebimento de mercadorias de uma remessa de entrada. É o único ponto da logística que soma estoque:
 * só depois de a remessa ter chegado, só com a conferência confirmada e uma única vez.
 */
export function ReceivingPanel({ s }: { s: Shipment }) {
  const { data, receiveShipmentGoods } = useStore()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [notes, setNotes] = useState('')
  const [choice, setChoice] = useState<'post' | 'already_counted' | ''>('')
  const [error, setError] = useState('')

  if (s.direction !== 'inbound') return null
  if (s.returnId) {
    return (
      <p className="rounded-xl border border-line bg-fill/5 p-3 text-xs text-subtle">
        {t(`Remessa de devolução ${s.returnId}: o estoque só volta pela inspeção da devolução (aba Devoluções), nunca pelo recebimento comum.`, `Return shipment ${s.returnId}: stock only comes back through the return inspection (Returns tab), never through the regular goods receipt.`)}
      </p>
    )
  }

  const receipt = s.receiptId ? data.receipts.find((r) => r.id === s.receiptId) : undefined
  const purchase = s.orderRef?.kind === 'purchase' && s.orderRef.id ? data.purchases.find((p) => p.id === s.orderRef?.id) : undefined
  const row = (id: string, qty: number): Row => rows[id] ?? { received: String(qty), damaged: '0' }
  const num0 = (v: string): number => (v.trim() === '' ? NaN : parseNum(v))
  // Remessa ligada a compra pode ser recebida direto de `ready` (compra "aguardar recebimento").
  const linkedPurchase = s.orderRef?.kind === 'purchase' && !!s.orderRef.id
  const canReceive = s.status === 'delivered' || (s.status === 'ready' && linkedPurchase)

  if (receipt) {
    return (
      <section aria-label={t('Recebimento', 'Goods receipt')} className="space-y-2 rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <PackageOpen size={16} className="text-violet" /> {t('Recebimento', 'Goods receipt')} · <span className="mono">{receipt.id}</span>
          </h3>
          <Badge tone="ok">{t('Recebida', 'Received')}</Badge>
        </div>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {receipt.lines.map((l) => (
            <li key={l.itemId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <span className="num shrink-0 text-xs text-muted">
                {t('previsto', 'expected')} {num(l.expectedQty)} · {t('recebido', 'received')} {num(l.receivedQty)}
                {l.damagedQty ? ` · ${t('danificado', 'damaged')} ${num(l.damagedQty)}` : ''} · {t('aceito', 'accepted')} <b className="text-ink">{num(l.acceptedQty)}</b>
              </span>
              {l.discrepancy !== 'none' ? <Badge tone="warn">{discrepancyLabel(l.discrepancy)}</Badge> : null}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          {receipt.stockMode === 'posted'
            ? t('Estoque atualizado com as quantidades aceitas.', 'Stock updated with the accepted quantities.')
            : t('Estoque não alterado: já estava lançado antes do recebimento.', 'Stock not changed: it was already counted before receiving.')}
        </p>
        {receipt.notes ? <p className="text-sm text-muted">{receipt.notes}</p> : null}
        <p className="text-xs text-subtle">
          {dateTimeText(receipt.receivedAt)} · {t('conferido por', 'checked by')} {receipt.receivedBy}
        </p>
      </section>
    )
  }

  if (!canReceive) {
    return s.items.length ? (
      <p className="rounded-xl border border-line bg-fill/5 p-3 text-xs text-subtle">
        {t('O estoque só é somado depois que a remessa chegar (status Entregue) e o recebimento for conferido aqui. Mudar o status não altera o estoque.', 'Stock is only added after the shipment arrives (Delivered) and the receipt is checked here. Changing the status never changes stock.')}
      </p>
    ) : null
  }

  const mode = purchase ? (purchase.stockPosted ? 'already_counted' : 'post') : choice
  const accepted = s.items.map((i) => {
    const r = row(i.id, i.qty)
    const rec = num0(r.received)
    const dmg = num0(r.damaged)
    return Number.isFinite(rec) && Number.isFinite(dmg) ? Math.max(0, rec - dmg) : 0
  })
  const toStock = s.items.reduce((sum, i, idx) => sum + (i.productId ? (accepted[idx] ?? 0) : 0), 0)

  const confirm = () => {
    const res = receiveShipmentGoods(s.id, {
      lines: s.items.map((i) => {
        const r = row(i.id, i.qty)
        return { itemId: i.id, receivedQty: num0(r.received), damagedQty: num0(r.damaged) }
      }),
      notes,
      stockChoice: choice || undefined,
    })
    if (!res.ok) {
      setError(explain(res.errors))
      return
    }
    toast.success(res.value.stockMode === 'posted' ? t('Recebimento confirmado e estoque atualizado.', 'Receipt confirmed and stock updated.') : t('Recebimento confirmado (estoque já lançado).', 'Receipt confirmed (stock already counted).'))
    setOpen(false)
    setError('')
  }

  return (
    <section aria-label={t('Recebimento', 'Goods receipt')} className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <PackageOpen size={16} className="text-violet" /> {t('Recebimento de mercadorias', 'Goods receipt')}
        </h3>
        <Badge tone="warn">{t('Aguardando conferência', 'Awaiting check')}</Badge>
      </div>
      {!open ? (
        <>
          <p className="text-sm text-muted">{t('A remessa chegou. Confira as quantidades e a condição antes de confirmar. O estoque ainda não foi alterado.', 'The shipment arrived. Check quantities and condition before confirming. Stock has not changed yet.')}</p>
          <div className="flex justify-end">
            <Button small onClick={() => setOpen(true)}>
              {t('Conferir e receber', 'Check and receive')}
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-2">
            {s.items.map((i, idx) => {
              const r = row(i.id, i.qty)
              return (
                <li key={i.id} className="rounded-lg border border-line p-2.5">
                  <p className="text-sm font-medium">
                    {i.name} <span className="text-xs text-subtle">· {t('previsto', 'expected')} {num(i.qty)}</span>
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Field label={t('Recebido', 'Received')}>
                      <input className={`${inputCls} text-right`} inputMode="decimal" value={r.received} onChange={(e) => { setRows({ ...rows, [i.id]: { ...r, received: e.target.value } }); setError('') }} />
                    </Field>
                    <Field label={t('Danificado', 'Damaged')}>
                      <input className={`${inputCls} text-right`} inputMode="decimal" value={r.damaged} onChange={(e) => { setRows({ ...rows, [i.id]: { ...r, damaged: e.target.value } }); setError('') }} />
                    </Field>
                    <div>
                      <span className="label mb-1.5 block">{t('Aceito', 'Accepted')}</span>
                      <p className="num flex h-11 items-center justify-end rounded-xl bg-fill/5 px-3 font-semibold">{num(accepted[idx] ?? 0)}</p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          {purchase ? (
            <p className="rounded-lg border border-line bg-fill/5 p-2.5 text-sm text-muted">
              {purchase.stockPosted
                ? t(`A compra ${purchase.id} já somou o estoque ao ser registrada. O recebimento só confirma a chegada e não soma de novo.`, `Purchase ${purchase.id} already added stock when it was recorded. Receiving only confirms arrival and does not add it again.`)
                : t(`A compra ${purchase.id} aguardava recebimento: o estoque aceito (${num(toStock)} un) será somado agora, uma única vez. Itens danificados não entram.`, `Purchase ${purchase.id} was awaiting receipt: the accepted stock (${num(toStock)} units) will be added now, only once. Damaged items are not added.`)}
            </p>
          ) : (
            <fieldset className="space-y-1.5 rounded-lg border border-line p-2.5">
              <legend className="px-1 text-xs font-medium text-muted">{t('Estoque (escolha uma opção)', 'Stock (choose one)')}</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name={`stock-${s.id}`} className="mt-1" checked={choice === 'post'} onChange={() => { setChoice('post'); setError('') }} />
                <span>{t(`Somar ao estoque as quantidades aceitas (${num(toStock)} un)`, `Add the accepted quantities to stock (${num(toStock)} units)`)}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name={`stock-${s.id}`} className="mt-1" checked={choice === 'already_counted'} onChange={() => { setChoice('already_counted'); setError('') }} />
                <span>{t('O estoque já foi lançado (por exemplo, pela aba Compras). Não alterar.', 'Stock was already counted (for example in Purchases). Do not change it.')}</span>
              </label>
            </fieldset>
          )}

          <Field label={t('Observações (obrigatório se houver divergência)', 'Notes (required if there is a discrepancy)')}>
            <textarea className={`${inputCls} min-h-16 py-2`} value={notes} maxLength={300} onChange={(e) => { setNotes(e.target.value); setError('') }} />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button small variant="ghost" onClick={() => { setOpen(false); setError('') }}>
              {t('Cancelar', 'Cancel')}
            </Button>
            <Button small disabled={!mode} onClick={confirm}>
              {t('Confirmar recebimento', 'Confirm receipt')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
