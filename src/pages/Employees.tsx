import { useState } from 'react'
import { Coins, Pencil, Plus, Trash2, UserRound, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, CardTitle, Empty, Field, Modal, PageHeader, Stat, TableWrap, inputCls, td, th } from '@/components/ui'
import { useStore } from '@/lib/store'
import { useNav } from '@/lib/nav'
import { isValidAddress } from '@/lib/gateway'
import { addDays, fmtDate, money, monthTitle, parseNum, shortAddr, today } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Employee } from '@/lib/types'

const blank = { name: '', role: '', salary: '', wallet: '', admission: today() }

function EmployeeModal({ target, onClose }: { target: Employee | 'new' | null; onClose: () => void }) {
  const { addEmployee, updateEmployee } = useStore()
  const editing = target && target !== 'new' ? target : null
  const [form, setForm] = useState(blank)
  const [loaded, setLoaded] = useState<string | null>(null)
  const key = target === null ? null : editing ? editing.id : 'new'
  if (key !== loaded) {
    setLoaded(key)
    setForm(editing ? { name: editing.name, role: editing.role, salary: String(editing.salary), wallet: editing.wallet, admission: editing.admission } : blank)
  }
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const salary = parseNum(form.salary)
  const walletOk = form.wallet.trim() === '' || isValidAddress(form.wallet.trim())

  return (
    <Modal open={target !== null} onClose={onClose} title={editing ? t('Editar funcionário', 'Edit employee') : t('Novo funcionário', 'New employee')}>
      <div className="space-y-3">
        <Field label={t('Nome', 'Name')}>
          <input className={inputCls} value={form.name} onChange={set('name')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Cargo', 'Role')}>
            <input className={inputCls} value={form.role} onChange={set('role')} />
          </Field>
          <Field label={t('Salário mensal', 'Monthly salary')}>
            <input className={inputCls} inputMode="decimal" value={form.salary} onChange={set('salary')} placeholder="0,00" />
          </Field>
        </div>
        <Field label={t('Admissão', 'Hire date')}>
          <input type="date" className={inputCls} value={form.admission} onChange={set('admission')} />
        </Field>
        <Field label={t('Carteira para receber em USDC (opcional)', 'Wallet to receive USDC (optional)')} hint={walletOk ? undefined : t('Endereço inválido.', 'Invalid address.')}>
          <input className={`${inputCls} mono`} value={form.wallet} onChange={set('wallet')} placeholder="0x..." />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar', 'Cancel')}
          </Button>
          <Button
            disabled={!form.name.trim() || !(salary > 0) || !walletOk}
            onClick={() => {
              const payload = { name: form.name.trim(), role: form.role.trim(), salary, wallet: form.wallet.trim(), admission: form.admission }
              if (editing) updateEmployee(editing.id, payload)
              else addEmployee({ ...payload, active: true })
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

export function Employees() {
  const { data, updateEmployee, removeEmployee, runPayroll } = useStore()
  const { requestPay, requestIntent } = useNav()
  const [target, setTarget] = useState<Employee | 'new' | null>(null)
  const month = today().slice(0, 7)
  const active = data.employees.filter((e) => e.active)
  const payroll = active.reduce((s, e) => s + e.salary, 0)
  const payrollAccounts = data.accounts.filter((a) => a.source === 'payroll' && a.description.endsWith(month))
  const openPayroll = data.accounts.filter((a) => a.source === 'payroll' && a.status === 'open')

  const generate = () => {
    const n = runPayroll(month, addDays(`${month}-01`, 34).slice(0, 8) + '05')
    toast[n ? 'success' : 'info'](
      n
        ? t(`Folha de ${monthTitle(month)} gerada: ${n} pagamento(s).`, `${monthTitle(month)} payroll created: ${n} payment(s).`)
        : t('A folha deste mês já foi gerada.', 'This month payroll was already created.'),
    )
  }

  return (
    <div>
      <PageHeader
        title={t('Funcionários', 'Employees')}
        subtitle={t('Cadastro, folha de pagamento mensal e pagamento de salários em USDC pela tesouraria.', 'Records, monthly payroll and salary payments in USDC through the treasury.')}
        actions={
          <>
            {openPayroll.length > 0 ? (
              <Button variant="subtle" onClick={() => requestIntent({ kind: 'batch', ids: openPayroll.map((a) => a.id) })}>
                <Coins size={16} /> {t(`Pagar folha em USDC (${openPayroll.length})`, `Pay payroll in USDC (${openPayroll.length})`)}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={generate} disabled={active.length === 0}>
              <Coins size={16} /> {t('Gerar folha de', 'Create payroll for')} {monthTitle(month)}
            </Button>
            <Button onClick={() => setTarget('new')}>
              <Plus size={16} /> {t('Novo funcionário', 'New employee')}
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Funcionários ativos', 'Active employees')} value={String(active.length)} icon={<UserRound size={16} />} />
        <Stat label={t('Folha mensal', 'Monthly payroll')} value={money(payroll)} />
        <Stat label={t('Folha do mês gerada', 'Payroll created this month')} value={`${payrollAccounts.length}/${active.length}`} />
        <Stat label={t('Salários a pagar', 'Salaries due')} value={money(openPayroll.reduce((s, a) => s + a.amount, 0))} tone={openPayroll.length ? 'bad' : undefined} />
      </div>

      <Card className="!p-0">
        {data.employees.length === 0 ? (
          <Empty
            icon={<UserRound size={22} />}
            title={t('Nenhum funcionário cadastrado', 'No employees yet')}
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
                <th className={th}>{t('Admissão', 'Hired')}</th>
                <th className={th}>{t('Carteira USDC', 'USDC wallet')}</th>
                <th className={th}>{t('Situação', 'Status')}</th>
                <th className={`${th} text-right`}>{t('Salário', 'Salary')}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => {
                const acc = openPayroll.find((a) => a.employeeId === e.id)
                return (
                  <tr key={e.id}>
                    <td className={td}>
                      <div className="font-semibold">{e.name}</div>
                      <div className="text-xs text-subtle">{e.role}</div>
                    </td>
                    <td className={td}>{fmtDate(e.admission)}</td>
                    <td className={`${td} mono text-xs`}>
                      {e.wallet ? (
                        <span className="inline-flex items-center gap-1">
                          <Wallet size={12} /> {shortAddr(e.wallet)}
                        </span>
                      ) : (
                        t('não informada', 'not provided')
                      )}
                    </td>
                    <td className={td}>
                      <button onClick={() => updateEmployee(e.id, { active: !e.active })}>
                        <Badge tone={e.active ? 'ok' : 'neutral'}>{e.active ? t('Ativo', 'Active') : t('Inativo', 'Inactive')}</Badge>
                      </button>
                    </td>
                    <td className={`${td} num text-right font-semibold`}>{money(e.salary)}</td>
                    <td className={`${td} text-right`}>
                      <div className="flex justify-end gap-1">
                        {acc ? (
                          <Button small variant="subtle" onClick={() => requestPay(acc.id)}>
                            <Coins size={14} /> {t('Pagar em USDC', 'Pay in USDC')}
                          </Button>
                        ) : null}
                        <button aria-label={t('Editar', 'Edit')} onClick={() => setTarget(e)} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-strong">
                          <Pencil size={15} />
                        </button>
                        <button
                          aria-label={t('Remover', 'Remove')}
                          onClick={() => removeEmployee(e.id)}
                          className="flex size-9 items-center justify-center rounded-lg text-bad hover:bg-bad/10"
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

      {openPayroll.length > 0 ? (
        <Card className="mt-6">
          <CardTitle>{t('Salários pendentes', 'Pending salaries')}</CardTitle>
          <p className="text-sm text-muted">
            {t(`${openPayroll.length} pagamento(s) em aberto. Pague em USDC aqui ou marque como pago em Contas a pagar e receber.`, `${openPayroll.length} payment(s) open. Pay in USDC here or mark them paid in Payables and receivables.`)}
          </p>
        </Card>
      ) : null}

      <EmployeeModal target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
