import { useState } from 'react'
import { Plus, Receipt, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Field, inputCls } from '@/components/ui'
import { useStore } from '@/lib/store'
import { estimateFreight } from '@/lib/carriers'
import { freightTotal, freightVariance } from '@/lib/freight'
import { isFreightPosted } from '@/lib/logistics'
import { addDays, parseNum, today } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Shipment } from '@/lib/types'
import { explain, formatAmount } from './labels'

interface FeeRow {
  key: number
  label: string
  amount: string
}
let seq = 1
const txt = (n: number | undefined): string => (n ? String(n) : '')

/** Custos da remessa: frete, seguro, taxas, estimado contra real e lançamento único em contas a pagar. */
export function FreightPanel({ s }: { s: Shipment }) {
  const { data, setShipmentFreight, postShipmentFreight } = useStore()
  const [editing, setEditing] = useState(false)
  const [cost, setCost] = useState('')
  const [estimated, setEstimated] = useState('')
  const [insurance, setInsurance] = useState('')
  const [fees, setFees] = useState<FeeRow[]>([])
  const [due, setDue] = useState(addDays(today(), 30))
  const [error, setError] = useState('')

  const posted = isFreightPosted(data, s)
  const total = freightTotal(s)
  const variance = freightVariance(s)
  const carrier = s.carrierId ? data.carriers.find((c) => c.id === s.carrierId) : undefined
  const weight = s.packages.reduce((sum, p) => sum + p.weightKg, 0)
  const suggestion = estimateFreight(carrier, weight)
  const canEdit = s.status !== 'cancelled' && !posted
  const canPost = s.status !== 'draft' && s.status !== 'cancelled' && !posted && total > 0

  const open = () => {
    setCost(txt(s.freightCost))
    setEstimated(txt(s.freight?.estimated))
    setInsurance(txt(s.freight?.insurance))
    setFees((s.freight?.fees ?? []).map((f) => ({ key: seq++, label: f.label, amount: String(f.amount) })))
    setError('')
    setEditing(true)
  }
  const num0 = (v: string) => (v.trim() === '' ? 0 : parseNum(v))
  const save = () => {
    const res = setShipmentFreight(s.id, {
      freightCost: num0(cost),
      estimated: estimated.trim() === '' ? undefined : parseNum(estimated),
      insurance: num0(insurance),
      fees: fees.map((f) => ({ label: f.label, amount: num0(f.amount) })),
    })
    if (!res.ok) {
      setError(explain(res.errors))
      return
    }
    toast.success(t('Custos atualizados.', 'Costs updated.'))
    setEditing(false)
  }
  const post = () => {
    const res = postShipmentFreight(s.id, due)
    if (!res.ok) {
      setError(explain(res.errors))
      return
    }
    setError('')
    toast.success(t('Custo lançado em contas a pagar.', 'Cost posted to payables.'))
  }

  return (
    <section aria-label={t('Custos de frete', 'Freight costs')} className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Receipt size={16} className="text-violet" /> {t('Custos de frete', 'Freight costs')}
        </h3>
        {posted ? <Badge tone="ok">{t('Lançado em contas a pagar', 'Posted to payables')}</Badge> : null}
      </div>

      {!editing ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Frete', 'Freight')}</dt>
              <dd className="num">{formatAmount(s.freightCost, s.currency)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Seguro', 'Insurance')}</dt>
              <dd className="num">{formatAmount(s.freight?.insurance ?? 0, s.currency)}</dd>
            </div>
            {(s.freight?.fees ?? []).map((f) => (
              <div key={f.id}>
                <dt className="truncate text-[11px] font-semibold uppercase tracking-wider text-subtle">{f.label}</dt>
                <dd className="num">{formatAmount(f.amount, s.currency)}</dd>
              </div>
            ))}
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Total', 'Total')}</dt>
              <dd className="num font-semibold">{formatAmount(total, s.currency)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Estimado', 'Estimated')}</dt>
              <dd className="num">
                {s.freight?.estimated !== undefined ? formatAmount(s.freight.estimated, s.currency) : '—'}
                {variance !== null ? <span className={`ml-1.5 text-xs ${variance > 0 ? 'text-bad' : 'text-ok'}`}>{variance > 0 ? '+' : ''}{formatAmount(variance, s.currency)}</span> : null}
              </dd>
            </div>
          </dl>
          {suggestion && suggestion.currency === s.currency ? (
            <p className="text-xs text-subtle">
              {t('Estimativa pela estrutura de custo de', 'Estimate from the cost structure of')} {carrier?.name}: {formatAmount(suggestion.amount, suggestion.currency)} ({weight} kg). {t('Valores informados por você, não uma cotação.', 'Values you entered, not a quote.')}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-end justify-end gap-2">
            {canEdit ? (
              <Button small variant="ghost" onClick={open}>
                {t('Editar custos', 'Edit costs')}
              </Button>
            ) : null}
            {canPost ? (
              <>
                <label className="block">
                  <span className="label mb-1 block">{t('Vencimento', 'Due date')}</span>
                  <input type="date" className={`${inputCls} !h-9 !w-40`} value={due} onChange={(e) => setDue(e.target.value)} />
                </label>
                <Button small onClick={post}>
                  {t('Lançar em contas a pagar', 'Post to payables')}
                </Button>
              </>
            ) : null}
          </div>
          {!posted && s.status === 'draft' ? <p className="text-xs text-subtle">{t('O lançamento fica disponível depois que a remessa estiver pronta.', 'Posting is available once the shipment is ready.')}</p> : null}
          {posted ? <p className="text-xs text-subtle">{t('Os valores ficam travados. Pague pela aba Contas a pagar e receber.', 'Values are locked. Pay it from the Payables and receivables tab.')}</p> : null}
        </>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label={t('Frete', 'Freight')}>
              <input className={`${inputCls} text-right`} inputMode="decimal" value={cost} onChange={(e) => { setCost(e.target.value); setError('') }} />
            </Field>
            <Field label={t('Estimado (opcional)', 'Estimated (optional)')}>
              <input className={`${inputCls} text-right`} inputMode="decimal" value={estimated} onChange={(e) => { setEstimated(e.target.value); setError('') }} />
            </Field>
            <Field label={t('Seguro', 'Insurance')}>
              <input className={`${inputCls} text-right`} inputMode="decimal" value={insurance} onChange={(e) => { setInsurance(e.target.value); setError('') }} />
            </Field>
          </div>
          {suggestion && suggestion.currency === s.currency ? (
            <Button small variant="subtle" onClick={() => setEstimated(String(suggestion.amount))}>
              {t('Usar estimativa da transportadora', 'Use carrier estimate')} ({formatAmount(suggestion.amount, suggestion.currency)})
            </Button>
          ) : null}
          <div className="space-y-2">
            <p className="label">{t('Taxas adicionais', 'Additional fees')}</p>
            {fees.map((f) => (
              <div key={f.key} className="grid grid-cols-[1fr_110px_40px] items-center gap-2">
                <input aria-label={t('Descrição da taxa', 'Fee description')} className={inputCls} value={f.label} maxLength={60} placeholder={t('Ex.: Combustível', 'E.g. Fuel')} onChange={(e) => setFees(fees.map((x) => (x.key === f.key ? { ...x, label: e.target.value } : x)))} />
                <input aria-label={t('Valor da taxa', 'Fee amount')} className={`${inputCls} text-right`} inputMode="decimal" value={f.amount} onChange={(e) => setFees(fees.map((x) => (x.key === f.key ? { ...x, amount: e.target.value } : x)))} />
                <button type="button" aria-label={t('Remover taxa', 'Remove fee')} onClick={() => setFees(fees.filter((x) => x.key !== f.key))} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-fill/10 hover:text-bad">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <Button small variant="ghost" onClick={() => setFees([...fees, { key: seq++, label: '', amount: '' }])}>
              <Plus size={14} /> {t('Adicionar taxa', 'Add fee')}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button small variant="ghost" onClick={() => setEditing(false)}>
              {t('Cancelar', 'Cancel')}
            </Button>
            <Button small onClick={save}>
              {t('Salvar custos', 'Save costs')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
