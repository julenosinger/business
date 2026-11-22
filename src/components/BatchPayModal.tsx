import { useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import type { EIP1193Provider } from 'viem'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { Button, Field, Modal, inputCls } from '@/components/ui'
import { ChainIcon } from '@/components/ChainIcon'
import { GATEWAY_CHAINS, appKit, chainByKey, explainError, isValidAddress, type GatewayBalances } from '@/lib/gateway'
import { arcGatewayKeyOf, useNetwork } from '@/lib/network'
import { useStore } from '@/lib/store'
import { money, shortAddr, toUsdc, usdcFmt, usdcRateOf } from '@/lib/format'
import { t } from '@/lib/i18n'
import { Amount } from '@/onchain-money'
import { USDC_DECIMALS } from '@/onchain-facts'

interface Row {
  id: string
  title: string
  party: string
  fiat: number
  wallet: string
  amountText: string
  status: 'idle' | 'working' | 'done' | 'error'
  error?: string
  url?: string
}

function parseUsdc(value: string): Amount | null {
  try {
    const a = Amount.parse(value.trim().replace(',', '.'), USDC_DECIMALS)
    return a.isPositive() ? a : null
  } catch {
    return null
  }
}

const wasRejected = (err: unknown) => /user rejected|rejected the request|denied/i.test(err instanceof Error ? err.message : String(err))

export function BatchPayModal({ ids, balances, onClose }: { ids: string[] | null; balances: GatewayBalances | undefined; onClose: () => void }) {
  const { address, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { data, addTreasuryOp, updateContact, updateEmployee } = useStore()
  const network = useNetwork()
  const [rows, setRows] = useState<Row[]>([])
  const [originKey, setOriginKey] = useState<string>(arcGatewayKeyOf(network))
  const [destKey, setDestKey] = useState<string>(arcGatewayKeyOf(network))
  const [saveWallets, setSaveWallets] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [running, setRunning] = useState(false)
  const [seed, setSeed] = useState<string | null>(null)
  const rate = usdcRateOf(data.settings)

  const seedKey = ids ? ids.join(',') : null
  if (seedKey !== seed) {
    setSeed(seedKey)
    setConfirmed(false)
    setRunning(false)
    setDestKey(arcGatewayKeyOf(network))
    setOriginKey(balances?.byChain[0]?.key ?? arcGatewayKeyOf(network))
    setRows(
      (ids ?? []).flatMap((id) => {
        const a = data.accounts.find((x) => x.id === id && x.kind === 'payable' && x.status === 'open')
        if (!a) return []
        const wallet = data.contacts.find((c) => c.id === a.contactId)?.wallet ?? data.employees.find((e) => e.id === a.employeeId)?.wallet ?? ''
        return [
          {
            id: a.id,
            title: a.description,
            party: a.contactName,
            fiat: a.amount,
            wallet,
            amountText: rate ? toUsdc(a.amount, rate).toFixed(2) : '',
            status: 'idle' as const,
          },
        ]
      }),
    )
  }

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const pending = rows.filter((r) => r.status !== 'done')
  const amounts = pending.map((r) => parseUsdc(r.amountText))
  const total = amounts.reduce<Amount>((s, a) => (a ? s.add(a) : s), Amount.zero(USDC_DECIMALS))
  const available = balances?.byChain.find((b) => b.key === originKey)?.exact ?? Amount.zero(USDC_DECIMALS)
  const rowsValid = pending.length > 0 && pending.every((r, i) => amounts[i] && isValidAddress(r.wallet.trim()))
  const overBalance = total.gt(available)
  const limit = data.settings.approvalLimit
  const needsConfirm = Boolean(limit && Number(total.toString()) > limit)
  const origin = chainByKey(originKey)
  const canRun = Boolean(address && connector && rowsValid && !overBalance && !running && (!needsConfirm || confirmed))
  const spendChains = (balances?.byChain ?? []).filter((b) => b.amount > 0)

  const run = async () => {
    if (!connector || !origin) return
    const destChain = chainByKey(destKey)
    if (!destChain) return
    setRunning(true)
    try {
      if (chainId !== origin.chainId) await switchChainAsync({ chainId: origin.chainId })
      const provider = (await connector.getProvider()) as EIP1193Provider
      const adapter = await createViemAdapterFromProvider({ provider })
      for (const row of rows) {
        if (row.status === 'done') continue
        const amount = parseUsdc(row.amountText)
        if (!amount) continue
        const wallet = row.wallet.trim()
        patch(row.id, { status: 'working', error: undefined })
        try {
          const amountStr = amount.toString()
          const res = await appKit.unifiedBalance.spend({
            from: { adapter, allocations: { amount: amountStr, chain: origin.key } },
            to: { chain: destChain.key, recipientAddress: wallet, useForwarder: true },
            amount: amountStr,
          })
          const account = data.accounts.find((a) => a.id === row.id)
          // A resposta do SDK prova a SUBMISSÃO, não a liquidação: registra como pendente.
          // A baixa da conta só ocorre após verificação independente (verifyAndSettle).
          addTreasuryOp({
            kind: 'spend',
            chain: origin.key,
            destChain: destChain.key,
            amount: amountStr,
            txHash: res.txHash,
            explorerUrl: res.explorerUrl,
            recipient: wallet,
            accountId: row.id,
            status: 'pending',
            wallet: address,
            ...(res.transferId ? { transferId: res.transferId } : {}),
            note: row.title,
          })
          if (saveWallets && account) {
            if (account.employeeId) updateEmployee(account.employeeId, { wallet })
            else if (account.contactId) updateContact(account.contactId, { wallet })
          }
          patch(row.id, { status: 'done', url: res.explorerUrl })
        } catch (err) {
          patch(row.id, { status: 'error', error: explainError(err) })
          if (wasRejected(err)) break
        }
      }
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.status === 'working' ? { ...r, status: 'error', error: explainError(err) } : r)))
    } finally {
      setRunning(false)
    }
  }

  const doneCount = rows.filter((r) => r.status === 'done').length
  const failed = rows.some((r) => r.status === 'error')

  return (
    <Modal open={ids !== null} onClose={running ? () => undefined : onClose} title={t('Pagar em lote', 'Pay in batch')} wide>
      <div className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{t('Nenhuma conta a pagar selecionada.', 'No payables selected.')}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Debitar saldo da rede', 'Debit balance from network')}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                    <ChainIcon chainKey={originKey} size={20} />
                  </span>
                  <select className={`${inputCls} pl-10`} value={originKey} onChange={(e) => setOriginKey(e.target.value)} disabled={running}>
                    {(spendChains.length ? spendChains : GATEWAY_CHAINS).map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
              <Field label={t('Pagar na rede', 'Pay on network')}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                    <ChainIcon chainKey={destKey} size={20} />
                  </span>
                  <select className={`${inputCls} pl-10`} value={destKey} onChange={(e) => setDestKey(e.target.value)} disabled={running}>
                    {GATEWAY_CHAINS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            </div>

            <ul className="space-y-2">
              {rows.map((r) => {
                const walletOk = isValidAddress(r.wallet.trim())
                return (
                  <li key={r.id} className="rounded-xl border border-line bg-fill/5 p-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5">
                        {r.status === 'done' ? (
                          <CheckCircle2 size={18} className="text-ok" />
                        ) : r.status === 'error' ? (
                          <XCircle size={18} className="text-bad" />
                        ) : r.status === 'working' ? (
                          <Loader2 size={18} className="animate-spin text-accent" />
                        ) : (
                          <Circle size={18} className="text-subtle" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{r.title}</div>
                        <div className="text-xs text-subtle">
                          {r.party} · {money(r.fiat)}
                        </div>
                        {r.status === 'done' ? (
                          <div className="mt-1 flex items-center gap-2 text-xs text-ok">
                            {usdcFmt(r.amountText)} USDC → <span className="mono">{shortAddr(r.wallet)}</span>
                            {r.url ? (
                              <a href={r.url} target="_blank" rel="noopener noreferrer" aria-label={t('Ver no explorer', 'View on explorer')} className="text-accent">
                                <ExternalLink size={12} />
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_130px]">
                            <input
                              className={`${inputCls} mono !min-h-10 text-xs`}
                              value={r.wallet}
                              onChange={(e) => patch(r.id, { wallet: e.target.value })}
                              placeholder={t('Carteira do destinatário (0x...)', 'Recipient wallet (0x...)')}
                              aria-label={t('Carteira do destinatário', 'Recipient wallet')}
                              disabled={running}
                            />
                            <input
                              className={`${inputCls} !min-h-10`}
                              inputMode="decimal"
                              value={r.amountText}
                              onChange={(e) => patch(r.id, { amountText: e.target.value })}
                              placeholder="USDC"
                              aria-label={t('Valor em USDC', 'Amount in USDC')}
                              disabled={running}
                            />
                          </div>
                        )}
                        {r.status === 'idle' && r.wallet.trim() !== '' && !walletOk ? <p className="mt-1 text-xs text-bad">{t('Endereço inválido.', 'Invalid address.')}</p> : null}
                        {r.error ? <p className="mt-1 text-xs text-bad">{r.error}</p> : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>

            <dl className="space-y-2 rounded-xl bg-fill/5 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t('Total a enviar', 'Total to send')}</dt>
                <dd className="num font-semibold">{usdcFmt(total.toString())} USDC</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t('Disponível na rede', 'Available on network')}</dt>
                <dd className="num">{usdcFmt(available.toString())} USDC</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{t('Rota', 'Route')}</dt>
                <dd className="flex items-center gap-1.5 text-xs font-semibold">
                  {origin?.label} <ArrowRight size={12} className="text-subtle" /> {chainByKey(destKey)?.label}
                </dd>
              </div>
            </dl>

            {overBalance ? (
              <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">
                {t('O total passa do saldo disponível nesta rede. Deixe também uma margem para as taxas.', 'The total exceeds the balance on this network. Leave a margin for fees as well.')}
              </p>
            ) : null}

            <label className="flex items-start gap-2 text-sm text-muted">
              <input type="checkbox" className="mt-1" checked={saveWallets} onChange={(e) => setSaveWallets(e.target.checked)} />
              {t('Salvar as carteiras informadas no cadastro de cada fornecedor ou funcionário.', 'Save the entered wallets to each supplier or employee record.')}
            </label>

            {needsConfirm ? (
              <label className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
                <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span className="text-pretty">
                  <AlertTriangle size={14} className="mr-1 inline text-warn" />
                  {t(
                    `Este lote soma ${usdcFmt(total.toString())} USDC, acima do seu limite de segurança de ${usdcFmt(limit ?? 0)} USDC. Conferi os destinatários e valores.`,
                    `This batch totals ${usdcFmt(total.toString())} USDC, above your safety limit of ${usdcFmt(limit ?? 0)} USDC. I checked the recipients and amounts.`,
                  )}
                </span>
              </label>
            ) : null}

            <p className="text-xs text-subtle text-pretty">
              {t(
                'Os pagamentos são enviados um a um e cada um pede a sua assinatura na carteira. Se um falhar, os demais continuam e você pode tentar de novo só o que faltou.',
                'Payments are sent one by one and each asks for your wallet signature. If one fails, the others continue and you can retry only what is left.',
              )}
            </p>

            {doneCount > 0 ? (
              <p className="text-sm text-ok" aria-live="polite">
                {t(`${doneCount} de ${rows.length} pagamento(s) concluído(s).`, `${doneCount} of ${rows.length} payment(s) completed.`)}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={running}>
                {pending.length === 0 ? t('Concluir', 'Done') : t('Fechar', 'Close')}
              </Button>
              {pending.length > 0 ? (
                <Button disabled={!canRun} onClick={() => void run()}>
                  {running ? <Loader2 size={16} className="animate-spin" /> : null}
                  {failed ? t('Tentar de novo', 'Retry') : t(`Pagar ${pending.length} conta(s)`, `Pay ${pending.length} bill(s)`)}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
