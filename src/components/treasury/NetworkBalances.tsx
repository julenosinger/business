import { useState } from 'react'
import { AlertCircle, ChevronDown, Layers } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { Bar } from '@/components/charts'
import { ChainIcon } from '@/components/ChainIcon'
import { gatewayChainsFor, type GatewayBalances } from '@/lib/gateway'
import { useNetwork } from '@/lib/network'
import { usdcFmt } from '@/lib/format'
import { t } from '@/lib/i18n'
import { PanelTitle, TCard } from '@/components/ds/Panel'

interface Props {
  connected: boolean
  loading: boolean
  failed: boolean
  onRetry: () => void
  balances?: GatewayBalances
}

interface Row {
  key: string
  label: string
  amount: number
}

const INITIAL = 5

export function NetworkBalances({ connected, loading, failed, onRetry, balances }: Props) {
  const [expanded, setExpanded] = useState(false)
  const network = useNetwork()
  const total = balances?.total ?? 0

  // Somente redes do ambiente ativo (isolamento estrito Mainnet/Testnet); saldo zero quando o Gateway não retorna.
  const chains = gatewayChainsFor(network)
  const known = new Map((balances?.byChain ?? []).map((b) => [b.key, b.amount]))
  const rows: Row[] = [
    ...chains.map((c) => ({ key: c.key, label: c.label, amount: known.get(c.key) ?? 0 })),
    ...(balances?.byChain ?? []).filter((b) => !chains.some((c) => c.key === b.key)).map((b) => ({ key: b.key, label: b.label, amount: b.amount })),
  ]
  const positive = rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount)
  const zero = rows.filter((r) => r.amount <= 0)
  const ordered = [...positive, ...zero]
  const visible = expanded ? ordered : ordered.slice(0, Math.max(INITIAL, positive.length))
  const hidden = ordered.length - visible.length
  const ready = connected && !loading && !failed

  return (
    <TCard className="flex h-full flex-col p-4 sm:p-5">
      <PanelTitle
        icon={<Layers size={18} />}
        title={t('Saldos por rede (USDC)', 'Balances by network (USDC)')}
        subtitle={t('Distribuição da liquidez', 'Liquidity distribution')}
        action={
          ready ? (
            <span className="num shrink-0 rounded-lg border border-line bg-fill/10 px-2.5 py-1 text-xs font-semibold">
              {t('Total', 'Total')}: {usdcFmt(total)} USDC
            </span>
          ) : undefined
        }
      />

      <div className="mt-4 flex-1">
        {!connected ? (
          <p className="py-8 text-center text-sm text-muted">{t('Conecte a carteira para ver os saldos.', 'Connect your wallet to see balances.')}</p>
        ) : loading ? (
          <ul className="space-y-4" aria-busy="true">
            {Array.from({ length: INITIAL }, (_, i) => (
              <li key={i} className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-1 w-full" />
              </li>
            ))}
          </ul>
        ) : failed ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm">
            <AlertCircle size={20} className="text-bad" />
            <p className="text-muted">{t('Não foi possível consultar os saldos agora.', 'Could not fetch balances right now.')}</p>
            <button onClick={onRetry} className="font-semibold text-sky hover:underline">
              {t('Tentar de novo', 'Try again')}
            </button>
          </div>
        ) : (
          <ul className={`space-y-3.5 ${expanded ? 'max-h-[340px] overflow-y-auto pr-1' : ''}`}>
            {visible.map((r) => {
              const share = total > 0 ? (r.amount / total) * 100 : null
              return (
                <li key={r.key}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ChainIcon chainKey={r.key} size={26} />
                      <span className="truncate font-medium">{r.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className={`num ${r.amount > 0 ? 'font-semibold' : 'text-muted'}`}>{usdcFmt(r.amount)} USDC</span>
                      <span className="num w-9 text-right text-xs text-subtle">{share === null ? '0%' : `${share < 1 && r.amount > 0 ? '<1' : Math.round(share)}%`}</span>
                    </span>
                  </div>
                  <Bar value={r.amount} max={total > 0 ? total : 1} />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {ready && (hidden > 0 || expanded) ? (
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-4 flex min-h-10 w-full items-center justify-center gap-1.5 border-t border-line pt-3 text-sm font-semibold text-sky hover:underline"
        >
          {expanded ? t('Mostrar menos', 'Show less') : t(`Mostrar todas as redes (${ordered.length})`, `Show all networks (${ordered.length})`)}
          <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
        </button>
      ) : null}
    </TCard>
  )
}
