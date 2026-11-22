import type { ReactNode } from 'react'
import { Activity, Clock, Database, Wallet } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { money, usdcFmt } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { GatewayBalances } from '@/lib/gateway'
import type { Period } from './shared'
import { KpiTile as Kpi } from '@/components/ds/KpiTile'

interface Props {
  connected: boolean
  loading: boolean
  failed: boolean
  onRetry: () => void
  balances?: GatewayBalances
  rate: number | null
  /** A moeda do app já é USDC: não há equivalente em moeda local para mostrar. */
  appIsUsdc?: boolean
  activityCount: number
  period: Period
}

export function KpiCards({ connected, loading, failed, onRetry, balances, rate, appIsUsdc, activityCount, period }: Props) {
  const confirmed = balances?.total ?? 0
  const pending = balances?.pending ?? null
  const unified = confirmed + (pending ?? 0)
  const ready = connected && !loading && !failed
  const dash = <span className="text-muted">—</span>
  const skeleton = <Skeleton className="h-7 w-24" />
  const pick = (node: ReactNode) => (!connected ? dash : loading ? skeleton : failed ? dash : node)

  const status = !connected ? t('Conecte a carteira', 'Connect your wallet') : failed ? (
    <button onClick={onRetry} className="font-semibold text-bad hover:underline">
      {t('Falha ao consultar. Tentar de novo', 'Failed to load. Retry')}
    </button>
  ) : null

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
      <Kpi
        tone="ok"
        icon={<Wallet size={20} />}
        label={t('Saldo unificado', 'Unified balance')}
        hint={t('Saldo confirmado somado aos depósitos ainda em confirmação, em todas as redes do Circle Gateway. Defina a cotação em Configurações para ver o equivalente em moeda local.', 'Confirmed balance plus deposits still confirming, across all Circle Gateway networks. Set the rate in Settings to see the local currency equivalent.')}
        value={pick(usdcFmt(unified))}
        unit={ready ? 'USDC' : undefined}
        sub={
          status ?? (ready && !appIsUsdc ? (rate ? `≈ ${money(unified * rate)}` : t('Defina a cotação', 'Set the rate')) : undefined)
        }
      />
      <Kpi
        tone="violet"
        icon={<Database size={20} />}
        label={t('Disponível', 'Available')}
        value={pick(usdcFmt(confirmed))}
        unit={ready ? 'USDC' : undefined}
        sub={status ?? (ready ? t('Para novas operações', 'For new operations') : undefined)}
      />
      <Kpi
        tone="warn"
        icon={<Clock size={20} />}
        label={t('Em processamento', 'Processing')}
        hint={t('Depósitos já enviados que o Circle Gateway ainda não confirmou.', 'Deposits already sent that Circle Gateway has not confirmed yet.')}
        value={pick(pending === null ? dash : usdcFmt(pending))}
        unit={ready && pending !== null ? 'USDC' : undefined}
        sub={status ?? (ready ? (pending === null ? t('Indisponível no momento', 'Unavailable right now') : t('Em confirmação', 'Confirming')) : undefined)}
      />
      <Kpi
        tone="sky"
        icon={<Activity size={20} />}
        label={t(`Atividade (${period} dias)`, `Activity (${period} days)`)}
        value={activityCount}
        sub={t('Operações realizadas', 'Operations performed')}
      />
    </div>
  )
}
