import { useState } from 'react'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { erc20Abi, type EIP1193Provider } from 'viem'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { ArrowRight, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button, Field, Modal, inputCls } from '@/components/ui'
import { ChainIcon } from '@/components/ChainIcon'
import { GATEWAY_CHAINS, appKit, chainByKey, explainError, isValidAddress, type GatewayBalances, type GatewayChainId } from '@/lib/gateway'
import { arcGatewayKeyOf, useNetwork } from '@/lib/network'
import { useStore } from '@/lib/store'
import { Amount, parseAmount } from '@/onchain-money'
import { USDC_DECIMALS, getUsdc } from '@/onchain-facts'
import { money, toUsdc, usdcFmt, usdcRateOf } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Account } from '@/lib/types'

export type TreasuryMode = 'deposit' | 'spend'

interface Props {
  mode: TreasuryMode | null
  account: Account | null
  balances: GatewayBalances | undefined
  defaultRecipient: string
  onClose: () => void
}

type Phase = { kind: 'idle' } | { kind: 'working'; label: string } | { kind: 'done'; url?: string; hash?: string } | { kind: 'error'; message: string }

function tryParse(chainId: number, value: string): Amount | null {
  const v = value.trim().replace(',', '.')
  if (!v) return null
  try {
    const a = parseAmount(chainId, v)
    return a.isPositive() ? a : null
  } catch {
    return null
  }
}

function ChainSelect({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: { key: string; label: string }[] }) {
  return (
    <Field label={label}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
          <ChainIcon chainKey={value} size={20} />
        </span>
        <select className={`${inputCls} pl-10`} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    </Field>
  )
}

export function TreasuryModal({ mode, account, balances, defaultRecipient, onClose }: Props) {
  const { address, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { data, addTreasuryOp, updateContact, updateEmployee } = useStore()
  const network = useNetwork()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [amountText, setAmountText] = useState('')
  const [chainKey, setChainKey] = useState<string>(arcGatewayKeyOf(network))
  const [destKey, setDestKey] = useState<string>(arcGatewayKeyOf(network))
  const [recipient, setRecipient] = useState('')
  const [seed, setSeed] = useState<string | null>(null)
  const [saveWallet, setSaveWallet] = useState(true)
  const [confirmed, setConfirmed] = useState(false)

  const seedKey = mode ? `${mode}:${account?.id ?? ''}` : null
  if (seedKey !== seed) {
    setSeed(seedKey)
    setPhase({ kind: 'idle' })
    setConfirmed(false)
    setSaveWallet(true)
    const rate = usdcRateOf(data.settings)
    setAmountText(account && rate && rate > 0 ? toUsdc(account.amount, rate).toFixed(2) : '')
    setRecipient(defaultRecipient)
    const best = balances?.byChain[0]?.key
    setChainKey(mode === 'spend' && best ? best : arcGatewayKeyOf(network))
    setDestKey(arcGatewayKeyOf(network))
  }

  const origin = chainByKey(chainKey) ?? GATEWAY_CHAINS[0]
  const usdc = origin ? getUsdc(origin.chainId) : undefined
  const walletBalance = useReadContract({
    address: usdc?.address as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: origin?.chainId,
    query: { enabled: mode === 'deposit' && Boolean(address && usdc && origin) },
  })

  if (!origin) return null
  const walletAmt = walletBalance.data !== undefined ? Amount.fromRaw(walletBalance.data, USDC_DECIMALS) : null
  const gatewayRow = balances?.byChain.find((b) => b.key === chainKey)
  const available = mode === 'deposit' ? walletAmt : (gatewayRow?.exact ?? Amount.zero(USDC_DECIMALS))
  const amount = tryParse(origin.chainId, amountText)
  const overBalance = Boolean(amount && available && amount.gt(available))
  const recipientOk = mode === 'deposit' || isValidAddress(recipient.trim())
  const limit = data.settings.approvalLimit
  const needsConfirm = Boolean(mode === 'spend' && limit && amount && Number(amount.toString()) > limit)
  const newWallet = Boolean(mode === 'spend' && account && recipientOk && recipient.trim() !== '' && recipient.trim().toLowerCase() !== defaultRecipient.toLowerCase())
  const canRun = Boolean(address && connector && amount && !overBalance && recipientOk && (!needsConfirm || confirmed)) && phase.kind !== 'working'
  const spendChains = (balances?.byChain ?? []).filter((b) => b.amount > 0)
  const destChain = chainByKey(destKey)

  const getAdapter = async (requiredChainId: GatewayChainId) => {
    if (!connector) throw new Error(t('Carteira não conectada', 'Wallet not connected'))
    if (chainId !== requiredChainId) await switchChainAsync({ chainId: requiredChainId })
    const provider = (await connector.getProvider()) as EIP1193Provider
    return createViemAdapterFromProvider({ provider })
  }

  const run = async () => {
    if (!amount || !mode) return
    const amountStr = amount.toString()
    try {
      setPhase({ kind: 'working', label: t('Confirme na sua carteira e aguarde a confirmação...', 'Confirm in your wallet and wait for confirmation...') })
      const adapter = await getAdapter(origin.chainId)
      if (mode === 'deposit') {
        const res = await appKit.unifiedBalance.deposit({ from: { adapter, chain: origin.key }, amount: amountStr })
        addTreasuryOp({ kind: 'deposit', chain: origin.key, amount: amountStr, txHash: res.txHash, explorerUrl: res.explorerUrl, status: 'pending', wallet: address, note: t('Depósito no saldo unificado', 'Deposit into unified balance') })
        setPhase({ kind: 'done', url: res.explorerUrl, hash: res.txHash })
      } else {
        if (!destChain) {
          setPhase({ kind: 'error', message: t('Rede de destino inválida.', 'Invalid destination network.') })
          return
        }
        const to = recipient.trim()
        const res = await appKit.unifiedBalance.spend({
          from: { adapter, allocations: { amount: amountStr, chain: origin.key } },
          to: { chain: destChain.key, recipientAddress: to, useForwarder: true },
          amount: amountStr,
        })
        // A resposta do SDK prova a SUBMISSÃO, não a liquidação final: registra como pendente.
        // A baixa da conta só ocorre após verificação independente (verifyAndSettle).
        addTreasuryOp({
          kind: 'spend',
          chain: origin.key,
          destChain: destChain.key,
          amount: amountStr,
          txHash: res.txHash,
          explorerUrl: res.explorerUrl,
          recipient: to,
          accountId: account?.id,
          status: 'pending',
          wallet: address,
          ...(res.transferId ? { transferId: res.transferId } : {}),
          note: account ? account.description : t('Envio de USDC', 'USDC transfer'),
        })
        if (account && newWallet && saveWallet) {
          if (account.employeeId) updateEmployee(account.employeeId, { wallet: to })
          else if (account.contactId) updateContact(account.contactId, { wallet: to })
        }
        setPhase({ kind: 'done', url: res.explorerUrl, hash: res.txHash })
      }
    } catch (err) {
      setPhase({ kind: 'error', message: explainError(err) })
    }
  }

  const title =
    mode === 'deposit' ? t('Depositar na tesouraria', 'Deposit to treasury') : account ? t('Pagar conta em USDC', 'Pay bill in USDC') : t('Enviar USDC', 'Send USDC')

  return (
    <Modal open={mode !== null} onClose={phase.kind === 'working' ? () => undefined : onClose} title={title}>
      {phase.kind === 'done' ? (
        <div className="space-y-4 text-center">
          <CheckCircle2 size={44} className="mx-auto text-ok" />
          <p className="display text-lg font-semibold">{mode === 'deposit' ? t('Depósito concluído', 'Deposit complete') : t('Pagamento enviado', 'Payment sent')}</p>
          <p className="text-sm text-muted">
            {usdcFmt(amount?.toString() ?? amountText)} USDC{' '}
            {mode === 'spend' && account
              ? t('submetido. A liquidação aguarda confirmação na rede antes de baixar a conta.', 'submitted. Settlement awaits on-chain confirmation before the bill is settled.')
              : t('registrados na tesouraria.', 'recorded in the treasury.')}
          </p>
          {phase.url ? (
            <a href={phase.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
              {t('Ver no explorer', 'View on explorer')} <ExternalLink size={14} />
            </a>
          ) : null}
          <Button className="w-full" onClick={onClose}>
            {t('Concluir', 'Done')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {account ? (
            <div className="rounded-xl border border-line bg-fill/5 p-3 text-sm">
              <div className="font-semibold">{account.description}</div>
              <div className="text-xs text-subtle">
                {account.contactName} · {money(account.amount)}
                {usdcRateOf(data.settings) ? '' : t(' · defina a cotação em Configurações para converter automaticamente', ' · set the rate in Settings to convert automatically')}
              </div>
            </div>
          ) : null}

          {mode === 'deposit' ? (
            <ChainSelect label={t('Rede de origem', 'Source network')} value={chainKey} onChange={setChainKey} options={GATEWAY_CHAINS} />
          ) : spendChains.length ? (
            <ChainSelect label={t('Debitar saldo da rede', 'Debit balance from network')} value={chainKey} onChange={setChainKey} options={spendChains} />
          ) : (
            <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">{t('Você ainda não tem saldo unificado. Faça um depósito antes de enviar.', 'You have no unified balance yet. Make a deposit before sending.')}</p>
          )}

          {mode === 'spend' ? (
            <>
              <ChainSelect label={t('Rede de destino', 'Destination network')} value={destKey} onChange={setDestKey} options={GATEWAY_CHAINS} />
              <Field label={t('Carteira do destinatário', 'Recipient wallet')} hint={recipient && !recipientOk ? t('Endereço inválido.', 'Invalid address.') : undefined}>
                <input className={`${inputCls} mono`} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." />
              </Field>
            </>
          ) : null}

          {newWallet && account && (account.contactId || account.employeeId) ? (
            <label className="flex items-start gap-2 text-sm text-muted">
              <input type="checkbox" className="mt-1" checked={saveWallet} onChange={(e) => setSaveWallet(e.target.checked)} />
              {t(`Salvar esta carteira no cadastro de ${account.contactName}.`, `Save this wallet to ${account.contactName}'s record.`)}
            </label>
          ) : null}

          <Field
            label={t('Valor em USDC', 'Amount in USDC')}
            hint={
              overBalance
                ? t('Valor maior que o saldo disponível.', 'Amount exceeds the available balance.')
                : available
                  ? `${t('Disponível', 'Available')}: ${usdcFmt(available.toString())} USDC${mode === 'spend' ? t('. Deixe uma margem para as taxas.', '. Leave a margin for fees.') : ''}`
                  : t('Carregando saldo da carteira...', 'Loading wallet balance...')
            }
          >
            <div className="flex gap-2">
              <input className={inputCls} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0,00" />
              <Button variant="ghost" disabled={!available} onClick={() => available && setAmountText(available.toString())}>
                Max
              </Button>
            </div>
          </Field>

          <dl className="space-y-2 rounded-xl bg-fill/5 p-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('Operação', 'Operation')}</dt>
              <dd className="flex items-center gap-1.5 font-semibold">
                <ChainIcon chainKey={chainKey} size={16} /> {origin.label}
                {mode === 'spend' ? (
                  <>
                    <ArrowRight size={14} className="text-subtle" />
                    <ChainIcon chainKey={destKey} size={16} /> {destChain?.label}
                  </>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('Valor', 'Amount')}</dt>
              <dd className="num font-semibold">{amount ? `${usdcFmt(amount.toString())} USDC` : '-'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('Taxas e prazo', 'Fees and timing')}</dt>
              <dd className="text-right text-xs text-muted">{mode === 'spend' ? t('Calculadas pela Circle no envio', 'Calculated by Circle at send time') : t('Apenas gas da rede de origem', 'Source network gas only')}</dd>
            </div>
          </dl>

          {needsConfirm ? (
            <label className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span className="text-pretty">
                {t(
                  `Este envio está acima do seu limite de segurança de ${usdcFmt(limit ?? 0)} USDC. Conferi a carteira e o valor.`,
                  `This transfer is above your safety limit of ${usdcFmt(limit ?? 0)} USDC. I checked the wallet and amount.`,
                )}
              </span>
            </label>
          ) : null}

          {phase.kind === 'error' ? <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{phase.message}</p> : null}
          {phase.kind === 'working' ? (
            <p className="flex items-center gap-2 rounded-xl bg-accent/10 p-3 text-sm text-accent" aria-live="polite">
              <Loader2 size={16} className="animate-spin" /> {phase.label}
            </p>
          ) : null}

          <Button className="w-full" disabled={!canRun || (mode === 'spend' && spendChains.length === 0)} onClick={() => void run()}>
            {mode === 'deposit' ? t('Depositar', 'Deposit') : t('Enviar USDC', 'Send USDC')}
          </Button>
        </div>
      )}
    </Modal>
  )
}
