import { useState } from 'react'
import { ArrowLeft, Briefcase, ClipboardList, Coins, Copy, Info, Pencil, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty } from '@/components/ui'
import { TCard, PanelTitle } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { useStore } from '@/lib/store'
import { useNav } from '@/lib/nav'
import { useNetwork } from '@/lib/network'
import { accountOutstanding, accountsForEnvironment, employeesForEnvironment } from '@/lib/selectors'
import { groupMoneyByCurrency, formatMoneyGroup, formatValue } from '@/lib/profile-money'
import { fmtDate, money, shortAddr } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Employee } from '@/lib/types'

type Tab = 'overview' | 'info' | 'payroll'

function InfoItem({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{value}</dd>
    </div>
  )
}

export function EmployeeProfile({ employeeId, onBack, onEdit }: { employeeId: string; onBack: () => void; onEdit: (e: Employee) => void }) {
  const { data } = useStore()
  const { openProfileIntent } = useNav()
  const network = useNetwork()
  const [tab, setTab] = useState<Tab>('overview')

  const employee = employeesForEnvironment(data, network).find((e) => e.id === employeeId)
  if (!employee) {
    return (
      <Empty
        icon={<Briefcase size={22} />}
        title={t('Funcionário não encontrado', 'Employee not found')}
        text={t('O funcionário pode ter sido removido ou pertence a outro ambiente.', 'The employee may have been removed or belong to another environment.')}
        action={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} /> {t('Voltar', 'Back')}
          </Button>
        }
      />
    )
  }

  const payroll = accountsForEnvironment(data.accounts, network).filter((a) => a.source === 'payroll' && a.employeeId === employee.id && !a.canceledAt).sort((a, b) => b.dueDate.localeCompare(a.dueDate))
  const paidGroups = groupMoneyByCurrency(payroll.filter((a) => a.status === 'paid').map((a) => ({ amount: a.amount, currency: a.currency })))
  const openGroups = groupMoneyByCurrency(payroll.filter((a) => a.status === 'open').map((a) => ({ amount: accountOutstanding(a), currency: a.currency })))

  const copyWallet = () => {
    void navigator.clipboard.writeText(employee.wallet).then(
      () => toast.success(t('Endereço copiado.', 'Address copied.')),
      () => toast.error(t('Não foi possível copiar.', 'Could not copy.')),
    )
  }

  const tabs = [
    { id: 'overview' as const, label: t('Visão geral', 'Overview') },
    { id: 'info' as const, label: t('Informações', 'Information') },
    { id: 'payroll' as const, label: t('Folha', 'Payroll') },
  ]

  // Ações rápidas: navega para o Financeiro filtrado pelas obrigações deste funcionário.
  const quickActions = [
    { key: 'accounts', icon: <Coins size={15} />, label: t('Ver contas', 'View bills'), run: () => openProfileIntent({ kind: 'accounts', employeeId: employee.id, label: employee.name }) },
  ]

  return (
    <div className="space-y-4">
      <TCard className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky/15 text-lg font-semibold text-sky" aria-hidden>
            {employee.name.trim().charAt(0).toUpperCase() || '?'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="display truncate text-lg font-semibold">{employee.name}</h2>
              <Badge tone={employee.active ? 'ok' : 'neutral'}>{employee.active ? t('Ativo', 'Active') : t('Inativo', 'Inactive')}</Badge>
            </div>
            <p className="mt-0.5 truncate text-sm text-muted">
              {employee.role}
              {employee.department ? ` · ${employee.department}` : ''}
              {employee.registration ? ` · ${t('Matrícula', 'Employee ID')}: ${employee.registration}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" small onClick={onBack}>
              <ArrowLeft size={15} /> {t('Voltar', 'Back')}
            </Button>
            <Button small onClick={() => onEdit(employee)}>
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
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            <TCard className="p-3.5 sm:p-4">
              <div className="text-xs font-semibold text-muted">{t('Salário mensal', 'Monthly salary')}</div>
              <div className="display num mt-1 text-lg font-semibold sm:text-xl">{money(employee.salary)}</div>
            </TCard>
            <TCard className="p-3.5 sm:p-4">
              <div className="text-xs font-semibold text-muted">{t('Total pago', 'Total paid')}</div>
              {paidGroups.length === 0 ? (
                <div className="num mt-1 text-lg font-semibold text-subtle">{money(0)}</div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {paidGroups.map((g) => (
                    <div key={g.code} className="num text-sm font-semibold text-ok">{formatMoneyGroup(g)}</div>
                  ))}
                </div>
              )}
            </TCard>
            <TCard className="p-3.5 sm:p-4">
              <div className="text-xs font-semibold text-muted">{t('Em aberto', 'Open')}</div>
              {openGroups.length === 0 ? (
                <div className="num mt-1 text-lg font-semibold text-subtle">{money(0)}</div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {openGroups.map((g) => (
                    <div key={g.code} className="num text-sm font-semibold text-bad">{formatMoneyGroup(g)}</div>
                  ))}
                </div>
              )}
            </TCard>
            <TCard className="p-3.5 sm:p-4">
              <div className="text-xs font-semibold text-muted">{t('Registros de folha', 'Payroll records')}</div>
              <div className="display num mt-1 text-lg font-semibold sm:text-xl">{payroll.length}</div>
            </TCard>
          </div>

          <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-2">
            <TCard className="p-4 sm:p-5">
              <PanelTitle icon={<Briefcase size={18} />} title={t('Dados profissionais', 'Professional details')} />
              <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoItem label={t('Cargo', 'Role')} value={employee.role} />
                <InfoItem label={t('Departamento', 'Department')} value={employee.department} />
                <InfoItem label={t('Matrícula', 'Employee ID')} value={employee.registration} />
                <InfoItem label={t('Admissão', 'Hire date')} value={fmtDate(employee.admission)} />
                <InfoItem label={t('Tipo de vínculo', 'Contract type')} value={employee.contractType} />
                <InfoItem label={t('Centro de custo', 'Cost center')} value={employee.costCenter} />
                <InfoItem label={t('Email', 'Email')} value={employee.email} />
                <InfoItem label={t('Telefone', 'Phone')} value={employee.phone} />
              </dl>
              {employee.wallet ? (
                <div className="mt-4 rounded-xl bg-fill/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
                      <Wallet size={13} /> {t('Carteira de pagamento', 'Payment wallet')}
                    </span>
                    <Button small variant="ghost" onClick={copyWallet}>
                      <Copy size={13} /> {t('Copiar', 'Copy')}
                    </Button>
                  </div>
                  <span className="mono mt-1 block truncate text-xs">{shortAddr(employee.wallet)}</span>
                </div>
              ) : null}
            </TCard>

            <TCard className="overflow-hidden">
              <div className="border-b border-line p-4 sm:px-5">
                <PanelTitle icon={<ClipboardList size={18} />} title={t('Atividade recente', 'Recent activity')} />
              </div>
              {payroll.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">{t('Nenhum registro de folha.', 'No payroll records.')}</p>
              ) : (
                <ul className="divide-y divide-line px-4 sm:px-5">
                  {payroll.slice(0, 5).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.description}</p>
                        <p className="text-xs text-subtle">{t('Vencimento', 'Due date')}: {fmtDate(a.dueDate)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`num text-sm font-semibold ${a.status === 'open' ? 'text-bad' : 'text-ok'}`}>{formatValue(a.amount, a.currency)}</span>
                        <Badge tone={a.status === 'paid' ? 'ok' : 'warn'}>{a.status === 'paid' ? t('Paga', 'Paid') : t('Pendente', 'Pending')}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TCard>
          </div>
        </div>
      ) : null}

      {tab === 'info' ? (
        <TCard className="p-4 sm:p-5">
          <PanelTitle icon={<Info size={18} />} title={t('Informações adicionais', 'Additional information')} />
          <dl className="mt-4 space-y-3">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{t('Observações administrativas', 'Administrative notes')}</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-muted">{employee.notes || t('—', '—')}</dd>
            </div>
          </dl>
        </TCard>
      ) : null}

      {tab === 'payroll' ? (
        <TCard className="overflow-hidden">
          <div className="border-b border-line p-4 sm:px-5">
            <PanelTitle icon={<Coins size={18} />} title={t('Folha de pagamento', 'Payroll')} subtitle={t('Registros de salário vinculados a este funcionário', 'Salary records linked to this employee')} />
          </div>
          {payroll.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">{t('Nenhum registro de folha.', 'No payroll records.')}</p>
          ) : (
            <ul className="divide-y divide-line px-4 sm:px-5">
              {payroll.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.description}</p>
                    <p className="text-xs text-subtle">{t('Vencimento', 'Due date')}: {fmtDate(a.dueDate)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`num text-sm font-semibold ${a.status === 'open' ? 'text-bad' : 'text-ok'}`}>{formatValue(a.amount, a.currency)}</p>
                    <Badge tone={a.status === 'paid' ? 'ok' : 'warn'}>{a.status === 'paid' ? t('Paga', 'Paid') : t('Pendente', 'Pending')}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TCard>
      ) : null}
    </div>
  )
}
