import { useState } from 'react'
import { CheckCircle2, Circle, Globe2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, inputCls } from '@/components/ui'
import { useStore } from '@/lib/store'
import { INCOTERMS, adapterForShipment, countryCode, isInternational, readiness, type ReadinessKey } from '@/lib/international'
import { parseNum } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Incoterm, Shipment } from '@/lib/types'
import { explain, formatAmount } from './labels'

const readinessLabel = (k: ReadinessKey): string =>
  ({
    incoterm: t('Incoterm definido', 'Incoterm set'),
    hs_codes: t('Código HS/NCM em todos os itens', 'HS/NCM code on every item'),
    commercial_invoice: t('Fatura comercial (documento registrado)', 'Commercial invoice (document recorded)'),
    packing_list: t('Lista de embalagem (documento registrado)', 'Packing list (document recorded)'),
    customs_ref: t('Referência da declaração aduaneira', 'Customs declaration reference'),
  })[k]

const txt = (n: number): string => (n ? String(n) : '')

/**
 * Dados de remessa internacional. Tudo é informado manualmente: o app não calcula tributos nem atesta
 * conformidade aduaneira. O checklist é só um lembrete do que costuma ser pedido.
 */
export function InternationalPanel({ s }: { s: Shipment }) {
  const { setShipmentInternational } = useStore()
  const [editing, setEditing] = useState(false)
  const [incoterm, setIncoterm] = useState<Incoterm | ''>('')
  const [customsRef, setCustomsRef] = useState('')
  const [ieRef, setIeRef] = useState('')
  const [duties, setDuties] = useState('')
  const [taxes, setTaxes] = useState('')
  const [hs, setHs] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  if (!isInternational(s)) return null
  const adapter = adapterForShipment(s)
  const info = s.international
  const canEdit = s.status !== 'cancelled' && s.status !== 'returned'

  const open = () => {
    setIncoterm(info?.incoterm ?? '')
    setCustomsRef(info?.customsRef ?? '')
    setIeRef(info?.importExportRef ?? '')
    setDuties(txt(info?.dutiesAmount ?? 0))
    setTaxes(txt(info?.taxesAmount ?? 0))
    setHs(Object.fromEntries(s.items.map((i) => [i.id, i.hsCode ?? ''])))
    setError('')
    setEditing(true)
  }
  const num0 = (v: string) => (v.trim() === '' ? 0 : parseNum(v))
  const save = () => {
    const res = setShipmentInternational(s.id, { incoterm, customsRef, importExportRef: ieRef, dutiesAmount: num0(duties), taxesAmount: num0(taxes), hsCodes: hs })
    if (!res.ok) {
      setError(explain(res.errors))
      return
    }
    toast.success(t('Dados internacionais salvos.', 'International data saved.'))
    setEditing(false)
  }
  const checks = readiness(s)

  return (
    <section aria-label={t('Dados internacionais', 'International data')} className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Globe2 size={16} className="text-violet" /> {t('Remessa internacional', 'International shipment')}
        </h3>
        <span className="mono text-xs text-subtle">
          {countryCode(s.origin.country)} → {countryCode(s.destination.country)}
        </span>
      </div>

      {!editing ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Incoterm</dt>
              <dd>{info?.incoterm ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Declaração aduaneira', 'Customs declaration')}</dt>
              <dd className="break-words">{info?.customsRef || '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Ref. importação/exportação', 'Import/export ref.')}</dt>
              <dd className="break-words">{info?.importExportRef || '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Impostos e taxas (informados)', 'Duties and taxes (entered)')}</dt>
              <dd className="num">{info ? `${formatAmount(info.dutiesAmount, s.currency)} / ${formatAmount(info.taxesAmount, s.currency)}` : '—'}</dd>
            </div>
          </dl>
          {s.items.length ? (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {s.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate">{i.name}</span>
                  <span className="mono shrink-0 text-xs text-muted">{i.hsCode || '—'}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="space-y-1" aria-label={t('Lembrete de documentação', 'Documentation reminder')}>
            {checks.map((c) => (
              <li key={c.key} className="flex items-center gap-2 text-sm">
                {c.ok ? <CheckCircle2 size={15} className="text-ok" aria-label={t('Ok', 'Done')} /> : <Circle size={15} className="text-subtle" aria-label={t('Pendente', 'Pending')} />}
                <span className={c.ok ? '' : 'text-muted'}>{readinessLabel(c.key)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-subtle">
            {t('Lembrete do que costuma ser exigido. Não calcula tributos nem atesta conformidade aduaneira; tudo é informado manualmente.', 'A reminder of what is usually required. It does not calculate duties or certify customs compliance; everything is entered manually.')}
          </p>
          {canEdit ? (
            <div className="flex justify-end">
              <Button small variant="ghost" onClick={open}>
                {t('Editar dados internacionais', 'Edit international data')}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Incoterm">
              <select className={inputCls} value={incoterm} onChange={(e) => setIncoterm(e.target.value as Incoterm | '')}>
                <option value="">—</option>
                {INCOTERMS.map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </Field>
            <Field label={t('Declaração aduaneira', 'Customs declaration')}>
              <input className={inputCls} value={customsRef} maxLength={60} onChange={(e) => setCustomsRef(e.target.value)} />
            </Field>
            <Field label={t('Ref. importação/exportação', 'Import/export ref.')}>
              <input className={inputCls} value={ieRef} maxLength={60} onChange={(e) => setIeRef(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('Impostos', 'Duties')}>
                <input className={`${inputCls} text-right`} inputMode="decimal" value={duties} onChange={(e) => setDuties(e.target.value)} />
              </Field>
              <Field label={t('Taxas', 'Taxes')}>
                <input className={`${inputCls} text-right`} inputMode="decimal" value={taxes} onChange={(e) => setTaxes(e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="space-y-2">
            <p className="label">
              {t('Código por item', 'Code per item')} · {adapter.name}: {adapter.hint}
            </p>
            {s.items.map((i) => (
              <div key={i.id} className="grid grid-cols-[1fr_150px] items-center gap-2">
                <span className="truncate text-sm">{i.name}</span>
                <input aria-label={`${t('Código HS/NCM de', 'HS/NCM code of')} ${i.name}`} className={`${inputCls} mono`} value={hs[i.id] ?? ''} maxLength={14} placeholder="0901.21.00" onChange={(e) => { setHs({ ...hs, [i.id]: e.target.value }); setError('') }} />
              </div>
            ))}
          </div>
          <p className="text-xs text-subtle">{t('Valores informados por você. O app não calcula tributos.', 'Values you enter. The app does not calculate duties.')}</p>
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
              {t('Salvar', 'Save')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
