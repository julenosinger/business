import { useRef, useState } from 'react'
import { Archive, Building2, Coins, Database, Download, Landmark, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, inputCls } from '@/components/ui'
import { KpiTile } from '@/components/ds/KpiTile'
import { PageTop } from '@/components/ds/PageTop'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { useStore } from '@/lib/store'
import { EnvironmentReview } from '@/components/EnvironmentReview'
import { num, parseNum } from '@/lib/format'
import { locale, t } from '@/lib/i18n'
import { exportBackup, lastBackupAt, parseBackup } from '@/lib/backup'
import type { CurrencyCode } from '@/lib/types'

export function SettingsPage() {
  const { data, updateSettings, loadDemo, resetAll, importData } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [lastBackup, setLastBackup] = useState<number | null>(lastBackupAt())
  const s = data.settings
  const [rate, setRate] = useState(s.usdcRate ? String(s.usdcRate) : '')
  const [limitText, setLimitText] = useState(s.approvalLimit ? String(s.approvalLimit) : '')

  const saveLimit = () => {
    const v = parseNum(limitText)
    if (limitText.trim() === '') {
      updateSettings({ approvalLimit: null })
      toast.success(t('Limite removido.', 'Limit removed.'))
    } else if (v > 0) {
      updateSettings({ approvalLimit: v })
      toast.success(t('Limite salvo.', 'Limit saved.'))
    } else {
      toast.error(t('Informe um número maior que zero.', 'Enter a number greater than zero.'))
    }
  }

  const saveRate = () => {
    const v = parseNum(rate)
    if (rate.trim() === '') {
      updateSettings({ usdcRate: null })
      toast.success(t('Cotação removida.', 'Rate removed.'))
    } else if (v > 0) {
      updateSettings({ usdcRate: v })
      toast.success(t('Cotação salva.', 'Rate saved.'))
    } else {
      toast.error(t('Informe um número maior que zero.', 'Enter a number greater than zero.'))
    }
  }

  const doExport = () => {
    exportBackup(data)
    setLastBackup(lastBackupAt())
    toast.success(t('Backup exportado. Guarde o arquivo em um lugar seguro.', 'Backup exported. Keep the file somewhere safe.'))
  }

  const doImport = async (file: File) => {
    const res = parseBackup(await file.text())
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    const { products, sales, accounts } = res.counts
    const ok = window.confirm(
      t(
        `Restaurar este backup? Os dados atuais serão substituídos por ${products} produto(s), ${sales} venda(s) e ${accounts} conta(s).`,
        `Restore this backup? Current data will be replaced by ${products} product(s), ${sales} sale(s) and ${accounts} bill(s).`,
      ),
    )
    if (ok) importData(res.data)
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop title={t('Configurações', 'Settings')} subtitle={t('Dados da empresa, moeda e parâmetros da tesouraria.', 'Company details, currency and treasury parameters.')} />

      <EnvironmentReview />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="sky" icon={<Building2 size={20} />} label={t('Moeda do app', 'App currency')} value={s.currency} sub={s.company || '—'} />
        <KpiTile
          tone="violet"
          icon={<Coins size={20} />}
          label={t('Cotação do USDC', 'USDC rate')}
          value={s.currency === 'USDC' ? '1 USDC' : s.usdcRate ? `${num(s.usdcRate)} ${s.currency}` : '—'}
          sub={s.currency === 'USDC' ? t('A moeda do app já é USDC', 'The app currency is already USDC') : s.usdcRate ? t('por 1 USDC', 'per 1 USDC') : t('Não definida', 'Not set')}
        />
        <KpiTile
          tone="warn"
          icon={<ShieldCheck size={20} />}
          label={t('Limite de segurança', 'Safety limit')}
          value={s.approvalLimit ? `${num(s.approvalLimit)} USDC` : '—'}
          sub={s.approvalLimit ? t('Confirmação extra acima disso', 'Extra confirmation above this') : t('Sem limite definido', 'No limit set')}
        />
        <KpiTile
          tone="ok"
          icon={<Archive size={20} />}
          label={t('Último backup', 'Last backup')}
          value={lastBackup ? new Date(lastBackup).toLocaleDateString(locale()) : t('Nunca', 'Never')}
          valueTone={lastBackup ? undefined : 'bad'}
          sub={lastBackup ? t('Dados protegidos', 'Data protected') : t('Faça um backup', 'Make a backup')}
        />
      </div>

      <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-2">
        <div className="space-y-4 sm:space-y-5">
          <TCard className="p-4 sm:p-5">
            <PanelTitle icon={<Building2 size={18} />} title={t('Empresa', 'Company')} subtitle={t('Salvo automaticamente ao digitar', 'Saved automatically as you type')} />
            <div className="mt-4 space-y-3">
              <Field label={t('Nome da empresa', 'Company name')}>
                <input className={inputCls} value={s.company} onChange={(e) => updateSettings({ company: e.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('Filial', 'Branch')}>
                  <input className={inputCls} value={s.branch} onChange={(e) => updateSettings({ branch: e.target.value })} />
                </Field>
                <Field label={t('Responsável', 'Owner')}>
                  <input className={inputCls} value={s.owner} onChange={(e) => updateSettings({ owner: e.target.value })} />
                </Field>
              </div>
              <Field label={t('Moeda contábil e de exibição', 'Accounting and display currency')} hint={t('Troca o símbolo e a moeda padrão de novos registros. Os valores já lançados não são convertidos e registros antigos mantêm a moeda em que foram feitos.', 'Changes the symbol and the default currency of new records. Existing amounts are not converted and old records keep the currency they were made in.')}>
                <select className={inputCls} value={s.currency} onChange={(e) => updateSettings({ currency: e.target.value as CurrencyCode })}>
                  <option value="USDC">{t('USDC (Circle)', 'USDC (Circle)')}</option>
                  <option value="BRL">{t('Real (BRL)', 'Brazilian real (BRL)')}</option>
                  <option value="USD">{t('Dólar (USD)', 'US dollar (USD)')}</option>
                  <option value="EUR">Euro (EUR)</option>
                </select>
              </Field>
              <ul className="space-y-1 rounded-xl border border-line bg-fill/5 p-3 text-xs text-muted">
                <li>
                  <b className="text-ink">{t('Moeda contábil e de exibição', 'Accounting and display currency')}:</b> {s.currency}
                </li>
                <li>
                  <b className="text-ink">{t('Ativo de liquidação da tesouraria', 'Treasury settlement asset')}:</b> USDC ({t('Circle Gateway', 'Circle Gateway')})
                </li>
                <li>{t('USD e USDC são moedas diferentes: nunca são tratadas como iguais nem convertidas automaticamente.', 'USD and USDC are different currencies: they are never treated as equal or converted automatically.')}</li>
              </ul>
            </div>
          </TCard>

          <TCard className="p-4 sm:p-5">
            <PanelTitle icon={<Landmark size={18} />} title={t('Tesouraria', 'Treasury')} subtitle={t('Parâmetros dos pagamentos em USDC', 'Parameters for USDC payments')} />
            <div className="mt-4 space-y-4">
              {s.currency === 'USDC' ? (
                <p className="rounded-xl border border-line bg-fill/5 p-3 text-sm text-muted">{t('A moeda do app já é USDC, então não há cotação a definir: os valores em USDC seguem 1 para 1 com o app.', 'The app currency is already USDC, so there is no rate to set: USDC amounts map 1 to 1 with the app.')}</p>
              ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  saveRate()
                }}
              >
                <Field
                  label={t(`Cotação: ${s.currency} por 1 USDC`, `Rate: ${s.currency} per 1 USDC`)}
                  hint={t('Opcional. Você define o valor. Usado para sugerir o valor em USDC ao pagar contas. Deixe em branco para remover.', 'Optional. You set the value. Used to suggest the USDC amount when paying bills. Leave blank to remove.')}
                >
                  <div className="flex gap-2">
                    <input className={inputCls} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={t('Ex.: informe sua cotação', 'E.g. enter your rate')} />
                    <Button type="submit">{t('Salvar', 'Save')}</Button>
                  </div>
                </Field>
              </form>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  saveLimit()
                }}
              >
                <Field
                  label={t('Limite de segurança (USDC)', 'Safety limit (USDC)')}
                  hint={t('Opcional. Envios acima deste valor pedem uma confirmação extra antes de assinar. Deixe em branco para remover.', 'Optional. Transfers above this amount ask for an extra confirmation before signing. Leave blank to remove.')}
                >
                  <div className="flex gap-2">
                    <input className={inputCls} inputMode="decimal" value={limitText} onChange={(e) => setLimitText(e.target.value)} placeholder="Ex.: 1000" />
                    <Button type="submit">{t('Salvar', 'Save')}</Button>
                  </div>
                </Field>
              </form>
            </div>
          </TCard>
        </div>

        <div className="space-y-4 sm:space-y-5">
          <TCard className="p-4 sm:p-5">
            <PanelTitle icon={<Archive size={18} />} title={t('Backup', 'Backup')} subtitle={t('Proteja e leve seus dados', 'Protect and move your data')} />
            <p className="mt-4 text-sm text-muted text-pretty">
              {t(
                'Seus dados ficam salvos só neste navegador. Exporte um backup para não perdê-los e para levar para outro computador.',
                'Your data is saved only in this browser. Export a backup so you do not lose it and to move to another computer.',
              )}
            </p>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                { label: t('Produtos', 'Products'), value: data.products.length },
                { label: t('Vendas', 'Sales'), value: data.sales.length },
                { label: t('Contas', 'Bills'), value: data.accounts.length },
              ].map((x) => (
                <div key={x.label} className="rounded-xl bg-fill/5 px-2 py-2.5">
                  <dd className="display num text-lg font-semibold">{x.value}</dd>
                  <dt className="text-xs text-subtle">{x.label}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-subtle">
              {lastBackup ? `${t('Último backup', 'Last backup')}: ${new Date(lastBackup).toLocaleString(locale())}` : t('Nenhum backup feito ainda.', 'No backup made yet.')}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={doExport}>
                <Download size={16} /> {t('Exportar backup', 'Export backup')}
              </Button>
              <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                <Upload size={16} /> {t('Restaurar backup', 'Restore backup')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void doImport(f)
                }}
              />
            </div>
          </TCard>

          <TCard className="border-bad/30 p-4 sm:p-5">
            <PanelTitle icon={<Database size={18} />} title={t('Dados', 'Data')} subtitle={t('Ações que substituem seus dados atuais', 'Actions that replace your current data')} />
            <p className="mt-4 text-sm text-muted text-pretty">
              {t('A demonstração substitui os dados atuais por um negócio de exemplo. Você pode desfazer logo após.', 'The demo replaces current data with a sample business. You can undo right after.')}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  if (window.confirm(t('Substituir os dados atuais pela demonstração?', 'Replace current data with the demo?'))) {
                    loadDemo()
                  }
                }}
              >
                <Database size={16} /> {t('Carregar demonstração', 'Load demo')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm(t('Apagar todos os dados do negócio neste navegador?', 'Delete all business data in this browser?'))) {
                    resetAll()
                  }
                }}
              >
                <Trash2 size={16} /> {t('Apagar tudo', 'Delete everything')}
              </Button>
            </div>
          </TCard>
        </div>
      </div>
    </div>
  )
}
