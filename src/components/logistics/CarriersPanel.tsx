import { useState } from 'react'
import { Pencil, Plus, Trash2, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty, Field, Modal, inputCls } from '@/components/ui'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { useStore } from '@/lib/store'
import { CURRENCIES } from '@/lib/logistics'
import type { CarrierInput } from '@/lib/carriers'
import { adapterFor } from '@/lib/carriers'
import { parseNum } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Carrier, CurrencyCode } from '@/lib/types'
import { explain, formatAmount } from './labels'

interface LevelRow {
  key: number
  name: string
  minDays: string
  maxDays: string
}
interface Form {
  name: string
  countries: string
  methods: string
  contactName: string
  email: string
  phone: string
  trackingUrlTemplate: string
  levels: LevelRow[]
  costOn: boolean
  currency: CurrencyCode
  baseFee: string
  perKg: string
  active: boolean
}

let seq = 1
const csv = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)
const empty = (): Form => ({ name: '', countries: '', methods: '', contactName: '', email: '', phone: '', trackingUrlTemplate: '', levels: [], costOn: false, currency: 'BRL', baseFee: '', perKg: '', active: true })
const fromCarrier = (c: Carrier): Form => ({
  name: c.name,
  countries: c.countries.join(', '),
  methods: c.methods.join(', '),
  contactName: c.contactName,
  email: c.email,
  phone: c.phone,
  trackingUrlTemplate: c.trackingUrlTemplate,
  levels: c.serviceLevels.map((s) => ({ key: seq++, name: s.name, minDays: String(s.minDays), maxDays: String(s.maxDays) })),
  costOn: !!c.cost,
  currency: c.cost?.currency ?? 'BRL',
  baseFee: c.cost ? String(c.cost.baseFee) : '',
  perKg: c.cost ? String(c.cost.perKg) : '',
  active: c.active,
})

function CarrierModal({ target, onClose }: { target: Carrier | 'new' | null; onClose: () => void }) {
  const { createCarrier, updateCarrier } = useStore()
  const editing = target && target !== 'new' ? target : null
  const key = target === null ? null : editing ? editing.id : 'new'
  const [loaded, setLoaded] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [error, setError] = useState('')
  if (key !== loaded) {
    setLoaded(key)
    setError('')
    setForm(target === null ? null : editing ? fromCarrier(editing) : empty())
  }
  if (!form) return <Modal open={false} title="" onClose={onClose}>{null}</Modal>

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v })
  const text = (k: 'name' | 'countries' | 'methods' | 'contactName' | 'email' | 'phone' | 'trackingUrlTemplate' | 'baseFee' | 'perKg') => ({
    className: inputCls,
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      set(k, e.target.value)
      setError('')
    },
  })

  const submit = () => {
    const input: CarrierInput = {
      name: form.name,
      countries: csv(form.countries),
      methods: csv(form.methods),
      contactName: form.contactName,
      email: form.email,
      phone: form.phone,
      trackingUrlTemplate: form.trackingUrlTemplate,
      serviceLevels: form.levels.map((l) => ({ name: l.name, minDays: parseNum(l.minDays || '0'), maxDays: parseNum(l.maxDays || '0') })),
      cost: form.costOn ? { currency: form.currency, baseFee: form.baseFee.trim() ? parseNum(form.baseFee) : 0, perKg: form.perKg.trim() ? parseNum(form.perKg) : 0 } : undefined,
      active: form.active,
    }
    const res = editing ? updateCarrier(editing.id, input) : createCarrier(input)
    if (!res.ok) {
      setError(explain(res.errors))
      return
    }
    toast.success(editing ? t('Transportadora atualizada.', 'Carrier updated.') : t('Transportadora cadastrada.', 'Carrier added.'))
    onClose()
  }

  return (
    <Modal open title={editing ? `${t('Editar', 'Edit')} ${editing.name}` : t('Nova transportadora', 'New carrier')} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Nome', 'Name')}>
            <input {...text('name')} maxLength={60} />
          </Field>
          <Field label={t('Contato', 'Contact')}>
            <input {...text('contactName')} maxLength={80} />
          </Field>
          <Field label="E-mail">
            <input {...text('email')} type="email" maxLength={80} />
          </Field>
          <Field label={t('Telefone', 'Phone')}>
            <input {...text('phone')} maxLength={30} />
          </Field>
          <Field label={t('Países atendidos', 'Countries served')} hint={t('Separe por vírgula. Vazio = qualquer país.', 'Separate with commas. Empty = any country.')}>
            <input {...text('countries')} placeholder="BR, PT, US" />
          </Field>
          <Field label={t('Métodos de envio', 'Shipping methods')} hint={t('Separe por vírgula.', 'Separate with commas.')}>
            <input {...text('methods')} placeholder={t('Padrão, Expresso, Aéreo', 'Standard, Express, Air')} />
          </Field>
        </div>
        <Field label={t('Modelo de link de rastreio', 'Tracking link template')} hint={t('Link https com {tracking} no lugar do código. Ex.: https://exemplo.com/rastrear?codigo={tracking}', 'https link with {tracking} in place of the code. E.g. https://example.com/track?code={tracking}')}>
          <input {...text('trackingUrlTemplate')} maxLength={300} />
        </Field>

        <fieldset className="space-y-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-subtle">{t('Níveis de serviço e prazos', 'Service levels and lead times')}</legend>
          {form.levels.map((l) => (
            <div key={l.key} className="grid grid-cols-[1fr_72px_72px_40px] items-end gap-2">
              <Field label={t('Nome', 'Name')}>
                <input className={inputCls} value={l.name} maxLength={40} onChange={(e) => set('levels', form.levels.map((x) => (x.key === l.key ? { ...x, name: e.target.value } : x)))} />
              </Field>
              <Field label={t('Mín. (dias)', 'Min (days)')}>
                <input className={inputCls} inputMode="numeric" value={l.minDays} onChange={(e) => set('levels', form.levels.map((x) => (x.key === l.key ? { ...x, minDays: e.target.value } : x)))} />
              </Field>
              <Field label={t('Máx. (dias)', 'Max (days)')}>
                <input className={inputCls} inputMode="numeric" value={l.maxDays} onChange={(e) => set('levels', form.levels.map((x) => (x.key === l.key ? { ...x, maxDays: e.target.value } : x)))} />
              </Field>
              <button type="button" aria-label={t('Remover nível', 'Remove level')} onClick={() => set('levels', form.levels.filter((x) => x.key !== l.key))} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-fill/10 hover:text-bad">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <Button small variant="ghost" onClick={() => set('levels', [...form.levels, { key: seq++, name: '', minDays: '', maxDays: '' }])}>
            <Plus size={14} /> {t('Adicionar nível', 'Add level')}
          </Button>
        </fieldset>

        <fieldset className="space-y-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-subtle">{t('Estrutura de custo (estimativa)', 'Cost structure (estimate)')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-violet" checked={form.costOn} onChange={(e) => set('costOn', e.target.checked)} />
            {t('Informar custo para estimar o frete', 'Enter a cost to estimate freight')}
          </label>
          {form.costOn ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label={t('Moeda', 'Currency')}>
                <select className={inputCls} value={form.currency} onChange={(e) => set('currency', e.target.value as CurrencyCode)}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('Taxa fixa', 'Base fee')}>
                <input {...text('baseFee')} inputMode="decimal" />
              </Field>
              <Field label={t('Por kg', 'Per kg')}>
                <input {...text('perKg')} inputMode="decimal" />
              </Field>
            </div>
          ) : null}
          <p className="text-xs text-subtle">{t('Valores seus, usados só como estimativa. Não são uma cotação da transportadora.', 'Your own values, used only as an estimate. They are not a carrier quote.')}</p>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-violet" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
          {t('Ativa (pode ser escolhida em novas remessas)', 'Active (can be chosen for new shipments)')}
        </label>

        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar', 'Cancel')}
          </Button>
          <Button onClick={submit}>{editing ? t('Salvar alterações', 'Save changes') : t('Cadastrar', 'Add carrier')}</Button>
        </div>
      </div>
    </Modal>
  )
}

/** Diretório de transportadoras. O adaptador atual é manual: guarda o modelo de link de rastreio e nada é consultado automaticamente. */
export function CarriersPanel() {
  const { data, setCarrierActive, removeCarrier } = useStore()
  const [target, setTarget] = useState<Carrier | 'new' | null>(null)
  const used = (c: Carrier) => data.shipments.filter((s) => s.carrierId === c.id).length

  return (
    <div className="space-y-4">
      <TCard className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PanelTitle icon={<Truck size={18} />} title={t('Transportadoras', 'Carriers')} subtitle={t('Cadastro, prazos e links de rastreio', 'Directory, lead times and tracking links')} />
          <Button onClick={() => setTarget('new')}>
            <Plus size={16} /> {t('Nova transportadora', 'New carrier')}
          </Button>
        </div>
        <p className="mt-3 rounded-xl bg-fill/5 px-3 py-2 text-xs text-muted text-pretty">
          {t('Integrações automáticas (DHL, FedEx, UPS, Correios e regionais) ainda não existem: o rastreio é informado manualmente e o link abre o site da transportadora.', 'Automatic integrations (DHL, FedEx, UPS, Correios and regional) do not exist yet: tracking is entered manually and the link opens the carrier site.')}
        </p>
      </TCard>

      {data.carriers.length === 0 ? (
        <TCard className="p-4">
          <Empty icon={<Truck size={22} />} title={t('Nenhuma transportadora cadastrada', 'No carriers yet')} text={t('Cadastre as que você usa para escolher nas remessas e comparar custos.', 'Add the ones you use to pick them in shipments and compare costs.')} action={<Button onClick={() => setTarget('new')}>{t('Nova transportadora', 'New carrier')}</Button>} />
        </TCard>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {data.carriers.map((c) => {
            const n = used(c)
            return (
              <li key={c.id}>
                <TCard className="h-full p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="display truncate text-base font-semibold">{c.name}</h3>
                      <p className="mono text-xs text-subtle">{c.id}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={c.active ? 'ok' : 'neutral'}>{c.active ? t('Ativa', 'Active') : t('Inativa', 'Inactive')}</Badge>
                      <Badge tone="accent">{adapterFor(c).id === 'manual' ? t('Rastreio manual', 'Manual tracking') : adapterFor(c).id}</Badge>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Países', 'Countries')}</dt>
                      <dd>{c.countries.join(', ') || t('Qualquer', 'Any')}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Métodos', 'Methods')}</dt>
                      <dd>{c.methods.join(', ') || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Contato', 'Contact')}</dt>
                      <dd className="break-words">{[c.contactName, c.email, c.phone].filter(Boolean).join(' · ') || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Custo estimado', 'Estimated cost')}</dt>
                      <dd>{c.cost ? `${formatAmount(c.cost.baseFee, c.cost.currency)} + ${formatAmount(c.cost.perKg, c.cost.currency)}/kg` : '—'}</dd>
                    </div>
                  </dl>
                  {c.serviceLevels.length ? (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {c.serviceLevels.map((s) => (
                        <li key={s.id}>
                          <Badge tone="neutral">
                            {s.name}: {s.minDays === s.maxDays ? s.minDays : `${s.minDays}–${s.maxDays}`} {t('dias', 'days')}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="mt-3 text-xs text-subtle">
                    {c.trackingUrlTemplate ? t('Link de rastreio configurado.', 'Tracking link configured.') : t('Sem link de rastreio.', 'No tracking link.')} · {n} {n === 1 ? t('remessa', 'shipment') : t('remessas', 'shipments')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button small variant="ghost" onClick={() => setTarget(c)}>
                      <Pencil size={14} /> {t('Editar', 'Edit')}
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      onClick={() => {
                        const r = setCarrierActive(c.id, !c.active)
                        if (!r.ok) toast.error(explain(r.errors))
                      }}
                    >
                      {c.active ? t('Desativar', 'Deactivate') : t('Ativar', 'Activate')}
                    </Button>
                    <Button
                      small
                      variant="danger"
                      disabled={n > 0}
                      title={n > 0 ? t('Tem remessas: desative em vez de remover.', 'Has shipments: deactivate instead of removing.') : undefined}
                      onClick={() => {
                        const r = removeCarrier(c.id)
                        if (!r.ok) toast.error(explain(r.errors))
                        else toast.success(t('Transportadora removida.', 'Carrier removed.'))
                      }}
                    >
                      <Trash2 size={14} /> {t('Remover', 'Remove')}
                    </Button>
                  </div>
                </TCard>
              </li>
            )
          })}
        </ul>
      )}
      <CarrierModal target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
