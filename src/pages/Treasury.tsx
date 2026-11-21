import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { TokenUSDC } from '@web3icons/react'
import { ArrowDownToLine, ArrowLeftRight, Copy, ExternalLink, HandCoins, Landmark, Link2, RefreshCw, Send, Wallet, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, CardTitle, Empty, PageHeader } from '@/components/ui'
import { Bar } from '@/components/charts'
import { ChainIcon } from '@/components/ChainIcon'
import { TreasuryModal, type TreasuryMode } from '@/components/TreasuryModal'
import { BatchPayModal } from '@/components/BatchPayModal'
import { ChargeModal } from '@/components/ChargeModal'
import { useStore } from '@/lib/store'
import { useNav, type Intent } from '@/lib/nav'
import { invoiceLink, requestToInvoice, useShareBase } from '@/lib/invoice'
import { chainByKey, useGatewayBalances } from '@/lib/gateway'
import { fmtDate, daysUntil, money, shortAddr, usdcFmt } from '@/lib/format'
import { locale, t } from '@/lib/i18n'

export function Treasury() {
  const { address, isConnected } = useAccount()
  const { data, updateRequest } = useStore()
  const { payAccountId, requestPay, intent, requestIntent } = useNav()
  const shareBase = useShareBase()
  const [batchIds, setBatchIds] = useState<string[] | null>(null)
  const [chargeOpen, setChargeOpen] = useState(false)
  const [chargeAcc, setChargeAcc] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
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
  const gw = useGatewayBalances(address)
  const [mode, setMode] = useState<TreasuryMode | null>(null)
  const [payId, setPayId] = useState<string | null>(null)

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
  const total = gw.data?.total ?? 0
  const rate = data.settings.usdcRate
  const max = Math.max(...(gw.data?.byChain.map((b) => b.amount) ?? [0]), 1)

  const open = (m: TreasuryMode, id: string | null = null) => {
    setPayId(id)
    setMode(m)
  }
  const close = () => {
    setMode(null)
    setPayId(null)
    void gw.refetch()
  }

  return (
    <div>
      <PageHeader
        title={t('Tesouraria global', 'Global treasury')}
        subtitle={t('Saldo unificado em USDC com Circle Gateway. Deposite em qualquer rede e pague fornecedores e funcionários em outra, a partir da sua carteira.', 'Unified USDC balance with Circle Gateway. Deposit on any network and pay suppliers and employees on another, straight from your wallet.')}
        actions={
          <ConnectKitButton.Custom>
            {({ isConnected: c, show, address: a }) => (
              <Button variant="ghost" onClick={show}>
                <Wallet size={16} /> {c && a ? shortAddr(a) : t('Conectar carteira', 'Connect wallet')}
              </Button>
            )}
          </ConnectKitButton.Custom>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <div className="flex items-center justify-between">
            <span className="label flex items-center gap-2">
              <TokenUSDC variant="branded" size={16} /> {t('Saldo total', 'Total balance')}
            </span>
            <Badge tone="accent">Circle Gateway · Testnet</Badge>
          </div>
          {!isConnected ? (
            <div className="py-6">
              <p className="display text-2xl font-semibold">{t('Conecte sua carteira', 'Connect your wallet')}</p>
              <p className="mt-1 max-w-md text-sm text-muted text-pretty">
                {t('A tesouraria é não custodial: os fundos ficam sob o controle da sua carteira e cada operação pede sua assinatura.', 'The treasury is non-custodial: funds stay under your wallet control and every operation asks for your signature.')}
              </p>
              <div className="mt-4">
                <ConnectKitButton />
              </div>
            </div>
          ) : (
            <>
              <div className="display num mt-2 text-4xl font-semibold sm:text-5xl">{gw.isLoading ? '...' : usdcFmt(total)} <span className="text-xl text-muted">USDC</span></div>
              <div className="mt-1 text-sm text-muted">
                {rate ? `≈ ${money(total * rate)}` : t('Defina a cotação USDC em Configurações para ver o equivalente em moeda local.', 'Set the USDC rate in Settings to see the local currency equivalent.')}
              </div>
              {gw.isError ? <div className="mt-2 text-sm text-bad">{t('Não foi possível consultar o saldo agora. Tente atualizar.', 'Could not fetch the balance right now. Try refreshing.')}</div> : null}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={() => open('deposit')}>
                  <ArrowDownToLine size={16} /> {t('Depositar', 'Deposit')}
                </Button>
                <Button variant="subtle" onClick={() => open('spend')}>
                  <Send size={16} /> {t('Enviar', 'Send')}
                </Button>
                <Button variant="subtle" onClick={() => open('spend')}>
                  <ArrowLeftRight size={16} /> {t('Entre redes', 'Cross-chain')}
                </Button>
                <Button
                  variant="subtle"
                  onClick={() => {
                    setChargeAcc(null)
                    setChargeOpen(true)
                  }}
                >
                  <HandCoins size={16} /> {t('Cobrar em USDC', 'Charge in USDC')}
                </Button>
                <Button variant="ghost" onClick={() => void gw.refetch()} disabled={gw.isFetching} aria-label={t('Atualizar saldo', 'Refresh balance')}>
                  <RefreshCw size={16} className={gw.isFetching ? 'animate-spin' : ''} />
                </Button>
              </div>
              {address ? (
                <button
                  className="mono mt-4 inline-flex items-center gap-2 rounded-lg bg-fill/5 px-3 py-2 text-xs text-muted hover:text-ink"
                  onClick={() => {
                    void navigator.clipboard.writeText(address)
                    toast.success(t('Endereço copiado. Use-o para receber USDC.', 'Address copied. Use it to receive USDC.'))
                  }}
                >
                  <Copy size={12} /> {t('Receber', 'Receive')}: {shortAddr(address)}
                </button>
              ) : null}
            </>
          )}
        </Card>

        <Card>
          <CardTitle>{t('Saldo por rede', 'Balance by network')}</CardTitle>
          {!isConnected ? (
            <p className="text-sm text-muted">{t('Conecte a carteira para ver os saldos.', 'Connect your wallet to see balances.')}</p>
          ) : gw.data && gw.data.byChain.length > 0 ? (
            <ul className="space-y-4">
              {gw.data.byChain.map((b) => (
                <li key={b.key}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <ChainIcon chainKey={b.key} size={18} /> {b.label}
                    </span>
                    <span className="num font-semibold">{usdcFmt(b.amount)}</span>
                  </div>
                  <Bar value={b.amount} max={max} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon={<Landmark size={22} />}
              title={t('Saldo unificado vazio', 'Unified balance is empty')}
              text={t('Use Get test USDC na barra lateral do Arc Studio para receber USDC de teste, depois deposite aqui.', 'Use Get test USDC in the Arc Studio sidebar to get test USDC, then deposit it here.')}
            />
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
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
                  <Button small disabled={!isConnected || picked.length === 0} onClick={() => setBatchIds(picked)}>
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
                return (
                  <li key={a.id} className="flex items-center gap-3 rounded-xl bg-fill/5 p-3">
                    {queue.length > 1 ? (
                      <input
                        type="checkbox"
                        aria-label={t('Selecionar conta', 'Select bill')}
                        className="size-4"
                        checked={picked.includes(a.id)}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{a.description}</div>
                      <div className="text-xs text-subtle">
                        {a.contactName} · {fmtDate(a.dueDate)} {d < 0 ? t('· em atraso', '· overdue') : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num text-sm font-semibold">{money(a.amount)}</div>
                      {rate ? <div className="num text-xs text-subtle">≈ {usdcFmt(a.amount / rate)} USDC</div> : null}
                    </div>
                    <Button small variant="subtle" disabled={!isConnected} onClick={() => open('spend', a.id)}>
                      {t('Pagar', 'Pay')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('Histórico de operações', 'Operations history')}</CardTitle>
          {data.treasuryOps.length === 0 ? (
            <p className="text-sm text-muted">{t('Depósitos e pagamentos feitos aqui aparecem neste histórico, com link para o explorer.', 'Deposits and payments made here appear in this history, with an explorer link.')}</p>
          ) : (
            <ul className="space-y-2">
              {data.treasuryOps.slice(0, 10).map((op) => (
                <li key={op.id} className="flex items-center gap-3 rounded-xl bg-fill/5 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {op.kind === 'deposit' ? t('Depósito', 'Deposit') : t('Pagamento', 'Payment')}
                      <span className="flex items-center gap-1 text-xs font-normal text-subtle">
                        <ChainIcon chainKey={op.chain} size={12} /> {chainByKey(op.chain)?.label}
                        {op.destChain ? ` → ${chainByKey(op.destChain)?.label}` : ''}
                      </span>
                    </div>
                    <div className="truncate text-xs text-subtle">
                      {op.note}
                      {op.recipient ? ` · ${shortAddr(op.recipient)}` : ''} · {new Date(op.date).toLocaleDateString(locale())}
                    </div>
                  </div>
                  <div className="num text-sm font-semibold">{usdcFmt(op.amount)} USDC</div>
                  {op.explorerUrl ? (
                    <a href={op.explorerUrl} target="_blank" rel="noopener noreferrer" aria-label={t('Ver no explorer', 'View on explorer')} className="text-accent">
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardTitle
          action={
            <Button
              small
              variant="subtle"
              onClick={() => {
                setChargeAcc(null)
                setChargeOpen(true)
              }}
            >
              <HandCoins size={14} /> {t('Nova cobrança', 'New request')}
            </Button>
          }
        >
          {t('Cobranças em USDC', 'USDC payment requests')}
        </CardTitle>
        {data.requests.length === 0 ? (
          <p className="text-sm text-muted text-pretty">
            {t(
              'Crie uma cobrança a partir de uma conta a receber, envie o link ao cliente e acompanhe aqui. Quando o pagamento chega, a conta é baixada sozinha.',
              'Create a request from a receivable, send the link to your customer and follow it here. When the payment arrives, the bill is settled automatically.',
            )}
          </p>
        ) : (
          <ul className="space-y-2">
            {data.requests.slice(0, 15).map((r) => {
              const link = shareBase ? invoiceLink(shareBase, requestToInvoice(r, data.settings.company)) : null
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
                  {r.status === 'open' ? <Badge tone="warn">{t('Aguardando', 'Waiting')}</Badge> : r.status === 'paid' ? <Badge tone="ok">{t('Recebida', 'Received')}</Badge> : <Badge>{t('Cancelada', 'Canceled')}</Badge>}
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
                        onClick={() => updateRequest(r.id, { status: 'canceled' })}
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
        {data.requests.some((r) => r.status === 'open') ? (
          <p className="mt-3 text-xs text-subtle text-pretty">
            {t('O app confere a rede a cada poucos segundos enquanto estiver aberto. Se fechar, a conferência continua quando você voltar.', 'The app checks the network every few seconds while open. If you close it, checking resumes when you come back.')}
          </p>
        ) : null}
      </Card>

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
  )
}
