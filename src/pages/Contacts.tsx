import { useState } from 'react'
import { Pencil, Plus, Trash2, Truck, Users } from 'lucide-react'
import { Button, Card, Empty, Field, Modal, PageHeader, TableWrap, inputCls, td, th } from '@/components/ui'
import { useStore } from '@/lib/store'
import { isValidAddress } from '@/lib/gateway'
import { money, shortAddr } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Contact } from '@/lib/types'

type Kind = Contact['kind']

const blank = { name: '', doc: '', email: '', phone: '', wallet: '' }

function ContactModal({ kind, target, onClose }: { kind: Kind; target: Contact | 'new' | null; onClose: () => void }) {
  const { addContact, updateContact } = useStore()
  const editing = target && target !== 'new' ? target : null
  const [form, setForm] = useState(blank)
  const [loaded, setLoaded] = useState<string | null>(null)
  const key = target === null ? null : editing ? editing.id : 'new'
  if (key !== loaded) {
    setLoaded(key)
    setForm(editing ? { name: editing.name, doc: editing.doc, email: editing.email, phone: editing.phone, wallet: editing.wallet } : blank)
  }
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const walletOk = form.wallet.trim() === '' || isValidAddress(form.wallet.trim())

  return (
    <Modal open={target !== null} onClose={onClose} title={editing ? t('Editar cadastro', 'Edit record') : kind === 'customer' ? t('Novo cliente', 'New customer') : t('Novo fornecedor', 'New supplier')}>
      <div className="space-y-3">
        <Field label={t('Nome', 'Name')}>
          <input className={inputCls} value={form.name} onChange={set('name')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('CPF / CNPJ', 'Tax ID')}>
            <input className={inputCls} value={form.doc} onChange={set('doc')} />
          </Field>
          <Field label={t('Telefone', 'Phone')}>
            <input className={inputCls} value={form.phone} onChange={set('phone')} />
          </Field>
        </div>
        <Field label="Email">
          <input className={inputCls} type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field
          label={t('Carteira para USDC (opcional)', 'USDC wallet (optional)')}
          hint={walletOk ? t('Usada como destino padrão nos pagamentos pela tesouraria.', 'Used as the default destination for treasury payments.') : t('Endereço inválido. Use um endereço 0x com 42 caracteres.', 'Invalid address. Use a 42-character 0x address.')}
        >
          <input className={`${inputCls} mono`} value={form.wallet} onChange={set('wallet')} placeholder="0x..." />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar', 'Cancel')}
          </Button>
          <Button
            disabled={!form.name.trim() || !walletOk}
            onClick={() => {
              const payload = { ...form, name: form.name.trim(), wallet: form.wallet.trim() }
              if (editing) updateContact(editing.id, payload)
              else addContact({ ...payload, kind })
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

export function Contacts({ kind }: { kind: Kind }) {
  const { data, removeContact } = useStore()
  const [target, setTarget] = useState<Contact | 'new' | null>(null)
  const isCustomer = kind === 'customer'
  const list = data.contacts.filter((c) => c.kind === kind)

  const volume = (c: Contact) => (isCustomer ? data.sales.filter((s) => s.customerId === c.id && !s.canceledAt).reduce((s, x) => s + x.total, 0) : 0)
  const open = (c: Contact) =>
    data.accounts.filter((a) => a.contactId === c.id && a.status === 'open' && a.kind === (isCustomer ? 'receivable' : 'payable')).reduce((s, a) => s + a.amount, 0)

  return (
    <div>
      <PageHeader
        title={isCustomer ? t('Clientes', 'Customers') : t('Fornecedores', 'Suppliers')}
        subtitle={isCustomer ? t('Cadastro de clientes e saldo a receber de cada um.', 'Customer records and what each one owes you.') : t('Cadastro de fornecedores, com a carteira usada para pagamentos em USDC.', 'Supplier records, with the wallet used for USDC payments.')}
        actions={
          <Button onClick={() => setTarget('new')}>
            <Plus size={16} /> {isCustomer ? t('Novo cliente', 'New customer') : t('Novo fornecedor', 'New supplier')}
          </Button>
        }
      />
      <Card className="!p-0">
        {list.length === 0 ? (
          <Empty
            icon={isCustomer ? <Users size={22} /> : <Truck size={22} />}
            title={isCustomer ? t('Nenhum cliente cadastrado', 'No customers yet') : t('Nenhum fornecedor cadastrado', 'No suppliers yet')}
            action={
              <Button onClick={() => setTarget('new')}>
                <Plus size={16} /> {t('Cadastrar', 'Add')}
              </Button>
            }
          />
        ) : (
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
              {list.map((c) => (
                <tr key={c.id}>
                  <td className={td}>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-subtle">{c.doc || t('sem documento', 'no tax ID')}</div>
                  </td>
                  <td className={td}>
                    <div>{c.email || '-'}</div>
                    <div className="text-xs text-subtle">{c.phone}</div>
                  </td>
                  {!isCustomer ? <td className={`${td} mono text-xs`}>{c.wallet ? shortAddr(c.wallet) : t('não informada', 'not provided')}</td> : null}
                  {isCustomer ? <td className={`${td} num text-right`}>{money(volume(c))}</td> : null}
                  <td className={`${td} num text-right font-semibold ${isCustomer ? 'text-ok' : 'text-bad'}`}>{money(open(c))}</td>
                  <td className={`${td} text-right`}>
                    <div className="flex justify-end gap-1">
                      <button aria-label={t('Editar', 'Edit')} onClick={() => setTarget(c)} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-strong">
                        <Pencil size={15} />
                      </button>
                      <button
                        aria-label={t('Remover', 'Remove')}
                        onClick={() => removeContact(c.id)}
                        className="flex size-9 items-center justify-center rounded-lg text-bad hover:bg-bad/10"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <ContactModal kind={kind} target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
