import { useState } from 'react'
import { ArrowLeft, ClipboardList, Copy, Eye, Info, MapPin, Pencil, Plus, Receipt, ShoppingBag, ShoppingCart, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty } from '@/components/ui'
import { TCard, PanelTitle } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { useStore } from '@/lib/store'
import { useNav } from '@/lib/nav'
import { useNetwork } from '@/lib/network'
import { accountIsPartial, accountOutstanding, accountsForEnvironment, contactsForEnvironment, purchasesForEnvironment, salesForEnvironment } from '@/lib/selectors'
import { groupMoneyByCurrency, formatMoneyGroup, formatValue } from '@/lib/profile-money'
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
  const settled = a.status === 'paid'
  const partial = accountIsPartial(a)
  const outstanding = accountOutstanding(a)
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{a.description}</p>
        <p className="text-xs text-subtle">{t('Vencimento', 'Due date')}: {fmtDate(a.dueDate)}</p>
        {partial ? <p className="text-xs text-subtle">{t('Saldo pendente', 'Outstanding')}: {formatValue(outstanding, a.currency)}</p> : null}
      </div>
      <div className="shrink-0 text-right">
        <p className={`num text-sm font-semibold ${settled ? 'text-subtle' : kind === 'customer' ? 'text-ok' : 'text-bad'}`}>{formatValue(a.amount, a.currency)}</p>
        {settled ? (
          <Badge tone="neutral">{t('Liquidada', 'Settled')}</Badge>
        ) : partial ? (
          <Badge tone="warn">{t('Parcial', 'Partial')}</Badge>
        ) : (
          <Badge tone={kind === 'customer' ? 'ok' : 'warn'}>{t('Em aberto', 'Open')}</Badge>
        )}
      </div>
    </li>
  )
}

export function ContactProfile({ contactId, kind, onBack, onEdit }: { contactId: string; kind: Contact['kind']; onBack: () => void; onEdit: (c: Contact) => void }) {
  const { data } = useStore()
  const { openProfileIntent } = useNav()
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
  const accounts = accountsForEnvironment(data.accounts, network).filter((a) => a.contactId === contact.id && !a.canceledAt)
  const receivables = accounts.filter((a) => a.kind === 'receivable')
  const payables = accounts.filter((a) => a.kind === 'payable')
  const sales = salesForEnvironment(data, network).filter((s) => s.customerId === contact.id)
  const purchases = purchasesForEnvironment(data, network).filter((p) => p.supplierId === contact.id)
  const liveSales = sales.filter((s) => !s.canceledAt)
  const totalSold = liveSales.reduce((s, x) => s + x.total, 0)
  const totalPurchased = purchases.reduce((s, p) => s + p.total, 0)

  // Valores em aberto agrupados por moeda real (nunca somando moedas diferentes).
  const openReceivableGroups = groupMoneyByCurrency(receivables.filter((a) => a.status === 'open').map((a) => ({ amount: accountOutstanding(a), currency: a.currency })))
  const openPayableGroups = groupMoneyByCurrency(payables.filter((a) => a.status === 'open').map((a) => ({ amount: accountOutstanding(a), currency: a.currency })))

  // Histórico cronológico por datas com significado correto (venda/compra/liquidação).
  const timeline = [
    ...sales.map((s) => ({ id: `sale-${s.id}`, date: s.date, type: t('Venda', 'Sale'), desc: s.customerName || t('Venda', 'Sale'), amount: s.total, currency: undefined, isAppCurrency: true, canceled: !!s.canceledAt })),
    ...purchases.map((p) => ({ id: `pur-${p.id}`, date: p.date, type: t('Compra', 'Purchase'), desc: p.supplierName, amount: p.total, currency: undefined, isAppCurrency: true, canceled: false })),
    ...accounts.flatMap((a) => (a.settlements ?? []).map((st) => ({ id: `st-${st.id}`, date: st.date, type: t('Liquidação', 'Settlement'), desc: a.description, amount: st.amount, currency: a.currency, isAppCurrency: false, canceled: false }))),
  ].sort((a, b) => b.date.localeCompare(a.date))

  // Atividade recente (até 5 registros reais por ID).
  const recent = (isCustomer ? liveSales.map((s) => ({ id: `s-${s.id}`, date: s.date, type: t('Venda', 'Sale'), desc: s.customerName, amount: s.total, currency: undefined, tone: 'ok' as const })) : purchases.map((p) => ({ id: `p-${p.id}`, date: p.date, type: t('Compra', 'Purchase'), desc: p.supplierName, amount: p.total, currency: undefined, tone: 'violet' as const })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)

  const personTypeLabel = contact.personType === 'juridica' ? t('Pessoa jurídica', 'Company') : t('Pessoa física', 'Individual')
  const fullAddress = [contact.address?.street, contact.address?.number, contact.address?.city, contact.address?.state].filter(Boolean).join(', ')

  const copyWallet = () => {
    void navigator.clipboard.writeText(contact.wallet).then(
      () => toast.success(t('Endereço copiado.', 'Address copied.')),
      () => toast.error(t('Não foi possível copiar.', 'Could not copy.')),
    )
  }

  const tabs = [
    { id: 'overview' as const, label: t('Visão geral', 'Overview') },
    { id: 'finance' as const, label: t('Financeiro', 'Financial') },
    { id: 'history' as const, label: t('Histórico', 'History') },
    { id: 'info' as const, label: t('Informações', 'Information') },
  ]

  const summaryGroups = isCustomer ? openReceivableGroups : openPayableGroups

  // Ações rápidas: entradas para os fluxos existentes dos módulos, transportando apenas o ID estável.
  const quickActions = isCustomer
    ? [
        { key: 'sale', icon: <ShoppingCart size={15} />, label: t('Nova venda', 'New sale'), run: () => openProfileIntent({ kind: 'sale', customerId: contact.id }) },
        { key: 'receivable', icon: <Plus size={15} />, label: t('Nova conta a receber', 'New receivable'), run: () => openProfileIntent({ kind: 'account', accountKind: 'receivable', contactId: contact.id, contactName: contact.name }) },
        { key: 'sales', icon: <Eye size={15} />, label: t('Ver vendas', 'View sales'), run: () => openProfileIntent({ kind: 'sales', customerId: contact.id, customerName: contact.name }) },
        { key: 'accounts', icon: <ClipboardList size={15} />, label: t('Ver contas', 'View bills'), run: () => openProfileIntent({ kind: 'accounts', contactId: contact.id, label: contact.name }) },
      ]
    : [
        { key: 'purchase', icon: <ShoppingBag size={15} />, label: t('Nova compra', 'New purchase'), run: () => openProfileIntent({ kind: 'purchase', supplierId: contact.id }) },
        { key: 'payable', icon: <Plus size={15} />, label: t('Nova conta a pagar', 'New payable'), run: () => openProfileIntent({ kind: 'account', accountKind: 'payable', contactId: contact.id, contactName: contact.name }) },
        { key: 'purchases', icon: <Eye size={15} />, label: t('Ver compras', 'View purchases'), run: () => openProfileIntent({ kind: 'purchases', supplierId: contact.id, supplierName: contact.name }) },
        { key: 'accounts', icon: <ClipboardList size={15} />, label: t('Ver contas', 'View bills'), run: () => openProfileIntent({ kind: 'accounts', contactId: contact.id, label: contact.name }) },
      ]

  return (
    <div className="space-y-4">
      {/* Cabeçalho compacto */}
      <TCard className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold ${isCustomer ? 'bg-sky/15 text-sky' : 'bg-violet/15 text-violet'}`} aria-hidden>
            {contact.name.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="display truncate text-lg font-semibold">{contact.legalName || contact.name}</h2>
              {contact.active === false ? <Badge tone="neutral">{t('Inativo', 'Inactive')}</Badge> : <Badge tone="ok">{t('Ativo', 'Active')}</Badge>}
            </div>
            <p className="mt-0.5 truncate text-sm text-muted">
              {personTypeLabel}
              {contact.doc ? ` · ${contact.doc}` : ''}
              {contact.internalCode ? ` · ${contact.internalCode}` : ''}
            </p>
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

      {/* Ações rápidas */}
      <TCard className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-subtle">{t('Ações rápidas', 'Quick actions')}</span>
          {quickActions.map((a) => (
            <Button key={a.key} small variant="subtle" onClick={a.run}>
              {a.icon} {a.label}
            </Button>
          ))}
        </div>
      </TCard>

      <PillTabs label={t('Seções do perfil', 'Profile sections')} value={tab} onChange={setTab} items={tabs} />

      {tab === 'overview' ? (
        <div className="space-y-4">
          {/* Resumo em indicadores */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            <TCard className="p-3.5 sm:p-4">
              <div className="text-xs font-semibold text-muted">{isCustomer ? t('Total vendido', 'Total sold') : t('Total comprado', 'Total purchased')}</div>
              <div className="display num mt-1 text-lg font-semibold sm:text-xl">{money(isCustomer ? totalSold : totalPurchased)}</div>
            </TCard>
            <TCard className="p-3.5 sm:p-4">
              <div className="text-xs font-semibold text-muted">{isCustomer ? t('Em aberto (a receber)', 'Open (receivable)') : t('Em aberto (a pagar)', 'Open (payable)')}</div>
              {summaryGroups.length === 0 ? (
                <div className="num mt-1 text-lg font-semibold text-subtle">{money(0)}</div>
              ) : summaryGroups.length === 1 ? (
                <div className={`display num mt-1 text-lg font-semibold sm:text-xl ${isCustomer ? 'text-ok' : 'text-bad'}`}>{formatMoneyGroup(summaryGroups[0])}</div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {summaryGroups.map((g) => (
                    <div key={g.code} className={`num text-sm font-semibold ${isCustomer ? 'text-ok' : 'text-bad'}`}>{formatMoneyGroup(g)}</div>
                  ))}
                </div>
              )}
            </TCard>
            <TCard className="p-3.5 sm:p-4">
              <div className="text-xs font-semibold text-muted">{isCustomer ? t('Vendas', 'Sales') : t('Compras', 'Purchases')}</div>
              <div className="display num mt-1 text-lg font-semibold sm:text-xl">{isCustomer ? liveSales.length : purchases.length}</div>
            </TCard>
            <TCard className="p-3.5 sm:p-4">
              <div className="text-xs font-semibold text-muted">{isCustomer ? t('Contas a receber', 'Receivables') : t('Contas a pagar', 'Payables')}</div>
              <div className="display num mt-1 text-lg font-semibold sm:text-xl">{(isCustomer ? receivables : payables).filter((a) => a.status === 'open').length}</div>
            </TCard>
          </div>

          <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-2">
            {/* Dados cadastrais */}
            <TCard className="p-4 sm:p-5">
              <PanelTitle icon={<MapPin size={18} />} title={t('Dados cadastrais', 'Record details')} />
              <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoItem label={t('Nome', 'Name')} value={contact.legalName ? contact.name : undefined} />
                <InfoItem label={t('Razão social', 'Legal name')} value={contact.legalName} />
                <InfoItem label={t('CPF / CNPJ', 'Tax ID')} value={contact.doc} />
                <InfoItem label={t('Código interno', 'Internal code')} value={contact.internalCode} />
                <InfoItem label={t('Endereço', 'Address')} value={fullAddress || contact.address?.country} />
                <InfoItem label={t('Telefone', 'Phone')} value={contact.phone} />
                <InfoItem label={t('Email', 'Email')} value={contact.email} />
                <InfoItem label={t('Pessoa de contato', 'Contact person')} value={contact.contactPersonName ? `${contact.contactPersonName}${contact.contactPersonRole ? ` · ${contact.contactPersonRole}` : ''}` : undefined} />
              </dl>
              {contact.wallet ? (
                <div className="mt-4 rounded-xl bg-fill/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
                      <Wallet size={13} /> {t('Carteira de pagamento', 'Payment wallet')}
                    </span>
                    <Button small variant="ghost" onClick={copyWallet}>
                      <Copy size={13} /> {t('Copiar', 'Copy')}
                    </Button>
                  </div>
                  <span className="mono mt-1 block truncate text-xs">{shortAddr(contact.wallet)}</span>
                </div>
              ) : null}
            </TCard>

            {/* Atividade recente */}
            <TCard className="overflow-hidden">
              <div className="border-b border-line p-4 sm:px-5">
                <PanelTitle icon={<ClipboardList size={18} />} title={t('Atividade recente', 'Recent activity')} />
              </div>
              {recent.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">{t('Nenhuma atividade registrada.', 'No recorded activity.')}</p>
              ) : (
                <ul className="divide-y divide-line px-4 sm:px-5">
                  {recent.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.type}</p>
                        <p className="truncate text-xs text-subtle">{r.desc} · {fmtDate(r.date)}</p>
                      </div>
                      <span className="num shrink-0 text-sm font-semibold">{money(r.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </TCard>
          </div>
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
                    <p className="truncate text-sm font-medium">{ev.type}</p>
                    <p className="truncate text-xs text-subtle">{ev.desc} · {fmtDate(ev.date)}</p>
                  </div>
                  <span className={`num shrink-0 text-sm font-semibold ${ev.canceled ? 'text-subtle' : ''}`}>{ev.isAppCurrency ? money(ev.amount) : formatValue(ev.amount, ev.currency)}</span>
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
            <InfoItem label={t('Condições de pagamento', 'Payment terms')} value={contact.paymentTerms} />
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
