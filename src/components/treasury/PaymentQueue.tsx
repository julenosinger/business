import { Badge, Button, CardTitle } from '@/components/ui'
import { TCard } from '@/components/ds/Panel'
import { daysUntil, fmtDate, money, usdcFmt } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Account } from '@/lib/types'

interface Props {
  queue: Account[]
  /** Contas com pagamento em processamento no ambiente atual (não selecionáveis em lote). */
  inFlight?: Set<string>
  picked: string[]
  setPicked: (ids: string[] | ((prev: string[]) => string[])) => void
  isConnected: boolean
  rate: number | null
  onPay: (id: string) => void
  onBatch: (ids: string[]) => void
}

export function PaymentQueue({ queue, inFlight, picked, setPicked, isConnected, rate, onPay, onBatch }: Props) {
  return (
    <TCard className="h-full p-4 sm:p-5">
      <CardTitle
        action={
          queue.length > 1 ? (
            <div className="flex items-center gap-2">
              <button
                className="text-xs font-semibold text-accent hover:underline"
                onClick={() => setPicked(picked.length === queue.length ? [] : queue.map((q) => q.id))}
              >
                {picked.length === queue.length ? t('Limpar', 'Clear') : t('Selecionar todas', 'Select all')}
              </button>
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
        <p className="text-sm text-muted">{t('Nenhuma conta a pagar em aberto.', 'No open payables.')}</p>
      ) : (
        <ul className="space-y-2">
          {queue.slice(0, 20).map((a) => {
            const d = daysUntil(a.dueDate)
            const busy = inFlight?.has(a.id) ?? false
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-fill/5 p-3">
                {queue.length > 1 ? (
                  <input
                    type="checkbox"
                    aria-label={t('Selecionar conta', 'Select bill')}
                    className="size-4"
                    disabled={busy}
                    checked={picked.includes(a.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))}
                  />
                ) : null}
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
                <Button small variant="subtle" disabled={!isConnected} onClick={() => onPay(a.id)}>
                  {t('Pagar', 'Pay')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </TCard>
  )
}
