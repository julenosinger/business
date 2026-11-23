import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ClipboardList, Copy, Loader2, MapPin, Pencil, Phone, Plus, Receipt, Search, Trash2, TrendingUp, Truck, UserRound, Users, Wallet } from 'lucide-react'
import { Button, Empty, Field, Modal, TableWrap, inputCls, td, th } from '@/components/ui'
import { DraftPrompt, EnvironmentBadge, FormAccordion, FormFieldError, FormFooter, FormHelpText, FormSection } from '@/components/form'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { useStore } from '@/lib/store'
import { useNetwork } from '@/lib/network'
import { accountsForEnvironment, contactsForEnvironment, salesForEnvironment } from '@/lib/selectors'
import { docInvalidError, docValidForSubmit, isEmailValid, maskCnpj, maskCpf } from '@/lib/documents'
import { findContactDuplicates } from '@/lib/duplicates'
import { lookupCep, lookupCnpj, type CnpjResult } from '@/lib/lookup'
import { useDraft } from '@/lib/draft'
import { isValidAddress } from '@/lib/gateway'
import { money, shortAddr } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Contact, PersonType } from '@/lib/types'

type Kind = Contact['kind']

const blankAddress = { cep: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '', country: '' }

const blank = {
  name: '',
  doc: '',
  email: '',
  phone: '',
  wallet: '',
  personType: 'fisica' as PersonType,
  legalName: '',
  internalCode: '',
  secondaryPhone: '',
  contactPersonName: '',
  contactPersonRole: '',
  address: { ...blankAddress },
  notes: '',
  paymentTerms: '',
  active: true,
}

function contactToForm(c?: Contact): typeof blank {
  if (!c) return blank
  return {
    name: c.name,
    doc: c.doc,
    email: c.email,
    phone: c.phone,
    wallet: c.wallet,
    personType: c.personType ?? 'fisica',
    legalName: c.legalName ?? '',
    internalCode: c.internalCode ?? '',
    secondaryPhone: c.secondaryPhone ?? '',
    contactPersonName: c.contactPersonName ?? '',
    contactPersonRole: c.contactPersonRole ?? '',
    address: { ...blankAddress, ...(c.address ?? {}) },
    notes: c.notes ?? '',
    paymentTerms: c.paymentTerms ?? '',
    active: c.active ?? true,
  }
}

function ContactModal({ kind, target, onClose }: { kind: Kind; target: Contact | 'new' | null; onClose: () => void }) {
  const { data, addContact, updateContact } = useStore()
  const editing = target && target !== 'new' ? target : null
  const [form, setForm] = useState(blank)
  const [loaded, setLoaded] = useState<string | null>(null)
  const key = target === null ? null : editing ? editing.id : 'new'
  if (key !== loaded) {
    setLoaded(key)
    setForm(contactToForm(editing ?? undefined))
  }
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setAddress = (k: keyof typeof blankAddress) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, address: { ...f.address, [k]: e.target.value } }))

  const setDoc = (raw: string) => {
    cnpjAbort.current?.abort()
    setCnpjData(null)
    setForm((f) => ({ ...f, doc: f.personType === 'fisica' ? maskCpf(raw) : maskCnpj(raw) }))
  }
  const setPersonType = (pt: PersonType) => {
    cnpjAbort.current?.abort()
    setCnpjData(null)
    setForm((f) => ({ ...f, personType: pt, doc: pt === 'fisica' ? maskCpf(f.doc) : maskCnpj(f.doc) }))
  }

  const walletOk = form.wallet.trim() === '' || isValidAddress(form.wallet.trim())
  const docInvalid = docInvalidError(form.doc, form.personType)
  const emailInvalid = !isEmailValid(form.email)
  const isCustomer = kind === 'customer'
  const icon = isCustomer ? <Users size={22} /> : <Truck size={22} />
  const docLabel = form.personType === 'fisica' ? t('CPF', 'CPF') : t('CNPJ', 'CNPJ')

  // --- Consultas externas (opcionais) ---
  const network = useNetwork()
  const cepAbort = useRef<AbortController | null>(null)
  const cnpjAbort = useRef<AbortController | null>(null)
  const [cepBusy, setCepBusy] = useState(false)
  const [cnpjBusy, setCnpjBusy] = useState(false)
  const [cnpjData, setCnpjData] = useState<CnpjResult | null>(null)
  const [cnpjApplied, setCnpjApplied] = useState(false)

  const scopedContacts = contactsForEnvironment(data, network).filter((c) => c.kind === kind)
  const dup = findContactDuplicates(scopedContacts, { doc: form.doc, internalCode: form.internalCode, name: form.name, email: form.email, kind }, editing?.id)

  // Referência ao documento atual, para descartar respostas assíncronas obsoletas.
  const docRef = useRef(form.doc)
  useEffect(() => {
    docRef.current = form.doc
  }, [form.doc])

  // --- Rascunho seguro ---
  const draft = useDraft(`contact-${kind}`, editing?.id ?? null, form, contactToForm(editing ?? undefined))

  const searchCep = async () => {
    const cep = form.address.cep.replace(/\D/g, '')
    if (cep.length !== 8) {
      toast.info(t('Informe um CEP com 8 dígitos.', 'Enter an 8-digit postal code.'))
      return
    }
    cepAbort.current?.abort()
    const controller = new AbortController()
    cepAbort.current = controller
    setCepBusy(true)
    try {
      const r = await lookupCep(cep, controller.signal)
      // Aplica somente se o CEP atual ainda for o consultado (descarta resposta obsoleta).
      setForm((f) => {
        if (f.address.cep.replace(/\D/g, '') !== cep) return f
        return {
          ...f,
          address: {
            ...f.address,
            street: f.address.street.trim() ? f.address.street : r.street,
            neighborhood: f.address.neighborhood.trim() ? f.address.neighborhood : r.neighborhood,
            city: f.address.city.trim() ? f.address.city : r.city,
            state: f.address.state.trim() ? f.address.state : r.state,
          },
        }
      })
      toast.success(t('Endereço preenchido (revise antes de salvar).', 'Address filled (review before saving).'))
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        toast.error(t('Não foi possível consultar o CEP. Preencha manualmente.', 'Could not look up the postal code. Fill in manually.'))
      }
    } finally {
      setCepBusy(false)
    }
  }

  const searchCnpj = async () => {
    if (!docValidForSubmit(form.doc, 'juridica')) return
    const cnpj = form.doc.replace(/\D/g, '')
    cnpjAbort.current?.abort()
    const controller = new AbortController()
    cnpjAbort.current = controller
    setCnpjBusy(true)
    setCnpjData(null)
    try {
      const r = await lookupCnpj(cnpj, controller.signal)
      // Descarta se o CNPJ atual mudou durante a consulta.
      if (docRef.current.replace(/\D/g, '') !== cnpj) return
      if (r.legalName || r.tradeName || r.street) {
        setCnpjData(r)
        setCnpjApplied(false)
        toast.success(t('Dados encontrados. Revise e aplique.', 'Data found. Review and apply.'))
      } else {
        toast.info(t('Nenhum dado confiável encontrado para este CNPJ.', 'No reliable data found for this CNPJ.'))
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        toast.error(t('Não foi possível consultar o CNPJ. Continue manualmente.', 'Could not look up the CNPJ. Continue manually.'))
      }
    } finally {
      setCnpjBusy(false)
    }
  }

  const applyCnpj = () => {
    if (!cnpjData) return
    setForm((f) => ({
      ...f,
      name: f.name.trim() ? f.name : cnpjData.tradeName || cnpjData.legalName,
      legalName: f.legalName.trim() ? f.legalName : cnpjData.legalName,
      address: {
        ...f.address,
        cep: f.address.cep.trim() ? f.address.cep : cnpjData.cep,
        street: f.address.street.trim() ? f.address.street : cnpjData.street,
        number: f.address.number.trim() ? f.address.number : cnpjData.number,
        complement: f.address.complement.trim() ? f.address.complement : cnpjData.complement,
        neighborhood: f.address.neighborhood.trim() ? f.address.neighborhood : cnpjData.neighborhood,
        city: f.address.city.trim() ? f.address.city : cnpjData.city,
        state: f.address.state.trim() ? f.address.state : cnpjData.state,
      },
    }))
    setCnpjApplied(true)
    setCnpjData(null)
  }

  const cnpjReady = form.personType === 'juridica' && docValidForSubmit(form.doc, 'juridica')

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      icon={icon}
      title={editing ? t('Editar cadastro', 'Edit record') : kind === 'customer' ? t('Novo cliente', 'New customer') : t('Novo fornecedor', 'New supplier')}
      subtitle={editing ? t('Atualize os dados deste cadastro.', 'Update this record.') : isCustomer ? t('Cadastre um cliente.', 'Add a customer.') : t('Cadastre um fornecedor.', 'Add a supplier.')}
      size="form"
    >
      <div className="space-y-5">
        <DraftPrompt
          active={target !== null}
          hasDraft={draft.hasDraft}
          onRestore={() => {
            const saved = draft.restore()
            if (saved) setForm(saved)
          }}
          onDiscard={draft.discard}
        />

        <FormSection title={t('Identificação', 'Identification')} icon={<UserRound size={14} />}>
          <Field label={t('Nome', 'Name')} required>
            <input className={inputCls} value={form.name} onChange={set('name')} placeholder={t('Nome fantasia / nome de exibição', 'Trade / display name')} />
          </Field>
          <div className="flex gap-2" role="group" aria-label={t('Tipo de pessoa', 'Person type')}>
            <button type="button" onClick={() => setPersonType('fisica')} aria-pressed={form.personType === 'fisica'} className={`flex min-h-11 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 ${form.personType === 'fisica' ? 'bg-accent/20 text-accent ring-1 ring-accent/40' : 'border border-line text-muted hover:bg-fill/10 hover:text-ink'}`}>
              {t('Pessoa física', 'Individual')}
            </button>
            <button type="button" onClick={() => setPersonType('juridica')} aria-pressed={form.personType === 'juridica'} className={`flex min-h-11 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 ${form.personType === 'juridica' ? 'bg-accent/20 text-accent ring-1 ring-accent/40' : 'border border-line text-muted hover:bg-fill/10 hover:text-ink'}`}>
              {t('Pessoa jurídica', 'Company')}
            </button>
          </div>
          <Field label={docLabel}>
            <div className="flex gap-2">
              <input className={`${inputCls} ${docInvalid ? 'border-bad/60' : ''}`} inputMode="numeric" value={form.doc} onChange={(e) => setDoc(e.target.value)} placeholder={form.personType === 'fisica' ? '000.000.000-00' : '00.000.000/0000-00'} />
              {cnpjReady ? (
                <Button type="button" variant="ghost" className="shrink-0" onClick={() => void searchCnpj()} disabled={cnpjBusy}>
                  {cnpjBusy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                  {t('Consultar', 'Look up')}
                </Button>
              ) : null}
            </div>
            {docInvalid ? <FormFieldError>{form.personType === 'fisica' ? t('CPF inválido.', 'Invalid CPF.') : t('CNPJ inválido.', 'Invalid CNPJ.')}</FormFieldError> : null}
          </Field>
          {cnpjData ? (
            <div className="rounded-xl border border-sky/30 bg-sky/10 p-3 text-sm">
              <p className="text-xs text-subtle">
                {t('Dados consultados (BrasilAPI). Revise antes de aplicar.', 'Data looked up (BrasilAPI). Review before applying.')}
              </p>
              {cnpjData.legalName ? <p className="mt-1">{t('Razão social', 'Legal name')}: <b>{cnpjData.legalName}</b></p> : null}
              {cnpjData.tradeName ? <p>{t('Nome fantasia', 'Trade name')}: <b>{cnpjData.tradeName}</b></p> : null}
              {cnpjData.street ? <p className="text-xs text-muted">{cnpjData.street}, {cnpjData.number} · {cnpjData.city}/{cnpjData.state}</p> : null}
              <div className="mt-2 flex gap-2">
                <Button small variant="subtle" onClick={applyCnpj}>{t('Aplicar sugestões', 'Apply suggestions')}</Button>
                <Button small variant="ghost" onClick={() => setCnpjData(null)}>{t('Descartar', 'Discard')}</Button>
              </div>
            </div>
          ) : null}
          {cnpjApplied ? <FormHelpText>{t('Sugestões aplicadas aos campos vazios. Revise antes de salvar.', 'Suggestions applied to empty fields. Review before saving.')}</FormHelpText> : null}
        </FormSection>

        <FormSection title={t('Contato', 'Contact')} icon={<Phone size={14} />}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('Telefone principal', 'Main phone')}>
              <input className={inputCls} value={form.phone} onChange={set('phone')} placeholder={t('(00) 00000-0000', '(00) 00000-0000')} />
            </Field>
            <Field label="Email">
              <input className={`${inputCls} ${emailInvalid ? 'border-bad/60' : ''}`} type="email" value={form.email} onChange={set('email')} placeholder="email@empresa.com" />
              {emailInvalid ? <FormFieldError>{t('Email inválido.', 'Invalid email.')}</FormFieldError> : null}
            </Field>
          </div>
        </FormSection>

        <FormSection title={t('Pagamento digital', 'Digital payment')} icon={<Wallet size={14} />}>
          <Field
            label={t('Carteira para USDC (opcional)', 'USDC wallet (optional)')}
            hint={walletOk ? t('Usada como destino padrão nos pagamentos pela tesouraria.', 'Used as the default destination for treasury payments.') : t('Endereço inválido. Use um endereço 0x com 42 caracteres.', 'Invalid address. Use a 42-character 0x address.')}
          >
            <input className={`${inputCls} mono`} value={form.wallet} onChange={set('wallet')} placeholder="0x..." />
          </Field>
          <FormHelpText>{t('Cadastrar uma carteira não autoriza pagamentos: as transferências sempre são confirmadas por você.', 'Adding a wallet does not authorize payments: transfers are always confirmed by you.')}</FormHelpText>
        </FormSection>

        <FormAccordion title={t('Endereço', 'Address')} icon={<MapPin size={14} />}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('CEP', 'Postal code')}>
              <div className="flex gap-2">
                <input className={inputCls} inputMode="numeric" value={form.address.cep} onChange={setAddress('cep')} placeholder="00000-000" />
                <Button type="button" variant="ghost" className="shrink-0" onClick={() => void searchCep()} disabled={cepBusy}>
                  {cepBusy ? <Loader2 size={15} className="animate-spin" /> : <MapPin size={15} />}
                  {t('Buscar', 'Search')}
                </Button>
              </div>
              <FormHelpText>{t('Preenchimento assistido via ViaCEP. Número e complemento são manuais.', 'Assisted fill via ViaCEP. Number and complement are manual.')}</FormHelpText>
            </Field>
            <Field label={t('Logradouro', 'Street')}>
              <input className={inputCls} value={form.address.street} onChange={setAddress('street')} />
            </Field>
            <Field label={t('Número', 'Number')}>
              <input className={inputCls} value={form.address.number} onChange={setAddress('number')} />
            </Field>
            <Field label={t('Complemento', 'Complement')}>
              <input className={inputCls} value={form.address.complement} onChange={setAddress('complement')} />
            </Field>
            <Field label={t('Bairro', 'Neighborhood')}>
              <input className={inputCls} value={form.address.neighborhood} onChange={setAddress('neighborhood')} />
            </Field>
            <Field label={t('Cidade', 'City')}>
              <input className={inputCls} value={form.address.city} onChange={setAddress('city')} />
            </Field>
            <Field label={t('Estado', 'State')}>
              <input className={inputCls} value={form.address.state} onChange={setAddress('state')} />
            </Field>
            <Field label={t('País', 'Country')}>
              <input className={inputCls} value={form.address.country} onChange={setAddress('country')} />
            </Field>
          </div>
        </FormAccordion>

        <FormAccordion title={t('Informações adicionais', 'Additional information')} icon={<ClipboardList size={14} />}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('Razão social', 'Legal name')}>
              <input className={inputCls} value={form.legalName} onChange={set('legalName')} />
            </Field>
            <Field label={t('Código interno', 'Internal code')}>
              <input className={inputCls} value={form.internalCode} onChange={set('internalCode')} />
            </Field>
            <Field label={t('Pessoa de contato', 'Contact person')}>
              <input className={inputCls} value={form.contactPersonName} onChange={set('contactPersonName')} />
            </Field>
            <Field label={t('Cargo do contato', 'Contact role')}>
              <input className={inputCls} value={form.contactPersonRole} onChange={set('contactPersonRole')} />
            </Field>
            <Field label={t('Telefone secundário', 'Secondary phone')}>
              <input className={inputCls} value={form.secondaryPhone} onChange={set('secondaryPhone')} />
            </Field>
            <Field label={t('Condições de pagamento', 'Payment terms')}>
              <input className={inputCls} value={form.paymentTerms} onChange={set('paymentTerms')} placeholder={t('Ex.: 30 dias', 'E.g. 30 days')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('Observações internas', 'Internal notes')}>
                <textarea className={`${inputCls} min-h-20 resize-y py-2.5`} value={form.notes} onChange={set('notes')} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <span className="label mb-1.5 block">{t('Status', 'Status')}</span>
              <div className="flex gap-2" role="group" aria-label={t('Status', 'Status')}>
                <button type="button" onClick={() => setForm((f) => ({ ...f, active: true }))} aria-pressed={form.active} className={`flex min-h-10 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 ${form.active ? 'bg-ok/20 text-ok ring-1 ring-ok/40' : 'border border-line text-muted hover:bg-fill/10 hover:text-ink'}`}>
                  {t('Ativo', 'Active')}
                </button>
                <button type="button" onClick={() => setForm((f) => ({ ...f, active: false }))} aria-pressed={!form.active} className={`flex min-h-10 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 ${!form.active ? 'bg-bad/20 text-bad ring-1 ring-bad/40' : 'border border-line text-muted hover:bg-fill/10 hover:text-ink'}`}>
                  {t('Inativo', 'Inactive')}
                </button>
              </div>
            </div>
          </div>
        </FormAccordion>

        {dup.exact.length > 0 ? (
          <div className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad" role="alert">
            {t('Já existe um cadastro com este documento/código neste ambiente.', 'A record with this document/code already exists in this environment.')}
          </div>
        ) : dup.possible.length > 0 ? (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn" role="status">
            {t('Possível duplicidade por nome ou email. Revise antes de salvar.', 'Possible duplicate by name or email. Review before saving.')}
          </div>
        ) : null}

        <FormFooter
          left={<EnvironmentBadge />}
          onCancel={onClose}
          submitDisabled={!form.name.trim() || !walletOk || !docValidForSubmit(form.doc, form.personType) || emailInvalid}
          onSubmit={() => {
            const payload = { ...form, name: form.name.trim(), wallet: form.wallet.trim(), email: form.email.trim() }
            const res = editing ? updateContact(editing.id, payload) : addContact({ ...payload, kind })
            if (res.ok) {
              draft.clear()
              onClose()
              toast.success(editing ? t('Cadastro atualizado.', 'Record updated.') : t('Cadastro criado.', 'Record created.'))
            } else {
              toast.error(res.message)
            }
          }}
        />
      </div>
    </Modal>
  )
}

export function Contacts({ kind }: { kind: Kind }) {
  const { data, removeContact } = useStore()
  const network = useNetwork()
  const [target, setTarget] = useState<Contact | 'new' | null>(null)
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(30)
  const isCustomer = kind === 'customer'
  const all = contactsForEnvironment(data, network).filter((c) => c.kind === kind)

  const volume = (c: Contact) => (isCustomer ? salesForEnvironment(data, network).filter((s) => s.customerId === c.id && !s.canceledAt).reduce((s, x) => s + x.total, 0) : 0)
  const open = (c: Contact) =>
    accountsForEnvironment(data.accounts, network).filter((a) => a.contactId === c.id && a.status === 'open' && a.kind === (isCustomer ? 'receivable' : 'payable')).reduce((s, a) => s + a.amount, 0)

  const s = q.trim().toLowerCase()
  const list = all.filter((c) => !s || c.name.toLowerCase().includes(s) || c.doc.toLowerCase().includes(s) || c.email.toLowerCase().includes(s))
  const shown = list.slice(0, limit)

  const balances = all.map((c) => ({ c, v: open(c) }))
  const totalOpen = balances.reduce((sum, b) => sum + b.v, 0)
  const withOpen = balances.filter((b) => b.v > 0).length
  const top = balances.reduce<{ c: Contact; v: number } | null>((best, b) => (b.v > 0 && (!best || b.v > best.v) ? b : best), null)
  const totalSold = isCustomer ? all.reduce((sum, c) => sum + volume(c), 0) : 0
  const withWallet = all.filter((c) => c.wallet).length
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  const copyWallet = (w: string) => {
    void navigator.clipboard.writeText(w).then(
      () => toast.success(t('Endereço copiado.', 'Address copied.')),
      () => toast.error(t('Não foi possível copiar.', 'Could not copy.')),
    )
  }
  const iconBtn = 'flex size-9 items-center justify-center rounded-lg hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60'
  const actions = (c: Contact) => (
    <div className="flex justify-end gap-1">
      <button aria-label={t('Editar', 'Edit')} onClick={() => setTarget(c)} className={`${iconBtn} text-muted`}>
        <Pencil size={15} />
      </button>
      <button aria-label={t('Remover', 'Remove')} onClick={() => removeContact(c.id)} className={`${iconBtn} text-bad hover:!bg-bad/10`}>
        <Trash2 size={15} />
      </button>
    </div>
  )
  const avatar = (c: Contact) => (
    <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isCustomer ? 'bg-sky/15 text-sky' : 'bg-violet/15 text-violet'}`} aria-hidden>
      {c.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
  const walletCell = (c: Contact) =>
    c.wallet ? (
      <span className="inline-flex items-center gap-1.5">
        <span className="mono text-xs">{shortAddr(c.wallet)}</span>
        <button aria-label={t('Copiar endereço', 'Copy address')} title={t('Copiar endereço', 'Copy address')} onClick={() => copyWallet(c.wallet)} className="flex size-7 items-center justify-center rounded-md text-subtle hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60">
          <Copy size={13} />
        </button>
      </span>
    ) : (
      <span className="text-xs text-subtle">{t('não informada', 'not provided')}</span>
    )

  const title = isCustomer ? t('Clientes', 'Customers') : t('Fornecedores', 'Suppliers')
  const newLabel = isCustomer ? t('Novo cliente', 'New customer') : t('Novo fornecedor', 'New supplier')
  const noun = (n: number) => (isCustomer ? (n === 1 ? t('cliente', 'customer') : t('clientes', 'customers')) : n === 1 ? t('fornecedor', 'supplier') : t('fornecedores', 'suppliers'))

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title={title}
        subtitle={isCustomer ? t('Cadastro de clientes e saldo a receber de cada um.', 'Customer records and what each one owes you.') : t('Cadastro de fornecedores, com a carteira usada para pagamentos em USDC.', 'Supplier records, with the wallet used for USDC payments.')}
        actions={
          <Button onClick={() => setTarget('new')}>
            <Plus size={16} /> {newLabel}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="sky" icon={isCustomer ? <Users size={20} /> : <Truck size={20} />} label={title} value={String(all.length)} sub={all.length ? t('cadastrados', 'registered') : t('Nenhum cadastrado', 'None registered')} />
        {isCustomer ? (
          <KpiTile tone="ok" icon={<TrendingUp size={20} />} label={t('Total vendido', 'Total sold')} value={money(totalSold)} sub={t('vendas não canceladas', 'excluding canceled sales')} />
        ) : (
          <KpiTile tone="violet" icon={<Wallet size={20} />} label={t('Com carteira USDC', 'With USDC wallet')} value={`${withWallet}/${all.length}`} sub={withWallet < all.length ? t('Cadastre as carteiras que faltam', 'Add the missing wallets') : all.length ? t('Prontos para pagar em USDC', 'Ready for USDC payments') : '—'} />
        )}
        <KpiTile tone="warn" icon={<Receipt size={20} />} label={isCustomer ? t('A receber', 'Receivable') : t('A pagar', 'Payable')} value={money(totalOpen)} sub={count(withOpen, t('com saldo em aberto', 'with an open balance'), t('com saldo em aberto', 'with an open balance'))} />
        <KpiTile
          tone="bad"
          icon={<AlertTriangle size={20} />}
          label={isCustomer ? t('Maior saldo a receber', 'Largest receivable') : t('Maior saldo a pagar', 'Largest payable')}
          value={top ? money(top.v) : money(0)}
          sub={top ? <span className="block max-w-full truncate">{top.c.name}</span> : t('Nenhum saldo em aberto', 'No open balances')}
        />
      </div>

      <TCard className="overflow-hidden">
        <div className="border-b border-line p-4 sm:px-5">
          <PanelTitle icon={isCustomer ? <Users size={18} /> : <Truck size={18} />} title={t('Cadastros', 'Records')} subtitle={`${list.length} ${noun(list.length)}`} />
        </div>
        <div className="flex items-center gap-2 border-b border-line px-4 focus-within:bg-fill/5 sm:px-5">
          <Search size={16} className="text-subtle" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setLimit(30)
            }}
            placeholder={t('Buscar por nome, documento ou email', 'Search by name, tax ID or email')}
            aria-label={t('Buscar cadastros', 'Search records')}
            className="min-h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
        </div>

        {list.length === 0 ? (
          <Empty
            icon={isCustomer ? <Users size={22} /> : <Truck size={22} />}
            title={all.length ? t('Nada encontrado', 'Nothing found') : isCustomer ? t('Nenhum cliente cadastrado', 'No customers yet') : t('Nenhum fornecedor cadastrado', 'No suppliers yet')}
            action={
              all.length === 0 ? (
                <Button onClick={() => setTarget('new')}>
                  <Plus size={16} /> {t('Cadastrar', 'Add')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>{t('Nome', 'Name')}</th>
                    <th className={th}>{t('Contato', 'Contact')}</th>
                    {!isCustomer ? <th className={th}>{t('Carteira USDC', 'USDC wallet')}</th> : null}
                    {isCustomer ? <th className={`${th} text-right`}>{t('Total vendido', 'Total sold')}</th> : null}
                    <th className={`${th} text-right`}>{isCustomer ? t('A receber', 'Receivable') : t('A pagar', 'Payable')}</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id} className="transition hover:bg-fill/5">
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          {avatar(c)}
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{c.name}</div>
                            <div className="text-xs text-subtle">{c.doc || t('sem documento', 'no tax ID')}</div>
                          </div>
                        </div>
                      </td>
                      <td className={td}>
                        <div>{c.email || '-'}</div>
                        <div className="text-xs text-subtle">{c.phone}</div>
                      </td>
                      {!isCustomer ? <td className={td}>{walletCell(c)}</td> : null}
                      {isCustomer ? <td className={`${td} num text-right`}>{money(volume(c))}</td> : null}
                      <td className={`${td} num text-right font-semibold ${open(c) > 0 ? (isCustomer ? 'text-ok' : 'text-bad') : 'text-subtle'}`}>{money(open(c))}</td>
                      <td className={`${td} text-right`}>{actions(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {shown.map((c) => (
                <li key={c.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {avatar(c)}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{c.name}</p>
                        <p className="truncate text-xs text-subtle">{c.doc || t('sem documento', 'no tax ID')}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] text-subtle">{isCustomer ? t('A receber', 'Receivable') : t('A pagar', 'Payable')}</p>
                      <p className={`num text-sm font-semibold ${open(c) > 0 ? (isCustomer ? 'text-ok' : 'text-bad') : 'text-subtle'}`}>{money(open(c))}</p>
                    </div>
                  </div>
                  {c.email || c.phone ? (
                    <p className="truncate text-xs text-muted">
                      {[c.email, c.phone].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    {isCustomer ? <span className="num text-xs text-subtle">{t('Total vendido', 'Total sold')}: {money(volume(c))}</span> : walletCell(c)}
                    {actions(c)}
                  </div>
                </li>
              ))}
            </ul>

            {list.length > shown.length ? (
              <div className="border-t border-line p-3 text-center">
                <Button variant="ghost" small onClick={() => setLimit((l) => l + 30)}>
                  {t('Ver mais', 'View more')} ({list.length - shown.length})
                </Button>
              </div>
            ) : null}
          </>
        )}
      </TCard>

      <ContactModal kind={kind} target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
