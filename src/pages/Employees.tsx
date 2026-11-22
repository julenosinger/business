import { useState } from 'react'
import { CalendarCheck, Coins, Copy, Pencil, Plus, Receipt, Trash2, UserRound, Users, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty, Field, Modal, TableWrap, inputCls, td, th } from '@/components/ui'
import { DateField } from '@/components/DateField'
import { isValidIso } from '@/lib/dates'
import { Bar, C } from '@/components/charts'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
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
          <DateField value={form.admission} onChange={(v) => setForm((f) => ({ ...f, admission: v }))} />
        </Field>
        <Field label={t('Carteira para receber em USDC (opcional)', 'Wallet to receive USDC (optional)')} hint={walletOk ? undefined : t('Endereço inválido.', 'Invalid address.')}>
          <input className={`${inputCls} mono`} value={form.wallet} onChange={set('wallet')} placeholder="0x..." />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar', 'Cancel')}
          </Button>
          <Button
            disabled={!form.name.trim() || !(salary > 0) || !walletOk || !isValidIso(form.admission)}
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
  const openTotal = openPayroll.reduce((s, a) => s + a.amount, 0)
  const paidThisMonth = payrollAccounts.filter((a) => a.status === 'paid').length
  const complete = active.length > 0 && payrollAccounts.length >= active.length

  const generate = () => {
    const n = runPayroll(month, addDays(`${month}-01`, 34).slice(0, 8) + '05')
    toast[n ? 'success' : 'info'](
      n
        ? t(`Folha de ${monthTitle(month)} gerada: ${n} pagamento(s).`, `${monthTitle(month)} payroll created: ${n} payment(s).`)
        : t('A folha deste mês já foi gerada.', 'This month payroll was already created.'),
    )
  }

  const copyWallet = (w: string) => {
    void navigator.clipboard.writeText(w).then(
      () => toast.success(t('Endereço copiado.', 'Address copied.')),
      () => toast.error(t('Não foi possível copiar.', 'Could not copy.')),
    )
  }
  const iconBtn = 'flex size-9 items-center justify-center rounded-lg hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60'

  const walletCell = (e: Employee) =>
    e.wallet ? (
      <span className="inline-flex items-center gap-1.5">
        <Wallet size={12} className="text-subtle" />
        <span className="mono text-xs">{shortAddr(e.wallet)}</span>
        <button aria-label={t('Copiar endereço', 'Copy address')} title={t('Copiar endereço', 'Copy address')} onClick={() => copyWallet(e.wallet)} className="flex size-7 items-center justify-center rounded-md text-subtle hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60">
          <Copy size={13} />
        </button>
      </span>
    ) : (
      <span className="text-xs text-subtle">{t('não informada', 'not provided')}</span>
    )

  const activeBadge = (e: Employee) => (
    <button onClick={() => updateEmployee(e.id, { active: !e.active })} aria-label={e.active ? t('Desativar', 'Deactivate') : t('Ativar', 'Activate')} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60">
      <Badge tone={e.active ? 'ok' : 'neutral'}>{e.active ? t('Ativo', 'Active') : t('Inativo', 'Inactive')}</Badge>
    </button>
  )

  const payrollBadge = (e: Employee) => {
    if (!e.active) return <span className="text-xs text-subtle">—</span>
    const acc = payrollAccounts.find((a) => a.employeeId === e.id)
    if (!acc) return <Badge>{t('Não gerada', 'Not created')}</Badge>
    return acc.status === 'paid' ? <Badge tone="ok">{t('Paga', 'Paid')}</Badge> : <Badge tone="warn">{t('Pendente', 'Pending')}</Badge>
  }

  const actions = (e: Employee) => {
    const acc = openPayroll.find((a) => a.employeeId === e.id)
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        {acc ? (
          <Button small variant="subtle" onClick={() => requestPay(acc.id)}>
            <Coins size={14} /> {t('Pagar em USDC', 'Pay in USDC')}
          </Button>
        ) : null}
        <button aria-label={t('Editar', 'Edit')} onClick={() => setTarget(e)} className={`${iconBtn} text-muted`}>
          <Pencil size={15} />
        </button>
        <button aria-label={t('Remover', 'Remove')} onClick={() => removeEmployee(e.id)} className={`${iconBtn} text-bad hover:!bg-bad/10`}>
          <Trash2 size={15} />
        </button>
      </div>
    )
  }

  const avatar = (e: Employee) => (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky/15 text-sm font-semibold text-sky" aria-hidden>
      {e.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
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
              <Receipt size={16} /> {t('Gerar folha de', 'Create payroll for')} {monthTitle(month)}
            </Button>
            <Button onClick={() => setTarget('new')}>
              <Plus size={16} /> {t('Novo funcionário', 'New employee')}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="sky" icon={<Users size={20} />} label={t('Funcionários ativos', 'Active employees')} value={String(active.length)} sub={`${data.employees.length - active.length} ${t('inativo(s)', 'inactive')}`} />
        <KpiTile tone="violet" icon={<Wallet size={20} />} label={t('Folha mensal', 'Monthly payroll')} value={money(payroll)} sub={t('soma dos salários ativos', 'sum of active salaries')} />
        <KpiTile
          tone="ok"
          icon={<CalendarCheck size={20} />}
          label={t('Folha do mês gerada', 'Payroll created this month')}
          value={`${payrollAccounts.length}/${active.length}`}
          sub={active.length === 0 ? '—' : complete ? t('Folha completa', 'Payroll complete') : t('Falta gerar a folha', 'Payroll still to create')}
        />
        <KpiTile
          tone="warn"
          icon={<Coins size={20} />}
          label={t('Salários a pagar', 'Salaries due')}
          value={money(openTotal)}
          valueTone={openPayroll.length ? 'bad' : undefined}
          sub={openPayroll.length ? `${openPayroll.length} ${t('pagamento(s) em aberto', 'open payment(s)')}` : t('Nada pendente', 'Nothing pending')}
        />
      </div>

      {openPayroll.length > 0 ? (
        <TCard tint="warn" className="p-4 sm:p-5">
          <PanelTitle
            icon={<Coins size={18} />}
            title={t('Salários pendentes', 'Pending salaries')}
            subtitle={t(`${openPayroll.length} pagamento(s) em aberto. Pague em USDC aqui ou marque como pago em Contas a pagar e receber.`, `${openPayroll.length} payment(s) open. Pay in USDC here or mark them paid in Payables and receivables.`)}
          />
          {payrollAccounts.length > 0 ? (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
                <span>{t('Folha de', 'Payroll for')} {monthTitle(month)}</span>
                <span className="num">
                  {paidThisMonth}/{payrollAccounts.length} {t('pagas', 'paid')}
                </span>
              </div>
              <Bar value={paidThisMonth} max={payrollAccounts.length} color={C.ok} />
            </div>
          ) : null}
        </TCard>
      ) : null}

      <TCard className="overflow-hidden">
        <div className="border-b border-line p-4 sm:px-5">
          <PanelTitle icon={<UserRound size={18} />} title={t('Equipe', 'Team')} subtitle={`${data.employees.length} ${data.employees.length === 1 ? t('funcionário', 'employee') : t('funcionários', 'employees')}`} />
        </div>
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
          <>
            <div className="hidden md:block">
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>{t('Nome', 'Name')}</th>
                    <th className={th}>{t('Admissão', 'Hired')}</th>
                    <th className={th}>{t('Carteira USDC', 'USDC wallet')}</th>
                    <th className={th}>{t('Situação', 'Status')}</th>
                    <th className={th}>{t('Folha do mês', 'This month')}</th>
                    <th className={`${th} text-right`}>{t('Salário', 'Salary')}</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((e) => (
                    <tr key={e.id} className="transition hover:bg-fill/5">
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          {avatar(e)}
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{e.name}</div>
                            <div className="text-xs text-subtle">{e.role}</div>
                          </div>
                        </div>
                      </td>
                      <td className={td}>{fmtDate(e.admission)}</td>
                      <td className={td}>{walletCell(e)}</td>
                      <td className={td}>{activeBadge(e)}</td>
                      <td className={td}>{payrollBadge(e)}</td>
                      <td className={`${td} num text-right font-semibold`}>{money(e.salary)}</td>
                      <td className={`${td} text-right`}>{actions(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {data.employees.map((e) => (
                <li key={e.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {avatar(e)}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{e.name}</p>
                        <p className="truncate text-xs text-subtle">
                          {e.role} · {fmtDate(e.admission)}
                        </p>
                      </div>
                    </div>
                    <div className="num shrink-0 whitespace-nowrap text-sm font-semibold">{money(e.salary)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {activeBadge(e)}
                    {payrollBadge(e)}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {walletCell(e)}
                    {actions(e)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </TCard>

      <EmployeeModal target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
