import { ExternalLink, HandCoins, Link2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, CardTitle } from '@/components/ui'
import { TCard } from '@/components/ds/Panel'
import { ChainIcon } from '@/components/ChainIcon'
import { chainByKey } from '@/lib/gateway'
import { invoiceLink, requestToInvoice } from '@/lib/invoice'
import { money, usdcFmt } from '@/lib/format'
import { locale, t } from '@/lib/i18n'
import type { PaymentRequest } from '@/lib/types'

interface Props {
  requests: PaymentRequest[]
  company: string
  shareBase: string | null
  enabled: boolean
  onNew: () => void
  onCancel: (id: string) => void
}

export function RequestsCard({ requests, company, shareBase, enabled, onNew, onCancel }: Props) {
  return (
    <TCard className="h-full p-4 sm:p-5">
      <CardTitle
        action={
          <Button small variant="subtle" disabled={!enabled} onClick={onNew}>
            <HandCoins size={14} /> {t('Nova cobrança', 'New request')}
          </Button>
        }
      >
        {t('Cobranças em USDC', 'USDC payment requests')}
      </CardTitle>
      {requests.length === 0 ? (
        <p className="text-sm text-muted text-pretty">
          {t(
            'Crie uma cobrança a partir de uma conta a receber, envie o link ao cliente e acompanhe aqui. Quando o pagamento chega, a conta é baixada sozinha.',
            'Create a request from a receivable, send the link to your customer and follow it here. When the payment arrives, the bill is settled automatically.',
          )}
        </p>
      ) : (
        <ul className="space-y-2">
          {requests.slice(0, 15).map((r) => {
            const link = shareBase ? invoiceLink(shareBase, requestToInvoice(r, company)) : null
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-fill/5 p-3">
                <ChainIcon chainKey={r.chainKey} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.description}</div>
                  <div className="text-xs text-subtle">
                    {chainByKey(r.chainKey)?.label} · {money(r.fiatAmount)} · {new Date(r.createdAt).toLocaleDateString(locale())}
                  </div>
                </div>
                <div className="num text-sm font-semibold">{usdcFmt(r.amount)} USDC</div>
                {r.status === 'open' ? (
                  <Badge tone="warn">{t('Aguardando', 'Waiting')}</Badge>
                ) : r.status === 'paid' ? (
                  <Badge tone="ok">{t('Recebida', 'Received')}</Badge>
                ) : (
                  <Badge>{t('Cancelada', 'Canceled')}</Badge>
                )}
                {r.status === 'open' ? (
                  <>
                    <button
                      disabled={!link}
                      aria-label={t('Copiar link', 'Copy link')}
                      title={t('Copiar link', 'Copy link')}
                      onClick={() => {
                        if (!link) return
                        void navigator.clipboard.writeText(link)
                        toast.success(t('Link copiado.', 'Link copied.'))
                      }}
                      className="flex size-9 items-center justify-center rounded-lg text-accent hover:bg-surface-strong disabled:opacity-40"
                    >
                      <Link2 size={16} />
                    </button>
                    <button
                      aria-label={t('Cancelar cobrança', 'Cancel request')}
                      title={t('Cancelar cobrança', 'Cancel request')}
                      onClick={() => onCancel(r.id)}
                      className="flex size-9 items-center justify-center rounded-lg text-subtle hover:text-bad"
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : null}
                {r.explorerUrl ? (
                  <a href={r.explorerUrl} target="_blank" rel="noopener noreferrer" aria-label={t('Ver no explorer', 'View on explorer')} className="text-accent">
                    <ExternalLink size={14} />
                  </a>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {requests.some((r) => r.status === 'open') ? (
        <p className="mt-3 text-xs text-subtle text-pretty">
          {t(
            'O app confere a rede a cada poucos segundos enquanto estiver aberto. Se fechar, a conferência continua quando você voltar.',
            'The app checks the network every few seconds while open. If you close it, checking resumes when you come back.',
          )}
        </p>
      ) : null}
    </TCard>
  )
}
