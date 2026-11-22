import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { MotionConfig } from 'framer-motion'
import { toast } from 'sonner'
import { TreasuryModal, type TreasuryMode } from '@/components/TreasuryModal'
import { BatchPayModal } from '@/components/BatchPayModal'
import { ChargeModal } from '@/components/ChargeModal'
import { TreasuryHeader } from '@/components/treasury/TreasuryHeader'
import { KpiCards } from '@/components/treasury/KpiCards'
import { QuickActions } from '@/components/treasury/QuickActions'
import { Analytics } from '@/components/treasury/Analytics'
import { NetworkBalances } from '@/components/treasury/NetworkBalances'
import { ActivityTable } from '@/components/treasury/ActivityTable'
import { PaymentQueue } from '@/components/treasury/PaymentQueue'
import { RequestsCard } from '@/components/treasury/RequestsCard'
import { inLastDays, type Period } from '@/components/treasury/shared'
import { useStore } from '@/lib/store'
import { useNav, type Intent } from '@/lib/nav'
import { useShareBase } from '@/lib/invoice'
import { useGatewayBalances } from '@/lib/gateway'
import { useNetwork } from '@/lib/network'
import { requestsForNetwork, treasuryOpsForNetwork } from '@/lib/treasury-selectors'
import { t } from '@/lib/i18n'
import { usdcRateOf } from '@/lib/format'

export function Treasury() {
  const { address, isConnected } = useAccount()
  const { data, updateRequest } = useStore()
  const { payAccountId, requestPay, intent, requestIntent } = useNav()
  const shareBase = useShareBase()
  const gw = useGatewayBalances(address)
  const network = useNetwork()
  // Histórico isolado por ambiente (rede persistida de cada operação/cobrança, não o estado visual atual).
  const visibleOps = treasuryOpsForNetwork(data.treasuryOps, network)
  const visibleRequests = requestsForNetwork(data.requests, network)
  const [mode, setMode] = useState<TreasuryMode | null>(null)
  const [payId, setPayId] = useState<string | null>(null)
  const [batchIds, setBatchIds] = useState<string[] | null>(null)
  const [chargeOpen, setChargeOpen] = useState(false)
  const [chargeAcc, setChargeAcc] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [period, setPeriod] = useState<Period>(30)

  // Abre pagamento em lote ou cobrança quando outra tela pediu.
  const [seenIntent, setSeenIntent] = useState<Intent | null>(null)
  if (intent && intent !== seenIntent) {
    setSeenIntent(intent)
    if (intent.kind === 'batch') setBatchIds(intent.ids)
    else {
      setChargeAcc(intent.accountId)
      setChargeOpen(true)
    }
  } else if (!intent && seenIntent) {
    setSeenIntent(null)
  }
  useEffect(() => {
    if (intent) requestIntent(null)
  }, [intent, requestIntent])

  // Abre o pagamento quando outra tela pediu para pagar uma conta em USDC.
  const [seenPay, setSeenPay] = useState<string | null>(null)
  if (payAccountId && payAccountId !== seenPay) {
    setSeenPay(payAccountId)
    setPayId(payAccountId)
    setMode('spend')
  } else if (!payAccountId && seenPay) {
    setSeenPay(null)
  }
  useEffect(() => {
    if (payAccountId) requestPay(null)
  }, [payAccountId, requestPay])

  const account = payId ? (data.accounts.find((a) => a.id === payId) ?? null) : null
  const contactWallet = account
    ? (data.contacts.find((c) => c.id === account.contactId)?.wallet ?? data.employees.find((e) => e.id === account.employeeId)?.wallet ?? '')
    : ''

  const queue = data.accounts.filter((a) => a.kind === 'payable' && a.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const rate = usdcRateOf(data.settings)
  const appIsUsdc = data.settings.currency === 'USDC'
  const activityCount = visibleOps.filter((o) => inLastDays(o.date, period)).length

  const open = (m: TreasuryMode, id: string | null = null) => {
    setPayId(id)
    setMode(m)
  }
  const close = () => {
    setMode(null)
    setPayId(null)
    void gw.refetch()
  }
  const openCharge = () => {
    setChargeAcc(null)
    setChargeOpen(true)
  }
  const refresh = () => {
    void gw.refetch().then((res) => {
      if (res.isError) toast.error(t('Não foi possível atualizar os saldos agora.', 'Could not refresh balances right now.'))
      else toast.success(t('Saldos atualizados.', 'Balances updated.'))
    })
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-4 sm:space-y-5">
        <TreasuryHeader isConnected={isConnected} address={address} fetching={gw.isFetching} onRefresh={refresh} />

        <KpiCards
          connected={isConnected}
          loading={gw.isLoading}
          failed={gw.isError}
          onRetry={refresh}
          balances={gw.data}
          rate={rate}
          appIsUsdc={appIsUsdc}
          activityCount={activityCount}
          period={period}
        />

        <div className="grid items-stretch gap-4 lg:grid-cols-[1.5fr_1fr] sm:gap-5">
          <div className="order-2 min-w-0 lg:order-1">
            <Analytics ops={visibleOps} requests={visibleRequests} own={address} period={period} onPeriod={setPeriod} />
          </div>
          <div className="order-1 min-w-0 lg:order-2">
            <QuickActions
              enabled={isConnected}
              onDeposit={() => open('deposit')}
              onSend={() => open('spend')}
              onCrossChain={() => open('spend')}
              onCharge={openCharge}
            />
          </div>
        </div>

        <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_1.45fr] sm:gap-5">
          <NetworkBalances connected={isConnected} loading={gw.isLoading} failed={gw.isError} onRetry={refresh} balances={gw.data} />
          <ActivityTable ops={visibleOps} own={address} />
        </div>

        <div className="grid items-stretch gap-4 lg:grid-cols-2 sm:gap-5">
          <PaymentQueue queue={queue} picked={picked} setPicked={setPicked} isConnected={isConnected} rate={rate} onPay={(id) => open('spend', id)} onBatch={setBatchIds} />
          <RequestsCard
            requests={data.requests}
            company={data.settings.company}
            shareBase={shareBase}
            enabled={isConnected}
            onNew={openCharge}
            onCancel={(id) => updateRequest(id, { status: 'canceled' })}
          />
        </div>

        <BatchPayModal
          ids={batchIds}
          balances={gw.data}
          onClose={() => {
            setBatchIds(null)
            setPicked([])
            void gw.refetch()
          }}
        />
        <ChargeModal open={chargeOpen} accountId={chargeAcc} onClose={() => setChargeOpen(false)} />
        <TreasuryModal mode={mode} account={account} balances={gw.data} defaultRecipient={contactWallet} onClose={close} />
      </div>
    </MotionConfig>
  )
}
