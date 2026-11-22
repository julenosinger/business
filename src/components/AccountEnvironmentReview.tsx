import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge, Button, Modal } from '@/components/ui'
import { useStore } from '@/lib/store'
import { canClassifyEnvironment } from '@/lib/treasury-selectors'
import { fmtDate, money } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Account } from '@/lib/types'
import type { NetworkId } from '@/lib/network'

function sourceLabel(source: Account['source']): string {
  switch (source) {
    case 'sale':
      return t('Venda', 'Sale')
    case 'purchase':
      return t('Compra', 'Purchase')
    case 'payroll':
      return t('Folha', 'Payroll')
    default:
      return t('Manual', 'Manual')
  }
}

function blockReason(reason: string): string {
  switch (reason) {
    case 'settled':
      return t('Liquidada: não reclassificável.', 'Settled: not reclassifiable.')
    case 'active_intent':
      return t('Pagamento em processamento.', 'Payment in progress.')
    case 'conflicting_evidence':
      return t('Evidência on-chain conflitante.', 'Conflicting on-chain evidence.')
    default:
      return t('Não reclassificável.', 'Not reclassifiable.')
  }
}

/**
 * Seção administrativa (discreta) para revisar obrigações legadas sem ambiente financeiro definido
 * (`unassigned`). Só aparece quando há registros nessa situação e permite atribuição EXPLÍCITA a
 * Mainnet ou Testnet — nunca infere pela rede atualmente selecionada.
 */
export function AccountEnvironmentReview() {
  const { data, setAccountEnvironment } = useStore()
  const [open, setOpen] = useState(false)

  const unassigned = data.accounts.filter((a) => !a.environment || a.environment === 'unassigned')
  if (unassigned.length === 0) return null

  const chainsOf = (id: string): string[] => [...new Set(data.treasuryOps.filter((o) => o.accountId === id).map((o) => o.chain).filter(Boolean))]

  const classify = (a: Account, env: NetworkId) => {
    if (!window.confirm(t(`Definir o ambiente "${a.description}" como ${env === 'mainnet' ? 'Mainnet' : 'Testnet'}? Esta ação fica registrada na auditoria.`, `Set the "${a.description}" obligation environment to ${env === 'mainnet' ? 'Mainnet' : 'Testnet'}? This action is recorded in the audit trail.`))) return
    setAccountEnvironment(a.id, env)
  }

  const eligible = (a: Account, env: NetworkId): boolean => canClassifyEnvironment(a, data.treasuryOps, env).ok

  return (
    <>
      <div className="tcard flex flex-wrap items-center gap-3 !border-warn/40 !bg-warn/10 p-4 text-sm" role="status">
        <AlertTriangle size={18} className="text-warn" />
        <p className="min-w-0 flex-1 text-pretty">
          {t(
            `${unassigned.length} obrigação(ões) legada(s) sem ambiente financeiro definido. Elas ficam fora dos totais de Mainnet/Testnet até a revisão.`,
            `${unassigned.length} legacy obligation(s) without a defined financial environment. They stay out of the Mainnet/Testnet totals until reviewed.`,
          )}
        </p>
        <Button small variant="ghost" onClick={() => setOpen(true)}>
          {t('Revisar', 'Review')}
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('Revisar ambiente de obrigações legadas', 'Review legacy obligation environments')}>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {t('Atribua cada obrigação ao ambiente financeiro correto. A ação exige confirmação e fica registrada na auditoria.', 'Assign each obligation to the correct financial environment. The action requires confirmation and is recorded in the audit trail.')}
          </p>
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {unassigned.map((a) => {
              const chains = chainsOf(a.id)
              const canMain = eligible(a, 'mainnet')
              const canTest = eligible(a, 'testnet')
              const bothBlocked = !canMain && !canTest
              const reason = bothBlocked ? (canClassifyEnvironment(a, data.treasuryOps, 'mainnet') as { reason: string }).reason : null
              return (
                <li key={a.id} className="rounded-xl border border-line bg-fill/5 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{a.description}</div>
                      <div className="text-xs text-subtle">
                        {a.contactName} · {sourceLabel(a.source)} · {fmtDate(a.dueDate)}
                      </div>
                      {chains.length > 0 ? (
                        <div className="mt-1 text-xs text-subtle">
                          {t('Evidência', 'Evidence')}: {chains.join(', ')}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-subtle">{t('Sem evidência on-chain.', 'No on-chain evidence.')}</div>
                      )}
                      {reason ? <div className="mt-1 text-xs text-bad">{blockReason(reason)}</div> : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`num text-sm font-semibold ${a.kind === 'payable' ? 'text-bad' : 'text-ok'}`}>{money(a.amount)}</div>
                      <Badge tone="warn">{t('Sem ambiente', 'No environment')}</Badge>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <Button small variant="subtle" disabled={!canMain} onClick={() => classify(a, 'mainnet')}>
                      {t('Atribuir Mainnet', 'Assign Mainnet')}
                    </Button>
                    <Button small variant="subtle" disabled={!canTest} onClick={() => classify(a, 'testnet')}>
                      {t('Atribuir Testnet', 'Assign Testnet')}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </Modal>
    </>
  )
}
