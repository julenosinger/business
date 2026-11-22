import { Coins, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, CardTitle } from '@/components/ui'
import { TCard } from '@/components/ds/Panel'
import { daysUntil, fmtDate, money, usdcFmt } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Account } from '@/lib/types'
import type { BatchCancelResult } from '@/lib/store'

interface Props {
  queue: Account[]
  /** Obrigações ainda não preparadas (sem ambiente escolhido). */
  unprepared: Account[]
  /** Contas com pagamento em processamento no ambiente atual (não selecionáveis em lote). */
  inFlight?: Set<string>
  picked: string[]
  setPicked: (ids: string[] | ((prev: string[]) => string[])) => void
  isConnected: boolean
  rate: number | null
  onPay: (id: string) => void
  onPrepare: (id: string) => void
  onBatch: (ids: string[]) => void
  onCancel: (id: string) => void
  onCancelMany: (ids: string[]) => BatchCancelResult
}

export function PaymentQueue({ queue, unprepared, inFlight, picked, setPicked, isConnected, rate, onPay, onPrepare, onBatch, onCancel, onCancelMany }: Props) {
  const eligible = queue.filter((a) => !(inFlight?.has(a.id) ?? false))
  const toggleAll = () => setPicked(picked.length === eligible.length ? [] : eligible.map((a) => a.id))
  const confirmCancel = (a: Account) => {
    if (window.confirm(t(`Cancelar a obrigação "${a.description}" (${money(a.amount)})? A ação é registrada e reversível com Desfazer.`, `Cancel the "${a.description}" obligation (${money(a.amount)})? The action is logged and reversible with Undo.`))) onCancel(a.id)
  }
  const bulkCancel = () => {
    if (picked.length === 0) return
    if (window.confirm(t(`Cancelar ${picked.length} obrigação(ões) selecionada(s)?`, `Cancel ${picked.length} selected obligation(s)?`))) {
      const r = onCancelMany(picked)
      if (r.canceled.length > 0) toast.success(t(`${r.canceled.length} cancelada(s).`, `${r.canceled.length} canceled.`))
      if (r.refused.length > 0) toast.warning(t(`${r.refused.length} recusada(s): vinculadas a outro módulo, já liquidadas ou em processamento.`, `${r.refused.length} refused: linked to another module, already settled, or in progress.`))
      setPicked(r.refused.map((x) => x.id))
    }
  }

  return (
    <TCard className="h-full p-4 sm:p-5">
      <CardTitle
        action={
          queue.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {eligible.length > 0 ? (
                <button className="text-xs font-semibold text-accent hover:underline" onClick={toggleAll}>
                  {picked.length === eligible.length ? t('Limpar', 'Clear') : t('Selecionar todas', 'Select all')}
                </button>
              ) : null}
              {picked.length > 0 ? (
                <button className="text-xs font-semibold text-bad hover:underline" onClick={bulkCancel}>
                  <Trash2 size={12} className="mr-1 inline" />
                  {t(`Excluir ${picked.length}`, `Delete ${picked.length}`)}
                </button>
              ) : null}
              <Button small disabled={!isConnected || picked.length === 0} onClick={() => onBatch(picked)}>
                {t(`Pagar ${picked.length} selecionada(s)`, `Pay ${picked.length} selected`)}
              </Button>
            </div>
          ) : undefined
        }
      >
        {t('Fila de pagamentos', 'Payment queue')}
      </CardTitle>

      {queue.length === 0 ? (
        <p className="text-sm text-muted text-pretty">
          {t('Nenhuma conta a pagar preparada para este ambiente. Prepare um pagamento em Contas a pagar e receber.', 'No payable prepared for this environment. Prepare a payment in Payables and receivables.')}
        </p>
      ) : (
        <ul className="space-y-2">
          {queue.slice(0, 20).map((a) => {
            const d = daysUntil(a.dueDate)
            const busy = inFlight?.has(a.id) ?? false
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-fill/5 p-3">
                <input
                  type="checkbox"
                  aria-label={t('Selecionar conta', 'Select bill')}
                  className="size-4"
                  disabled={busy}
                  checked={picked.includes(a.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{a.description}</div>
                  <div className="text-xs text-subtle">
                    {a.contactName} · {fmtDate(a.dueDate)} {d < 0 ? <Badge tone="bad">{t('em atraso', 'overdue')}</Badge> : null}
                    {busy ? <Badge tone="warn">{t('em processamento', 'processing')}</Badge> : null}
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-sm font-semibold">{money(a.amount)}</div>
                  {rate ? <div className="num text-xs text-subtle">≈ {usdcFmt(a.amount / rate)} USDC</div> : null}
                </div>
                <Button small variant="subtle" disabled={!isConnected || busy} onClick={() => onPay(a.id)}>
                  {t('Pagar', 'Pay')}
                </Button>
                <button
                  aria-label={t('Cancelar obrigação', 'Cancel obligation')}
                  title={t('Cancelar obrigação', 'Cancel obligation')}
                  onClick={() => confirmCancel(a)}
                  className="flex size-9 items-center justify-center rounded-lg text-subtle hover:text-bad"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {unprepared.length > 0 ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="label mb-2">{t('Não preparadas para pagamento', 'Not prepared for payment')}</p>
          <ul className="space-y-2">
            {unprepared.slice(0, 10).map((a) => {
              const d = daysUntil(a.dueDate)
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-fill/5 p-3 opacity-80">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{a.description}</div>
                    <div className="text-xs text-subtle">
                      {a.contactName} · {fmtDate(a.dueDate)} {d < 0 ? <Badge tone="bad">{t('em atraso', 'overdue')}</Badge> : null}
                    </div>
                  </div>
                  <div className="num text-sm font-semibold">{money(a.amount)}</div>
                  <Button small variant="ghost" onClick={() => onPrepare(a.id)}>
                    <Coins size={14} /> {t('Preparar', 'Prepare')}
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </TCard>
  )
}
