import { useState } from 'react'
import { ArrowLeft, ClipboardList, Info, MapPin, Pencil, Receipt, Wallet } from 'lucide-react'
import { Badge, Button, Empty } from '@/components/ui'
import { TCard, PanelTitle } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { useStore } from '@/lib/store'
import { useNetwork } from '@/lib/network'
import { accountsForEnvironment, contactsForEnvironment, purchasesForEnvironment, salesForEnvironment } from '@/lib/selectors'
import { fmtDate, money, shortAddr } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Contact, Account } from '@/lib/types'

type Tab = 'overview' | 'finance' | 'history' | 'info'

function InfoItem({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{value}</dd>
    </div>
  )
}

function AccountRow({ a, kind }: { a: Account; kind: 'customer' | 'supplier' }) {
  const open = a.status === 'open'
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{a.description}</p>
        <p className="text-xs text-subtle">{t('Vencimento', 'Due date')}: {fmtDate(a.dueDate)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`num text-sm font-semibold ${open ? (kind === 'customer' ? 'text-ok' : 'text-bad') : 'text-subtle'}`}>{money(a.amount)}</p>
        <Badge tone={open ? (kind === 'customer' ? 'ok' : 'warn') : 'neutral'}>{open ? t('Em aberto', 'Open') : t('Liquidada', 'Settled')}</Badge>
      </div>
    </li>
  )
}

export function ContactProfile({ contactId, kind, onBack, onEdit }: { contactId: string; kind: Contact['kind']; onBack: () => void; onEdit: (c: Contact) => void }) {
  const { data } = useStore()
  const network = useNetwork()
  const [tab, setTab] = useState<Tab>('overview')

  const contact = contactsForEnvironment(data, network).find((c) => c.id === contactId && c.kind === kind)
  if (!contact) {
    return (
      <Empty
        icon={<Receipt size={22} />}
        title={t('Cadastro não encontrado', 'Record not found')}
        text={t('O cadastro pode ter sido removido ou pertence a outro ambiente.', 'The record may have been removed or belong to another environment.')}
        action={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} /> {t('Voltar', 'Back')}
          </Button>
        }
      />
    )
  }

  const isCustomer = kind === 'customer'
  const accounts = accountsForEnvironment(data.accounts, network).filter((a) => a.contactId === contact.id)
  const receivables = accounts.filter((a) => a.kind === 'receivable')
  const payables = accounts.filter((a) => a.kind === 'payable')
  const sales = salesForEnvironment(data, network).filter((s) => s.customerId === contact.id)
  const purchases = purchasesForEnvironment(data, network).filter((p) => p.supplierId === contact.id)
  const openReceivable = receivables.filter((a) => a.status === 'open').reduce((s, a) => s + a.amount, 0)
  const openPayable = payables.filter((a) => a.status === 'open').reduce((s, a) => s + a.amount, 0)
  const totalSold = sales.filter((s) => !s.canceledAt).reduce((s, x) => s + x.total, 0)
  const totalPurchased = purchases.reduce((s, p) => s + p.total, 0)

  // Histórico cronológico (sem eventos fictícios): vendas/compras + contas.
  const timeline = [
    ...sales.map((s) => ({ id: `sale-${s.id}`, date: s.date, title: s.customerName || t('Venda', 'Sale'), detail: t('Venda', 'Sale'), amount: s.total, tone: 'ok' as const, canceled: !!s.canceledAt })),
    ...purchases.map((p) => ({ id: `pur-${p.id}`, date: p.date, title: p.supplierName, detail: t('Compra', 'Purchase'), amount: p.total, tone: 'violet' as const, canceled: false })),
    ...accounts.map((a) => ({ id: `acc-${a.id}`, date: a.dueDate, title: a.description, detail: a.kind === 'receivable' ? t('A receber', 'Receivable') : t('A pagar', 'Payable'), amount: a.amount, tone: a.kind === 'receivable' ? 'ok' as const : 'bad' as const, canceled: a.status === 'paid' })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const personTypeLabel = contact.personType === 'juridica' ? t('Pessoa jurídica', 'Company') : t('Pessoa física', 'Individual')
  const fullAddress = [contact.address?.street, contact.address?.number, contact.address?.city, contact.address?.state].filter(Boolean).join(', ')

  const tabs = [
    { id: 'overview' as const, label: t('Visão geral', 'Overview') },
    { id: 'finance' as const, label: t('Financeiro', 'Financial') },
    { id: 'history' as const, label: t('Histórico', 'History') },
    { id: 'info' as const, label: t('Informações', 'Information') },
  ]

  return (
    <div className="space-y-4">
      <TCard className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl text-lg font-semibold ${isCustomer ? 'bg-sky/15 text-sky' : 'bg-violet/15 text-violet'}`} aria-hidden>
              {contact.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="display truncate text-lg font-semibold">{contact.legalName || contact.name}</h2>
                {contact.active === false ? <Badge tone="neutral">{t('Inativo', 'Inactive')}</Badge> : <Badge tone="ok">{t('Ativo', 'Active')}</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {personTypeLabel}
                {contact.doc ? ` · ${contact.doc}` : ''}
                {contact.internalCode ? ` · ${contact.internalCode}` : ''}
              </p>
              <p className="mt-1 text-xs text-subtle">{contact.email || '—'}{contact.phone ? ` · ${contact.phone}` : ''}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" small onClick={onBack}>
              <ArrowLeft size={15} /> {t('Voltar', 'Back')}
            </Button>
            <Button small onClick={() => onEdit(contact)}>
              <Pencil size={15} /> {t('Editar', 'Edit')}
            </Button>
          </div>
        </div>
      </TCard>

      <PillTabs label={t('Seções do perfil', 'Profile sections')} value={tab} onChange={setTab} items={tabs} />

      {tab === 'overview' ? (
        <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-2">
          <TCard className="p-4 sm:p-5">
            <PanelTitle icon={<MapPin size={18} />} title={t('Dados cadastrais', 'Record details')} />
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoItem label={t('Nome', 'Name')} value={contact.name} />
              <InfoItem label={t('Razão social', 'Legal name')} value={contact.legalName} />
              <InfoItem label={isCustomer ? t('Cliente', 'Customer') : t('Fornecedor', 'Supplier')} value={contact.name} />
              <InfoItem label={t('Endereço', 'Address')} value={fullAddress || contact.address?.country} />
              <InfoItem label={t('Telefone', 'Phone')} value={contact.phone} />
              <InfoItem label={t('Email', 'Email')} value={contact.email} />
              <InfoItem label={t('Pessoa de contato', 'Contact person')} value={contact.contactPersonName ? `${contact.contactPersonName}${contact.contactPersonRole ? ` · ${contact.contactPersonRole}` : ''}` : undefined} />
              <InfoItem label={t('Condições de pagamento', 'Payment terms')} value={contact.paymentTerms} />
            </dl>
            {contact.wallet ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-fill/5 px-3 py-2 text-sm">
                <Wallet size={14} className="text-subtle" />
                <span className="mono text-xs">{shortAddr(contact.wallet)}</span>
              </div>
            ) : null}
          </TCard>

          <TCard className="p-4 sm:p-5">
            <PanelTitle icon={<Receipt size={18} />} title={t('Resumo', 'Summary')} />
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{isCustomer ? t('Total vendido', 'Total sold') : t('Total comprado', 'Total purchased')}</dt>
                <dd className="num font-semibold">{money(isCustomer ? totalSold : totalPurchased)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{isCustomer ? t('Em aberto (a receber)', 'Open (receivable)') : t('Em aberto (a pagar)', 'Open (payable)')}</dt>
                <dd className={`num font-semibold ${isCustomer ? 'text-ok' : 'text-bad'}`}>{money(isCustomer ? openReceivable : openPayable)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{isCustomer ? t('Vendas', 'Sales') : t('Compras', 'Purchases')}</dt>
                <dd className="num font-semibold">{isCustomer ? sales.length : purchases.length}</dd>
              </div>
            </dl>
          </TCard>
        </div>
      ) : null}

      {tab === 'finance' ? (
        <TCard className="overflow-hidden">
          <div className="border-b border-line p-4 sm:px-5">
            <PanelTitle icon={<Receipt size={18} />} title={isCustomer ? t('Contas a receber', 'Receivables') : t('Contas a pagar', 'Payables')} subtitle={t('Vinculadas a este cadastro', 'Linked to this record')} />
          </div>
          {(isCustomer ? receivables : payables).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">{t('Nenhuma conta vinculada.', 'No linked bills.')}</p>
          ) : (
            <ul className="divide-y divide-line px-4 sm:px-5">
              {(isCustomer ? receivables : payables).map((a) => (
                <AccountRow key={a.id} a={a} kind={kind} />
              ))}
            </ul>
          )}
        </TCard>
      ) : null}

      {tab === 'history' ? (
        <TCard className="overflow-hidden">
          <div className="border-b border-line p-4 sm:px-5">
            <PanelTitle icon={<ClipboardList size={18} />} title={t('Histórico', 'History')} subtitle={t('Registros existentes, em ordem cronológica', 'Existing records, in chronological order')} />
          </div>
          {timeline.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">{t('Nenhum registro relacionado.', 'No related records.')}</p>
          ) : (
            <ul className="divide-y divide-line px-4 sm:px-5">
              {timeline.map((ev) => (
                <li key={ev.id} className={`flex items-center justify-between gap-3 py-2.5 ${ev.canceled ? 'opacity-60' : ''}`}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{ev.title}</p>
                    <p className="text-xs text-subtle">{ev.detail} · {fmtDate(ev.date)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`num text-sm font-semibold ${ev.canceled ? 'text-subtle' : ''}`}>{money(ev.amount)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TCard>
      ) : null}

      {tab === 'info' ? (
        <TCard className="p-4 sm:p-5">
          <PanelTitle icon={<Info size={18} />} title={t('Informações adicionais', 'Additional information')} />
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoItem label={t('Código interno', 'Internal code')} value={contact.internalCode} />
            <InfoItem label={t('Telefone secundário', 'Secondary phone')} value={contact.secondaryPhone} />
            <InfoItem label={t('Pessoa de contato', 'Contact person')} value={contact.contactPersonName} />
            <InfoItem label={t('Cargo do contato', 'Contact role')} value={contact.contactPersonRole} />
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Observações internas', 'Internal notes')}</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-muted">{contact.notes || t('—', '—')}</dd>
            </div>
          </dl>
        </TCard>
      ) : null}
    </div>
  )
}
