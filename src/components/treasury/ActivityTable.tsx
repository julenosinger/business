import { useState } from 'react'
import { ArrowRight, Copy, ExternalLink, Layers, ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui'
import { ChainIcon } from '@/components/ChainIcon'
import { chainByKey } from '@/lib/gateway'
import { shortAddr, usdcFmt } from '@/lib/format'
import { locale, t } from '@/lib/i18n'
import type { TreasuryOp } from '@/lib/types'
import { sameAddress } from './shared'
import { PanelTitle, TCard } from './TCard'

const PAGE = 8

function kindLabel(op: TreasuryOp, own?: string): string {
  if (op.kind === 'deposit') return t('Depósito', 'Deposit')
  return sameAddress(op.recipient, own) ? t('Transferência entre redes', 'Cross-chain transfer') : t('Pagamento', 'Payment')
}

function Route({ op }: { op: TreasuryOp }) {
  const from = chainByKey(op.chain)?.label ?? op.chain
  const to = op.destChain ? (chainByKey(op.destChain)?.label ?? op.destChain) : null
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <ChainIcon chainKey={op.chain} size={14} /> {from}
      {to ? (
        <>
          <ArrowRight size={12} className="text-subtle" />
          <ChainIcon chainKey={op.destChain ?? ''} size={14} /> {to}
        </>
      ) : null}
    </span>
  )
}

const whenDate = (iso: string) => new Date(iso).toLocaleDateString(locale())
const whenTime = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
const when = (iso: string) => new Date(iso).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })

/** Os registros guardam a operação depois que o SDK retorna; a liquidação final não é reverificada aqui. */
function StatusBadge() {
  return (
    <span title={t('Registrada pelo app quando o SDK retornou. A liquidação final não é reverificada nesta tela.', 'Recorded by the app when the SDK returned. Final settlement is not re-verified on this screen.')}>
      <Badge tone="accent">{t('Registrada', 'Recorded')}</Badge>
    </span>
  )
}

function Actions({ op }: { op: TreasuryOp }) {
  return (
    <span className="flex items-center gap-0.5">
      {op.txHash ? (
        <button
          aria-label={t('Copiar hash da transação', 'Copy transaction hash')}
          title={op.txHash}
          onClick={() => {
            void navigator.clipboard.writeText(op.txHash ?? '')
            toast.success(t('Hash copiado.', 'Hash copied.'))
          }}
          className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-strong hover:text-ink"
        >
          <Copy size={14} />
        </button>
      ) : null}
      {op.explorerUrl ? (
        <a
          href={op.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('Ver no explorer', 'View on explorer')}
          title={t('Ver no explorer', 'View on explorer')}
          className="flex size-8 items-center justify-center rounded-lg text-accent hover:bg-surface-strong"
        >
          <ExternalLink size={14} />
        </a>
      ) : null}
    </span>
  )
}

export function ActivityTable({ ops, own }: { ops: TreasuryOp[]; own?: string }) {
  const [shown, setShown] = useState(PAGE)
  const list = ops.slice(0, shown)
  const head = (
    <tr className="text-left text-[12px] text-muted">
      <th className="py-3 pl-5 pr-2 font-medium">{t('Operação', 'Operation')}</th>
      <th className="min-w-[110px] px-2 py-3 font-medium">{t('Rede (origem → destino)', 'Network (origin → destination)')}</th>
      <th className="whitespace-nowrap px-2 py-3 text-right font-medium">{t('Valor (USDC)', 'Amount (USDC)')}</th>
      <th className="whitespace-nowrap px-2 py-3 font-medium">{t('Data e hora', 'Date and time')}</th>
      <th className="py-3 pl-2 pr-5 font-medium">Status</th>
    </tr>
  )

  return (
    <TCard className="flex h-full flex-col">
      <div className="p-4 pb-3 sm:p-5 sm:pb-3">
        <PanelTitle
          icon={<ListChecks size={18} />}
          title={t('Atividade recente', 'Recent activity')}
          subtitle={t('Últimas operações da tesouraria', 'Latest treasury operations')}
          action={
            <button
              disabled={ops.length <= PAGE}
              onClick={() => setShown(shown >= ops.length ? PAGE : ops.length)}
              className="flex shrink-0 items-center gap-1 text-sm font-semibold text-sky hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-70"
            >
              {shown >= ops.length && ops.length > PAGE ? t('Ver menos', 'View less') : t('Ver todas', 'View all')} <ArrowRight size={14} />
            </button>
          }
        />
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[540px] text-sm">
          <thead className="border-b border-line">{head}</thead>
          <tbody className="[&_tr]:border-t [&_tr]:border-line first:[&_tr]:border-t-0">
            {list.map((op) => (
              <tr key={op.id}>
                <td className="py-3 pl-5 pr-2">
                  <div className="font-medium">{kindLabel(op, own)}</div>
                  <div className="max-w-[150px] truncate text-xs text-subtle">
                    {op.note}
                    {op.recipient ? ` · ${shortAddr(op.recipient)}` : ''}
                  </div>
                </td>
                <td className="px-2 py-3">
                  <Route op={op} />
                </td>
                <td className="num px-2 py-3 text-right font-semibold">{usdcFmt(op.amount)}</td>
                <td className="num whitespace-nowrap px-2 py-3 text-xs text-muted">
                  <div>{whenDate(op.date)}</div>
                  <div className="text-subtle">{whenTime(op.date)}</div>
                </td>
                <td className="py-3 pl-2 pr-5">
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge />
                    <Actions op={op} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ops.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
          <Layers size={38} className="mb-1 text-subtle" strokeWidth={1.3} />
          <p className="text-sm font-semibold">{t('Nenhuma operação registrada', 'No operations recorded')}</p>
          <p className="max-w-sm text-xs text-subtle text-pretty">
            {t('Depósitos, envios, transferências entre redes e cobranças aparecerão aqui.', 'Deposits, transfers, cross-chain moves and payment requests will appear here.')}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line md:hidden">
          {list.map((op) => (
            <li key={op.id} className="space-y-1.5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{kindLabel(op, own)}</div>
                  <div className="truncate text-xs text-subtle">{op.note}</div>
                </div>
                <div className="num shrink-0 text-sm font-semibold">{usdcFmt(op.amount)} USDC</div>
              </div>
              <Route op={op} />
              <div className="flex items-center justify-between gap-2">
                <span className="num text-xs text-muted">{when(op.date)}</span>
                <span className="flex items-center gap-1">
                  <StatusBadge />
                  <Actions op={op} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {ops.length > shown ? (
        <div className="mt-auto border-t border-line p-3 text-center">
          <button onClick={() => setShown((n) => n + PAGE)} className="text-sm font-semibold text-sky hover:underline">
            {t('Ver mais', 'View more')} ({ops.length - shown})
          </button>
        </div>
      ) : null}
    </TCard>
  )
}
