import { useEffect, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { ChainIcon } from '@/components/ChainIcon'
import { Card } from '@/components/ui'
import { Toggles } from '@/components/Layout'
import { chainByKey } from '@/lib/gateway'
import { getPublicCheckoutApi, type PublicCheckout } from '@/lib/payment-api'
import { t } from '@/lib/i18n'
import { usdcFmt } from '@/lib/format'
import { Amount } from '@/onchain-money'
import { USDC_DECIMALS } from '@/onchain-facts'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh px-4 py-6">
      <div className="mx-auto flex max-w-md items-center justify-between pb-4">
        <span className="display text-sm font-semibold text-muted">Global Business OS</span>
        <Toggles />
      </div>
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  )
}

function stateLabel(state: string): string {
  switch (state) {
    case 'CREATED':
      return t('Aguardando pagamento', 'Awaiting payment')
    case 'SUBMITTED':
      return t('Aguardando reconhecimento', 'Awaiting recognition')
    case 'EXPIRED':
      return t('Expirado', 'Expired')
    case 'CANCELED':
      return t('Cancelado', 'Canceled')
    case 'REQUIRES_REVIEW':
      return t('Requer revisão', 'Requires review')
    default:
      return state
  }
}

export function GatewayCheckoutPage({ token }: { token: string }) {
  const [checkout, setCheckout] = useState<PublicCheckout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seed, setSeed] = useState<string | null>(null)

  // Reinicializa o estado ao trocar de token (padrão de estado derivado).
  if (seed !== token) {
    setSeed(token)
    setCheckout(null)
    setError(null)
  }

  useEffect(() => {
    const controller = new AbortController()
    void getPublicCheckoutApi(token, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setCheckout(data)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('checkout_unavailable')
      })
    return () => controller.abort()
  }, [token])

  const loading = checkout === null && error === null

  if (loading) {
    return (
      <Shell>
        <Card className="space-y-3 py-8 text-center text-sm text-muted">{t('Carregando cobrança…', 'Loading payment request…')}</Card>
      </Shell>
    )
  }

  if (error || !checkout) {
    return (
      <Shell>
        <Card>
          <p className="display text-lg font-semibold">{t('Link de cobrança inválido', 'Invalid payment link')}</p>
          <p className="mt-2 text-sm text-muted text-pretty">{t('Peça um novo link a quem enviou a cobrança.', 'Ask the sender for a new link.')}</p>
        </Card>
      </Shell>
    )
  }

  const usdcText = usdcFmt(Amount.parse(checkout.usdcMinor, USDC_DECIMALS).toString())
  const chain = chainByKey(checkout.environment === 'mainnet' ? 'Arc' : 'Arc_Testnet')

  return (
    <Shell>
      <Card className="space-y-5">
        <div>
          <div className="label">{t('Cobrança de', 'Payment request from')}</div>
          <p className="display mt-1 text-xl font-semibold">{checkout.company || t('Comerciante', 'Merchant')}</p>
          {checkout.description ? <p className="mt-1 text-sm text-muted text-pretty">{checkout.description}</p> : null}
          {checkout.reference ? <p className="mt-1 text-xs text-subtle">#{checkout.reference}</p> : null}
        </div>

        <div className="rounded-2xl bg-fill/5 p-4">
          <div className="label">{t('Valor a pagar', 'Amount due')}</div>
          <div className="display num mt-1 text-4xl font-semibold">
            {usdcText} <span className="text-lg text-muted">USDC</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm text-muted">
            {chain ? <ChainIcon chainKey={chain.key} size={18} /> : null} {chain?.label ?? checkout.environment}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm">
          <span className="text-muted">{t('Status', 'Status')}</span>
          <span className="font-semibold">{stateLabel(checkout.state)}</span>
        </div>

        <div className="flex justify-center">
          <ConnectKitButton label={t('Conectar carteira para pagar', 'Connect wallet to pay')} />
        </div>

        <p className="text-center text-xs text-subtle text-pretty">
          {t(
            'O pagamento será confirmado somente após verificação independente do depósito Circle Gateway.',
            'Payment will be confirmed only after independent verification of the Circle Gateway deposit.',
          )}
        </p>
      </Card>
    </Shell>
  )
}
