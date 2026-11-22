import { useState } from 'react'
import { ListTree, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { toast } from 'sonner'
import { Badge, Button, Field, Modal, inputCls } from '@/components/ui'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { CLASS_LABELS, SUBTYPE_LABELS, explainLedger } from './messages'
import { useStore } from '@/lib/store'
import { chartTree } from '@/lib/accounting/chart'
import { SUBTYPES, accountUsage, classOfSubtype } from '@/lib/accounting/chart-ops'
import type { AccountClass, AccountSubtype, LedgerAccount } from '@/lib/accounting/types'
import { t, getLang } from '@/lib/i18n'

const CLASSES: AccountClass[] = ['asset', 'liability', 'equity', 'revenue', 'expense']

function AccountModal({ target, onClose }: { target: LedgerAccount | 'new' | null; onClose: () => void }) {
  const { data, createLedgerAccount, updateLedgerAccount } = useStore()
  const chart = data.ledger.chart
  const editing = target && target !== 'new' ? target : null
  const key = target === null ? null : target === 'new' ? 'new' : target.code
  const [loaded, setLoaded] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [cls, setCls] = useState<AccountClass>('expense')
  const [subtype, setSubtype] = useState<AccountSubtype>('expense_operating')
  const [pt, setPt] = useState('')
  const [en, setEn] = useState('')
  const [parent, setParent] = useState('')
  const [error, setError] = useState('')
  if (loaded !== key) {
    setLoaded(key)
    setError('')
    setCode(editing?.code ?? '')
    setCls(editing?.class ?? 'expense')
    setSubtype(editing?.subtype ?? 'expense_operating')
    setPt(editing?.name.pt ?? '')
    setEn(editing?.name.en ?? '')
    setParent(editing?.parent ?? '')
  }
  const used = editing ? accountUsage(data.ledger, editing.code) > 0 : false
  const hasChildren = editing ? chart.some((c) => c.parent === editing.code) : false
  const lockType = !!editing && (used || hasChildren)
  const subtypes = SUBTYPES.filter((s) => classOfSubtype(s) === 'any' || classOfSubtype(s) === cls)
  const parents = chart.filter((c) => c.class === cls && c.code !== editing?.code)

  const pickClass = (c: AccountClass) => {
    setCls(c)
    const first = SUBTYPES.find((s) => classOfSubtype(s) === c)
    setSubtype(first ?? 'group')
    setParent('')
  }
  const submit = () => {
    const name = { pt: pt.trim(), en: en.trim() || pt.trim() }
    const r = editing
      ? updateLedgerAccount(editing.code, { name, parent: parent || null, ...(lockType ? {} : { class: cls, subtype }) })
      : createLedgerAccount({ code, class: cls, subtype, name, ...(parent ? { parent } : {}) })
    if (!r.ok) {
      setError(explainLedger(r.errors))
      return
    }
    toast.success(editing ? t('Conta atualizada.', 'Account updated.') : t('Conta criada.', 'Account created.'))
    onClose()
  }
  return (
    <Modal open={target !== null} onClose={onClose} title={editing ? t('Editar conta', 'Edit account') : t('Nova conta', 'New account')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Código', 'Code')}>
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} disabled={!!editing} maxLength={12} />
        </Field>
        <Field label={t('Classe', 'Class')}>
          <select className={inputCls} value={cls} disabled={lockType} onChange={(e) => pickClass(e.target.value as AccountClass)}>
            {CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABELS[c]()}</option>)}
          </select>
        </Field>
        <Field label={t('Tipo (usado pelas regras)', 'Type (used by posting rules)')}>
          <select className={inputCls} value={subtype} disabled={lockType} onChange={(e) => setSubtype(e.target.value as AccountSubtype)}>
            {subtypes.map((s) => <option key={s} value={s}>{SUBTYPE_LABELS[s]?.() ?? s}</option>)}
          </select>
        </Field>
        <Field label={t('Conta-pai', 'Parent account')}>
          <select className={inputCls} value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">{t('(raiz)', '(root)')}</option>
            {parents.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name[getLang()]}</option>)}
          </select>
        </Field>
        <Field label={t('Nome (português)', 'Name (Portuguese)')}>
          <input className={inputCls} value={pt} onChange={(e) => setPt(e.target.value)} maxLength={80} />
        </Field>
        <Field label={t('Nome (inglês)', 'Name (English)')}>
          <input className={inputCls} value={en} onChange={(e) => setEn(e.target.value)} maxLength={80} />
        </Field>
      </div>
      {lockType ? <p className="mt-3 text-xs text-subtle">{t('Classe e tipo estão travados porque a conta tem lançamentos ou contas filhas.', 'Class and type are locked because the account has entries or child accounts.')}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-bad">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t('Cancelar', 'Cancel')}</Button>
        <Button onClick={submit} disabled={!pt.trim() || (!editing && !code.trim())}>{t('Salvar', 'Save')}</Button>
      </div>
    </Modal>
  )
}

export function ChartOfAccountsTab() {
  const { data, setLedgerAccountActive, deleteLedgerAccount } = useStore()
  const ledger = data.ledger
  const lang = getLang()
  const [target, setTarget] = useState<LedgerAccount | 'new' | null>(null)
  const [notice, setNotice] = useState('')
  const tree = chartTree(ledger.chart)

  const toggle = (a: LedgerAccount) => {
    const r = setLedgerAccountActive(a.code, !a.active)
    setNotice(r.ok ? '' : explainLedger(r.errors))
  }
  const remove = (a: LedgerAccount) => {
    const r = deleteLedgerAccount(a.code)
    if (r.ok) toast.success(t('Conta excluída.', 'Account deleted.'))
    setNotice(r.ok ? '' : explainLedger(r.errors))
  }

  return (
    <TCard className="overflow-hidden">
      <div className="p-4 sm:p-5">
        <PanelTitle
          icon={<ListTree size={18} />}
          title={t('Plano de contas', 'Chart of accounts')}
          subtitle={t('Hierárquico e configurável. Modelos por país entram em fases futuras; nenhuma regra fiscal local é assumida.', 'Hierarchical and configurable. Country templates arrive in future phases; no local tax rules are assumed.')}
          action={
            <Button onClick={() => setTarget('new')}>
              <Plus size={16} /> {t('Nova conta', 'New account')}
            </Button>
          }
        />
        {notice ? <p role="alert" className="mt-3 text-sm text-bad">{notice}</p> : null}
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-subtle">
              <th className="px-4 py-2 font-medium">{t('Conta', 'Account')}</th>
              <th className="px-3 py-2 font-medium">{t('Classe', 'Class')}</th>
              <th className="px-3 py-2 font-medium">{t('Tipo', 'Type')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Linhas', 'Lines')}</th>
              <th className="px-3 py-2 font-medium">{t('Situação', 'Status')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Ações', 'Actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tree.map(({ account: a, depth }) => {
              const used = accountUsage(ledger, a.code)
              const group = a.subtype === 'group'
              return (
                <tr key={a.code} className={clsx(!a.active && 'opacity-60')}>
                  <td className="px-4 py-2" style={{ paddingLeft: 16 + depth * 20 }}>
                    <span className="num text-subtle">{a.code}</span> <span className={clsx(group && 'font-semibold')}>{a.name[lang]}</span>
                  </td>
                  <td className="px-3 py-2">{CLASS_LABELS[a.class]()}</td>
                  <td className="px-3 py-2 text-muted">{SUBTYPE_LABELS[a.subtype]?.() ?? a.subtype}</td>
                  <td className="num px-3 py-2 text-right">{group ? '—' : used}</td>
                  <td className="px-3 py-2">{a.active ? <Badge tone="ok">{t('Ativa', 'Active')}</Badge> : <Badge tone="neutral">{t('Inativa', 'Inactive')}</Badge>}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => setTarget(a)} aria-label={t(`Editar conta ${a.code}`, `Edit account ${a.code}`)} className="rounded-lg p-2 text-muted hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                        <Pencil size={15} />
                      </button>
                      <button type="button" onClick={() => toggle(a)} aria-label={a.active ? t(`Desativar conta ${a.code}`, `Deactivate account ${a.code}`) : t(`Ativar conta ${a.code}`, `Activate account ${a.code}`)} className="rounded-lg p-2 text-muted hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                        <Power size={15} />
                      </button>
                      <button type="button" onClick={() => remove(a)} aria-label={t(`Excluir conta ${a.code}`, `Delete account ${a.code}`)} className="rounded-lg p-2 text-muted hover:bg-bad/10 hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <AccountModal target={target} onClose={() => setTarget(null)} />
    </TCard>
  )
}
