import { useState } from 'react'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, Clock, Coins, HandCoins, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty, Field, Modal, TableWrap, inputCls, td, th } from '@/components/ui'
import { DateField } from '@/components/DateField'
import { isValidIso } from '@/lib/dates'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { useStore } from '@/lib/store'
import { useNav } from '@/lib/nav'
import { accountIsPartial, accountOutstanding, accountPaidAmount, accountTotals } from '@/lib/selectors'
import { addDays, fmtDate, daysUntil, money, parseNum, today } from '@/lib/format'
import { cat, t } from '@/lib/i18n'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type Account } from '@/lib/types'

function AccountModal({ target, onClose }: { target: Account | 'new' | null; onClose: () => void }) {
  const { data, addAccount, updateAccount } = useStore()
  const editing = target && target !== 'new' ? target : null
  const [loaded, setLoaded] = useState<string | null>(null)
  const [kind, setKind] = useState<Account['kind']>('payable')
  const [description, setDescription] = useState('')
  const [contactId, setContactId] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState(addDays(today(), 15))
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[2])
  const value = parseNum(amount)
  const contacts = data.contacts.filter((c) => c.kind === (kind === 'payable' ? 'supplier' : 'customer'))
  const cats: readonly string[] = kind === 'payable' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES

  const key = target === null ? null : editing ? editing.id : 'new'
  if (key !== loaded) {
    setLoaded(key)
    setKind(editing?.kind ?? 'payable')
    setDescription(editing?.description ?? '')
    setContactId(editing?.contactId ?? '')
    setAmount(editing ? String(editing.amount) : '')
    setDueDate(editing?.dueDate ?? addDays(today(), 15))
    setCategory(editing?.category ?? EXPENSE_CATEGORIES[2])
  }

  const pick = (k: Account['kind']) => {
    setKind(k)
    setContactId('')
    setCategory((k === 'payable' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES)[0])
  }

  return (
    <Modal open={target !== null} onClose={onClose} title={editing ? t('Editar conta', 'Edit bill') : t('Nova conta', 'New bill')}>
      <div className="space-y-3">
        {!editing ? (
          <div className="flex gap-2">
            <button onClick={() => pick('payable')} className={`min-h-10 flex-1 rounded-xl text-sm font-semibold ${kind === 'payable' ? 'bg-bad/20 text-bad' : 'border border-line text-muted'}`}>
              {t('A pagar', 'Payable')}
            </button>
            <button onClick={() => pick('receivable')} className={`min-h-10 flex-1 rounded-xl text-sm font-semibold ${kind === 'receivable' ? 'bg-ok/20 text-ok' : 'border border-line text-muted'}`}>
              {t('A receber', 'Receivable')}
            </button>
          </div>
        ) : null}
        <Field label={t('Descrição', 'Description')}>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={kind === 'payable' ? t('Fornecedor / credor', 'Supplier / creditor') : t('Cliente', 'Customer')}>
          <select className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">{t('Não informado', 'Not specified')}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Categoria', 'Category')}>
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => (
              <option key={c} value={c}>
                {cat(c)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Valor', 'Amount')}>
            <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
          </Field>
          <Field label={t('Vencimento', 'Due date')}>
            <DateField value={dueDate} onChange={setDueDate} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar', 'Cancel')}
          </Button>
          <Button
            disabled={!(value > 0) || !description.trim() || !isValidIso(dueDate)}
            onClick={() => {
              const c = data.contacts.find((x) => x.id === contactId)
              const payload = { description: description.trim(), contactId: c?.id, contactName: c?.name ?? t('Não informado', 'Not specified'), amount: value, dueDate, category }
              if (editing) updateAccount(editing.id, payload)
              else addAccount({ kind, ...payload })
              onClose()
            }}
          >
            {t('Salvar', 'Save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function PartialPaymentModal({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { settleAccountPartial } = useStore()
  const [amount, setAmount] = useState('')
  const [loaded, setLoaded] = useState<string | null>(null)
  const value = parseNum(amount)
  const outstanding = account ? accountOutstanding(account) : 0
  if (loaded !== (account?.id ?? null)) {
    setLoaded(account?.id ?? null)
    setAmount('')
  }
  const over = value > outstanding
  const submit = () => {
    if (!account || !(value > 0) || over) return
    settleAccountPartial(account.id, value)
    toast.success(account.kind === 'payable' ? t('Pagamento parcial registrado.', 'Partial payment recorded.') : t('Recebimento parcial registrado.', 'Partial receipt recorded.'))
    onClose()
  }
  return (
    <Modal open={account !== null} onClose={onClose} title={account?.kind === 'payable' ? t('Pagar parcialmente', 'Partial payment') : t('Receber parcialmente', 'Partial receipt')}>
      {account ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-fill/5 p-3 text-sm">
            <div className="font-semibold">{account.description}</div>
            <div className="num mt-1 text-xs text-subtle">
              {t('Saldo em aberto', 'Outstanding')}: {money(outstanding)} {accountIsPartial(account) ? `· ${t('já pago', 'already paid')} ${money(accountPaidAmount(account))}` : ''}
            </div>
          </div>
          <Field label={t('Valor', 'Amount')} hint={over ? t('Valor acima do saldo em aberto.', 'Amount exceeds the outstanding balance.') : undefined}>
            <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>{t('Cancelar', 'Cancel')}</Button>
            <Button disabled={!(value > 0) || over} onClick={submit}>{t('Registrar', 'Record')}</Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

type Tab = 'open' | 'payable' | 'receivable' | 'paid'

export function Finance() {
  const { data, settleAccount, removeAccount } = useStore()
  const { requestPay, requestIntent } = useNav()
  const [tab, setTab] = useState<Tab>('open')
  const [target, setTarget] = useState<Account | 'new' | null>(null)
  const [partial, setPartial] = useState<Account | null>(null)
  const [limit, setLimit] = useState(30)
  const totals = accountTotals(data)

  const openAll = data.accounts.filter((a) => a.status === 'open' && !a.canceledAt)
  const openReceivable = openAll.filter((a) => a.kind === 'receivable')
  const openPayable = openAll.filter((a) => a.kind === 'payable')
  const overdue = (kind: Account['kind']) => openAll.filter((a) => a.kind === kind && daysUntil(a.dueDate) < 0).length
  const plural = (n: number) => (n === 1 ? t('conta', 'bill') : t('contas', 'bills'))

  const list = data.accounts
    .filter((a) => (tab === 'open' ? a.status === 'open' && !a.canceledAt : tab === 'paid' ? a.status === 'paid' : a.kind === tab && a.status === 'open' && !a.canceledAt))
    .sort((a, b) => (tab === 'paid' ? (b.paidAt ?? '').localeCompare(a.paidAt ?? '') : a.dueDate.localeCompare(b.dueDate)))
  const shown = list.slice(0, limit)

  const pickTab = (v: Tab) => {
    setTab(v)
    setLimit(30)
  }

  const statusBadge = (a: Account) => {
    const d = daysUntil(a.dueDate)
    if (a.status === 'paid') {
      return (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone="ok">{a.kind === 'payable' ? t('Paga', 'Paid') : t('Recebida', 'Received')}</Badge>
          {a.treasuryTx ? (
            <a className="text-xs text-accent hover:underline" href={a.treasuryTx} target="_blank" rel="noopener noreferrer">
              {t('tx USDC', 'USDC tx')}
            </a>
          ) : null}
        </span>
      )
    }
    if (accountIsPartial(a)) {
      return (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone="warn">{t('Parcial', 'Partial')}</Badge>
          <span className="num text-xs text-subtle">{money(accountPaidAmount(a))} / {money(a.amount)}</span>
        </span>
      )
    }
    if (d < 0) return <Badge tone="bad">{t(`${-d} dia(s) em atraso`, `${-d} day(s) overdue`)}</Badge>
    if (d <= 7) return <Badge tone="warn">{d === 0 ? t('Vence hoje', 'Due today') : t(`Vence em ${d} dia(s)`, `Due in ${d} day(s)`)}</Badge>
    return <Badge>{t('Em dia', 'On time')}</Badge>
  }

  const rowActions = (a: Account) => (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {a.status === 'open' && a.kind === 'receivable' ? (
        <Button small variant="subtle" onClick={() => requestIntent({ kind: 'charge', accountId: a.id })}>
          <HandCoins size={14} /> {t('Cobrar em USDC', 'Charge in USDC')}
        </Button>
      ) : null}
      {a.status === 'open' && a.kind === 'payable' ? (
        <Button small variant="subtle" onClick={() => requestPay(a.id)}>
          <Coins size={14} /> {t('Pagar em USDC', 'Pay in USDC')}
        </Button>
      ) : null}
      {a.status === 'open' ? (
        <Button
          small
          variant="ghost"
          onClick={() => {
            settleAccount(a.id)
            toast.success(a.kind === 'payable' ? t('Pagamento registrado no caixa.', 'Payment recorded in cash.') : t('Recebimento registrado no caixa.', 'Receipt recorded in cash.'))
          }}
        >
          <Check size={14} /> {a.kind === 'payable' ? t('Paguei', 'Mark paid') : t('Recebi', 'Mark received')}
        </Button>
      ) : null}
      {a.status === 'open' ? (
        <Button small variant="ghost" onClick={() => setPartial(a)}>
          {t('Parcial', 'Partial')}
        </Button>
      ) : null}
      {a.status === 'open' ? (
        <button
          aria-label={t('Editar conta', 'Edit bill')}
          onClick={() => setTarget(a)}
          className="flex size-9 items-center justify-center rounded-lg text-subtle hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
        >
          <Pencil size={15} />
        </button>
      ) : null}
      <button
        aria-label={t('Remover conta', 'Remove bill')}
        onClick={() => removeAccount(a.id)}
        className="flex size-9 items-center justify-center rounded-lg text-subtle hover:bg-fill/10 hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )

  const countOf = (v: Tab) =>
    v === 'open' ? openAll.length : v === 'paid' ? data.accounts.length - openAll.length : v === 'payable' ? openPayable.length : openReceivable.length

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title={t('Contas a pagar e receber', 'Payables and receivables')}
        subtitle={t('Direitos de recebimento e obrigações de pagamento. Pague fornecedores e salários em USDC pela tesouraria.', 'Money owed to you and obligations to pay. Pay suppliers and salaries in USDC through the treasury.')}
        actions={
          <Button onClick={() => setTarget('new')}>
            <Plus size={16} /> {t('Nova conta', 'New bill')}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="ok" icon={<ArrowDownLeft size={20} />} label={t('A receber', 'Receivable')} value={money(totals.receivable)} sub={`${openReceivable.length} ${plural(openReceivable.length)} ${t('em aberto', 'open')}`} />
        <KpiTile tone="bad" icon={<ArrowUpRight size={20} />} label={t('A pagar', 'Payable')} value={money(totals.payable)} sub={`${openPayable.length} ${plural(openPayable.length)} ${t('em aberto', 'open')}`} />
        <KpiTile
          tone="warn"
          icon={<Clock size={20} />}
          label={t('Recebimentos em atraso', 'Overdue receivables')}
          value={money(totals.overdueReceivable)}
          valueTone={totals.overdueReceivable ? 'bad' : undefined}
          sub={overdue('receivable') ? `${overdue('receivable')} ${plural(overdue('receivable'))}` : t('Nenhum em atraso', 'None overdue')}
        />
        <KpiTile
          tone="violet"
          icon={<AlertTriangle size={20} />}
          label={t('Pagamentos em atraso', 'Overdue payables')}
          value={money(totals.overduePayable)}
          valueTone={totals.overduePayable ? 'bad' : undefined}
          sub={overdue('payable') ? `${overdue('payable')} ${plural(overdue('payable'))}` : t('Nenhum em atraso', 'None overdue')}
        />
      </div>

      <TCard className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:px-5">
          <PanelTitle
            icon={<Receipt size={18} />}
            title={t('Contas', 'Bills')}
            subtitle={`${list.length} ${plural(list.length)}`}
          />
          <PillTabs
            label={t('Situação', 'Status')}
            value={tab}
            onChange={pickTab}
            items={[
              { id: 'open', label: `${t('Em aberto', 'Open')} (${countOf('open')})` },
              { id: 'payable', label: `${t('A pagar', 'Payable')} (${countOf('payable')})` },
              { id: 'receivable', label: `${t('A receber', 'Receivable')} (${countOf('receivable')})` },
              { id: 'paid', label: `${t('Liquidadas', 'Settled')} (${countOf('paid')})` },
            ]}
          />
        </div>

        {list.length === 0 ? (
          <Empty icon={<Receipt size={22} />} title={t('Nenhuma conta aqui', 'No bills here')} text={t('Compras a prazo, vendas a prazo e folha de pagamento geram contas automaticamente.', 'Credit purchases, credit sales and payroll create bills automatically.')} />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>{t('Vencimento', 'Due date')}</th>
                    <th className={th}>{t('Descrição', 'Description')}</th>
                    <th className={th}>{t('Situação', 'Status')}</th>
                    <th className={`${th} text-right`}>{t('Valor', 'Amount')}</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id} className="transition hover:bg-fill/5">
                      <td className={td}>{fmtDate(a.dueDate)}</td>
                      <td className={`${td} max-w-[260px]`}>
                        <div className="truncate">{a.description}</div>
                        <div className="truncate text-xs text-subtle">{a.contactName}</div>
                      </td>
                      <td className={td}>{statusBadge(a)}</td>
                      <td className={`${td} num text-right font-semibold ${a.kind === 'payable' ? 'text-bad' : 'text-ok'}`}>
                        {money(accountOutstanding(a))}
                        {accountIsPartial(a) ? <div className="text-[11px] font-normal text-subtle">{t('de', 'of')} {money(a.amount)}</div> : null}
                      </td>
                      <td className={`${td} text-right`}>{rowActions(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {shown.map((a) => (
                <li key={a.id} className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{a.description}</p>
                      <p className="truncate text-xs text-subtle">
                        {a.contactName} · {fmtDate(a.dueDate)}
                      </p>
                    </div>
                    <div className={`num shrink-0 whitespace-nowrap text-sm font-semibold ${a.kind === 'payable' ? 'text-bad' : 'text-ok'}`}>
                      {money(accountOutstanding(a))}
                      {accountIsPartial(a) ? <div className="text-[11px] font-normal text-subtle">{t('de', 'of')} {money(a.amount)}</div> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {statusBadge(a)}
                    {rowActions(a)}
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

      <AccountModal target={target} onClose={() => setTarget(null)} />
      <PartialPaymentModal account={partial} onClose={() => setPartial(null)} />
    </div>
  )
}
