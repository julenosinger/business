import { useState } from 'react'
import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi, type EIP1193Provider } from 'viem'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { CheckCircle2, Copy, ExternalLink, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card } from '@/components/ui'
import { ChainIcon } from '@/components/ChainIcon'
import { Toggles } from '@/components/Layout'
import { appKit, chainByKey, explainError } from '@/lib/gateway'
import type { Invoice } from '@/lib/invoice'
import { t } from '@/lib/i18n'
import { usdcFmt } from '@/lib/format'
import { Amount } from '@/onchain-money'
import { USDC_DECIMALS, buildTxExplorerUrl, getUsdc } from '@/onchain-facts'

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

export function InvalidInvoice() {
  return (
    <Shell>
      <Card>
        <p className="display text-lg font-semibold">{t('Link de cobrança inválido', 'Invalid payment link')}</p>
        <p className="mt-2 text-sm text-muted text-pretty">
          {t('Peça um novo link a quem enviou a cobrança. Nenhum valor foi cobrado.', 'Ask the sender for a new link. Nothing was charged.')}
        </p>
      </Card>
    </Shell>
  )
}

export function PayPage({ invoice }: { invoice: Invoice }) {
  const chain = chainByKey(invoice.ch)
  const usdc = chain ? getUsdc(chain.chainId) : undefined
  const { address, chainId, isConnected, connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [hash, setHash] = useState<`0x${string}` | undefined>()
  const [directDone, setDirectDone] = useState<{ txHash: string; explorerUrl?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const receipt = useWaitForTransactionReceipt({ hash, chainId: chain?.chainId })
  const isDirect = invoice.rail === 'gateway_direct' && Boolean(invoice.dp)

  const raw = Amount.parse(invoice.amt, USDC_DECIMALS).raw
  const balance = useReadContract({
    address: usdc?.address as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: chain?.chainId,
    query: { enabled: Boolean(address && usdc && chain) },
  })
  const insufficient = balance.data !== undefined && balance.data < raw

  if (!chain || !usdc) return <InvalidInvoice />

  const pay = async () => {
    setError(null)
    setBusy(true)
    try {
      if (chainId !== chain.chainId) await switchChainAsync({ chainId: chain.chainId })
      if (isDirect) {
        if (!connector) throw new Error(t('Carteira não conectada', 'Wallet not connected'))
        const provider = (await connector.getProvider()) as EIP1193Provider
        const adapter = await createViemAdapterFromProvider({ provider })
        const res = await appKit.unifiedBalance.depositFor({ from: { adapter, chain: invoice.ch }, amount: invoice.amt, depositAccount: invoice.dp! })
        setDirectDone({ txHash: res.txHash, explorerUrl: res.explorerUrl })
      } else {
        const tx = await writeContractAsync({
          address: usdc.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [invoice.to as `0x${string}`, raw],
          chainId: chain.chainId,
        })
        setHash(tx)
      }
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  const done = directDone !== null || receipt.isSuccess
  const confirming = Boolean(hash) && !done && !receipt.isError
  const successUrl = directDone ? (directDone.explorerUrl ?? buildTxExplorerUrl(chain.chainId, directDone.txHash)) : hash ? buildTxExplorerUrl(chain.chainId, hash) : null
  const displayRecipient = isDirect ? (invoice.dp ?? invoice.to) : invoice.to

  return (
    <Shell>
      <Card className="space-y-5">
        <div>
          <div className="label">{t('Cobrança de', 'Payment request from')}</div>
          <p className="display mt-1 text-xl font-semibold">{invoice.who || t('Comerciante', 'Merchant')}</p>
          {invoice.desc ? <p className="mt-1 text-sm text-muted text-pretty">{invoice.desc}</p> : null}
        </div>

        <div className="rounded-2xl bg-fill/5 p-4">
          <div className="label">{t('Valor a pagar', 'Amount due')}</div>
          <div className="display num mt-1 text-4xl font-semibold">
            {usdcFmt(invoice.amt)} <span className="text-lg text-muted">USDC</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm text-muted">
            <ChainIcon chainKey={invoice.ch} size={18} /> {chain.label}
          </div>
        </div>

        <div>
          <div className="label mb-1">{isDirect ? t('Conta creditada (depósito Gateway)', 'Credited account (Gateway deposit)') : t('Carteira de destino', 'Destination wallet')}</div>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(displayRecipient)
              toast.success(t('Endereço copiado.', 'Address copied.'))
            }}
            className="mono flex w-full items-start gap-2 rounded-xl border border-line px-3 py-2 text-left text-xs break-all hover:bg-surface-strong"
          >
            <Copy size={14} className="mt-0.5 shrink-0" /> {displayRecipient}
          </button>
          <p className="mt-2 flex items-start gap-2 text-xs text-subtle text-pretty">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            {isDirect
              ? t('O depósito é feito pelo contrato oficial Circle Gateway, creditando esta conta.', 'The deposit goes through the official Circle Gateway contract, crediting this account.')
              : t('Confira se o endereço e o valor são os que você espera antes de assinar.', 'Check that the address and amount are what you expect before signing.')}
          </p>
        </div>

        {done ? (
          <div className="space-y-3 text-center">
            <CheckCircle2 size={44} className="mx-auto text-ok" />
            <p className="display text-lg font-semibold">{t('Pagamento confirmado', 'Payment confirmed')}</p>
            {successUrl ? (
              <a
                href={successUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
              >
                {t('Ver comprovante no explorer', 'View receipt on explorer')} <ExternalLink size={14} />
              </a>
            ) : null}
          </div>
        ) : !isConnected ? (
          <div className="flex justify-center">
            <ConnectKitButton label={t('Conectar carteira para pagar', 'Connect wallet to pay')} />
          </div>
        ) : (
          <div className="space-y-3">
            {insufficient ? (
              <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">
                {t('Saldo de USDC insuficiente nesta rede.', 'Not enough USDC on this network.')}
              </p>
            ) : null}
            {error ? <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{error}</p> : null}
            {receipt.isError ? <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{t('A transação falhou na rede.', 'The transaction failed onchain.')}</p> : null}
            {confirming ? (
              <p className="flex items-center gap-2 rounded-xl bg-accent/10 p-3 text-sm text-accent" aria-live="polite">
                <Loader2 size={16} className="animate-spin" /> {t('Aguardando confirmação na rede...', 'Waiting for network confirmation...')}
              </p>
            ) : null}
            <Button className="w-full" disabled={busy || confirming || insufficient} onClick={() => void pay()}>
              {busy ? t('Confirme na carteira...', 'Confirm in your wallet...') : t(`Pagar ${usdcFmt(invoice.amt)} USDC`, `Pay ${usdcFmt(invoice.amt)} USDC`)}
            </Button>
          </div>
        )}
      </Card>
    </Shell>
  )
}
