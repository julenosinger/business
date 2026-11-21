import { useState } from 'react'
import { Check, Coins, HandCoins, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Stat, Tabs, TableWrap, inputCls, td, th } from '@/components/ui'
import { useStore } from '@/lib/store'
import { useNav } from '@/lib/nav'
import { accountTotals } from '@/lib/selectors'
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
            <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar', 'Cancel')}
          </Button>
          <Button
            disabled={!(value > 0) || !description.trim()}
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

export function Finance() {
  const { data, settleAccount, removeAccount } = useStore()
  const { requestPay, requestIntent } = useNav()
  const [tab, setTab] = useState<'open' | 'payable' | 'receivable' | 'paid'>('open')
  const [target, setTarget] = useState<Account | 'new' | null>(null)
  const totals = accountTotals(data)

  const list = data.accounts
    .filter((a) => (tab === 'open' ? a.status === 'open' : tab === 'paid' ? a.status === 'paid' : a.kind === tab && a.status === 'open'))
    .sort((a, b) => (tab === 'paid' ? (b.paidAt ?? '').localeCompare(a.paidAt ?? '') : a.dueDate.localeCompare(b.dueDate)))

  return (
    <div>
      <PageHeader
        title={t('Contas a pagar e receber', 'Payables and receivables')}
        subtitle={t('Direitos de recebimento e obrigações de pagamento. Pague fornecedores e salários em USDC pela tesouraria.', 'Money owed to you and obligations to pay. Pay suppliers and salaries in USDC through the treasury.')}
        actions={
          <Button onClick={() => setTarget('new')}>
            <Plus size={16} /> {t('Nova conta', 'New bill')}
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('A receber', 'Receivable')} value={money(totals.receivable)} tone="ok" />
        <Stat label={t('A pagar', 'Payable')} value={money(totals.payable)} tone="bad" />
        <Stat label={t('Recebimentos em atraso', 'Overdue receivables')} value={money(totals.overdueReceivable)} tone={totals.overdueReceivable ? 'bad' : undefined} />
        <Stat label={t('Pagamentos em atraso', 'Overdue payables')} value={money(totals.overduePayable)} tone={totals.overduePayable ? 'bad' : undefined} />
      </div>

      <Card className="!p-0">
        <div className="border-b border-line p-4">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: 'open', label: t('Em aberto', 'Open') },
              { id: 'payable', label: t('A pagar', 'Payable') },
              { id: 'receivable', label: t('A receber', 'Receivable') },
              { id: 'paid', label: t('Liquidadas', 'Settled') },
            ]}
          />
        </div>
        {list.length === 0 ? (
          <Empty icon={<Receipt size={22} />} title={t('Nenhuma conta aqui', 'No bills here')} text={t('Compras a prazo, vendas a prazo e folha de pagamento geram contas automaticamente.', 'Credit purchases, credit sales and payroll create bills automatically.')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>{t('Vencimento', 'Due date')}</th>
                <th className={th}>{t('Descrição', 'Description')}</th>
                <th className={th}>{t('Parte', 'Party')}</th>
                <th className={th}>{t('Situação', 'Status')}</th>
                <th className={`${th} text-right`}>{t('Valor', 'Amount')}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const d = daysUntil(a.dueDate)
                return (
                  <tr key={a.id}>
                    <td className={td}>{fmtDate(a.dueDate)}</td>
                    <td className={`${td} max-w-[240px] truncate`}>{a.description}</td>
                    <td className={td}>{a.contactName}</td>
                    <td className={td}>
                      {a.status === 'paid' ? (
                        <span className="flex items-center gap-2">
                          <Badge tone="ok">{a.kind === 'payable' ? t('Paga', 'Paid') : t('Recebida', 'Received')}</Badge>
                          {a.treasuryTx ? (
                            <a
                              className="text-xs text-accent hover:underline"
                              href={a.treasuryTx}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {t('tx USDC', 'USDC tx')}
                            </a>
                          ) : null}
                        </span>
                      ) : d < 0 ? (
                        <Badge tone="bad">{t(`${-d} dia(s) em atraso`, `${-d} day(s) overdue`)}</Badge>
                      ) : d <= 7 ? (
                        <Badge tone="warn">{d === 0 ? t('Vence hoje', 'Due today') : t(`Vence em ${d} dia(s)`, `Due in ${d} day(s)`)}</Badge>
                      ) : (
                        <Badge>{t('Em dia', 'On time')}</Badge>
                      )}
                    </td>
                    <td className={`${td} num text-right font-semibold ${a.kind === 'payable' ? 'text-bad' : 'text-ok'}`}>{money(a.amount)}</td>
                    <td className={`${td} text-right`}>
                      <div className="flex justify-end gap-1">
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
                          <button
                            aria-label={t('Editar conta', 'Edit bill')}
                            onClick={() => setTarget(a)}
                            className="flex size-9 items-center justify-center rounded-lg text-subtle hover:text-ink"
                          >
                            <Pencil size={15} />
                          </button>
                        ) : null}
                        <button
                          aria-label={t('Remover conta', 'Remove bill')}
                          onClick={() => removeAccount(a.id)}
                          className="flex size-9 items-center justify-center rounded-lg text-subtle hover:text-bad"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <AccountModal target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
