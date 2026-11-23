import { useState } from 'react'
import { ArrowLeft, Briefcase, Coins, Info, Pencil, Receipt, Wallet } from 'lucide-react'
import { Badge, Button, Empty } from '@/components/ui'
import { TCard, PanelTitle } from '@/components/ds/Panel'
import { PillTabs } from '@/components/ds/PillTabs'
import { useStore } from '@/lib/store'
import { useNetwork } from '@/lib/network'
import { accountsForEnvironment, employeesForEnvironment } from '@/lib/selectors'
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

  const payroll = accountsForEnvironment(data.accounts, network).filter((a) => a.source === 'payroll' && a.employeeId === employee.id).sort((a, b) => b.dueDate.localeCompare(a.dueDate))
  const openPayroll = payroll.filter((a) => a.status === 'open')
  const totalPaid = payroll.filter((a) => a.status === 'paid').reduce((s, a) => s + a.amount, 0)
  const totalOpen = openPayroll.reduce((s, a) => s + a.amount, 0)

  const tabs = [
    { id: 'overview' as const, label: t('Visão geral', 'Overview') },
    { id: 'info' as const, label: t('Informações', 'Information') },
    { id: 'payroll' as const, label: t('Folha', 'Payroll') },
  ]

  return (
    <div className="space-y-4">
      <TCard className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-sky/15 text-lg font-semibold text-sky" aria-hidden>
              {employee.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="display truncate text-lg font-semibold">{employee.name}</h2>
                <Badge tone={employee.active ? 'ok' : 'neutral'}>{employee.active ? t('Ativo', 'Active') : t('Inativo', 'Inactive')}</Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {employee.role}
                {employee.department ? ` · ${employee.department}` : ''}
              </p>
              <p className="mt-1 text-xs text-subtle">
                {employee.registration ? `${t('Matrícula', 'Employee ID')}: ${employee.registration} · ` : ''}
                {t('Admissão', 'Hired')}: {fmtDate(employee.admission)}
              </p>
            </div>
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

      <PillTabs label={t('Seções do perfil', 'Profile sections')} value={tab} onChange={setTab} items={tabs} />

      {tab === 'overview' ? (
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
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-fill/5 px-3 py-2 text-sm">
                <Wallet size={14} className="text-subtle" />
                <span className="mono text-xs">{shortAddr(employee.wallet)}</span>
              </div>
            ) : null}
          </TCard>

          <TCard className="p-4 sm:p-5">
            <PanelTitle icon={<Coins size={18} />} title={t('Remuneração', 'Compensation')} />
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t('Salário mensal', 'Monthly salary')}</dt>
                <dd className="num font-semibold">{money(employee.salary)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t('Total pago', 'Total paid')}</dt>
                <dd className="num font-semibold text-ok">{money(totalPaid)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t('Em aberto', 'Open')}</dt>
                <dd className={`num font-semibold ${totalOpen > 0 ? 'text-bad' : 'text-subtle'}`}>{money(totalOpen)}</dd>
              </div>
            </dl>
          </TCard>
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
            <PanelTitle icon={<Receipt size={18} />} title={t('Folha de pagamento', 'Payroll')} subtitle={t('Registros de salário vinculados a este funcionário', 'Salary records linked to this employee')} />
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
                    <p className="num text-sm font-semibold">{money(a.amount)}</p>
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
