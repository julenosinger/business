import { useRef, useState } from 'react'
import { Database, Download, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardTitle, Field, PageHeader, inputCls } from '@/components/ui'
import { useStore } from '@/lib/store'
import { parseNum } from '@/lib/format'
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
    <div>
      <PageHeader title={t('Configurações', 'Settings')} subtitle={t('Dados da empresa, moeda e parâmetros da tesouraria.', 'Company details, currency and treasury parameters.')} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>{t('Empresa', 'Company')}</CardTitle>
          <div className="space-y-3">
            <Field label={t('Nome da empresa', 'Company name')}>
              <input className={inputCls} value={s.company} onChange={(e) => updateSettings({ company: e.target.value })} />
            </Field>
            <Field label={t('Filial', 'Branch')}>
              <input className={inputCls} value={s.branch} onChange={(e) => updateSettings({ branch: e.target.value })} />
            </Field>
            <Field label={t('Responsável', 'Owner')}>
              <input className={inputCls} value={s.owner} onChange={(e) => updateSettings({ owner: e.target.value })} />
            </Field>
            <Field label={t('Moeda de exibição', 'Display currency')} hint={t('Troca apenas o símbolo. Os valores não são convertidos.', 'Only changes the symbol. Amounts are not converted.')}>
              <select className={inputCls} value={s.currency} onChange={(e) => updateSettings({ currency: e.target.value as CurrencyCode })}>
                <option value="BRL">{t('Real (BRL)', 'Brazilian real (BRL)')}</option>
                <option value="USD">{t('Dólar (USD)', 'US dollar (USD)')}</option>
                <option value="EUR">Euro (EUR)</option>
              </select>
            </Field>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle>{t('Tesouraria', 'Treasury')}</CardTitle>
            <Field
              label={t(`Cotação: ${s.currency} por 1 USDC`, `Rate: ${s.currency} per 1 USDC`)}
              hint={t('Opcional. Você define o valor. Usado para sugerir o valor em USDC ao pagar contas.', 'Optional. You set the value. Used to suggest the USDC amount when paying bills.')}
            >
              <div className="flex gap-2">
                <input className={inputCls} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={t('Ex.: informe sua cotação', 'E.g. enter your rate')} />
                <Button onClick={saveRate}>{t('Salvar', 'Save')}</Button>
              </div>
            </Field>
            <div className="mt-4">
              <Field
                label={t('Limite de segurança (USDC)', 'Safety limit (USDC)')}
                hint={t('Opcional. Envios acima deste valor pedem uma confirmação extra antes de assinar.', 'Optional. Transfers above this amount ask for an extra confirmation before signing.')}
              >
                <div className="flex gap-2">
                  <input className={inputCls} inputMode="decimal" value={limitText} onChange={(e) => setLimitText(e.target.value)} placeholder="Ex.: 1000" />
                  <Button onClick={saveLimit}>{t('Salvar', 'Save')}</Button>
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <CardTitle>{t('Backup', 'Backup')}</CardTitle>
            <p className="mb-4 text-sm text-muted text-pretty">
              {t(
                'Seus dados ficam salvos só neste navegador. Exporte um backup para não perdê-los e para levar para outro computador.',
                'Your data is saved only in this browser. Export a backup so you do not lose it and to move to another computer.',
              )}
            </p>
            <p className="mb-4 text-xs text-subtle">
              {lastBackup
                ? `${t('Último backup', 'Last backup')}: ${new Date(lastBackup).toLocaleString(locale())}`
                : t('Nenhum backup feito ainda.', 'No backup made yet.')}
            </p>
            <div className="flex flex-wrap gap-2">
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
          </Card>

          <Card>
            <CardTitle>{t('Dados', 'Data')}</CardTitle>
            <p className="mb-4 text-sm text-muted text-pretty">
              {t('A demonstração substitui os dados atuais por um negócio de exemplo. Você pode desfazer logo após.', 'The demo replaces current data with a sample business. You can undo right after.')}
            </p>
            <div className="flex flex-wrap gap-2">
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
          </Card>
        </div>
      </div>
    </div>
  )
}
