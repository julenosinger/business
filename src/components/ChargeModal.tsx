import { useState } from 'react'
import { useAccount } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import { CheckCircle2, Copy, Loader2, MessageCircle, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { config } from '@/config'
import { Button, Field, Modal, inputCls } from '@/components/ui'
import { ChainIcon } from '@/components/ChainIcon'
import { GATEWAY_CHAINS, chainByKey, explainError } from '@/lib/gateway'
import { invoiceLink, requestToInvoice, useShareBase } from '@/lib/invoice'
import { useStore } from '@/lib/store'
import { money, parseNum, today, usdcFmt } from '@/lib/format'
import { t } from '@/lib/i18n'
import { Amount } from '@/onchain-money'
import { USDC_DECIMALS } from '@/onchain-facts'

interface Props {
  open: boolean
  /** Conta a receber já escolhida (ex.: vindo da tela de contas). */
  accountId: string | null
  onClose: () => void
}

const NEW = '__new__'

/** Soma uma marca única (100 a 999 unidades mínimas) para identificar o pagamento sem memo. */
function withTag(base: Amount, taken: Set<bigint>): Amount {
  for (let i = 0; i < 50; i++) {
    const tag = BigInt(100 + Math.floor(Math.random() * 900))
    const candidate = Amount.fromRaw(base.raw + tag, USDC_DECIMALS)
    if (!taken.has(candidate.raw)) return candidate
  }
  return Amount.fromRaw(base.raw + 100n, USDC_DECIMALS)
}

export function ChargeModal({ open, accountId, onClose }: Props) {
  const { address } = useAccount()
  const { data, addAccount, addRequest } = useStore()
  const base = useShareBase()
  const receivables = data.accounts.filter((a) => a.kind === 'receivable' && a.status === 'open')
  const rate = data.settings.usdcRate

  const [selected, setSelected] = useState('')
  const [desc, setDesc] = useState('')
  const [fiat, setFiat] = useState('')
  const [usdcText, setUsdcText] = useState('')
  const [chainKey, setChainKey] = useState('Arc_Testnet')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const created = createdId ? (data.requests.find((r) => r.id === createdId) ?? null) : null
  const [seed, setSeed] = useState<string | null>(null)

  const seedKey = open ? `open:${accountId ?? ''}` : null
  if (seedKey !== seed) {
    setSeed(seedKey)
    setCreatedId(null)
    setError(null)
    setDesc('')
    setFiat('')
    const acc = accountId ? receivables.find((a) => a.id === accountId) : undefined
    setSelected(acc ? acc.id : receivables[0] ? receivables[0].id : NEW)
    setUsdcText(acc && rate ? (Math.ceil((acc.amount / rate) * 100) / 100).toFixed(2) : '')
  }

  const account = receivables.find((a) => a.id === selected)
  const fiatValue = selected === NEW ? parseNum(fiat) : (account?.amount ?? 0)

  const pickAccount = (id: string) => {
    setSelected(id)
    const acc = receivables.find((a) => a.id === id)
    if (acc && rate) setUsdcText((Math.ceil((acc.amount / rate) * 100) / 100).toFixed(2))
  }

  const onFiat = (v: string) => {
    setFiat(v)
    const n = parseNum(v)
    if (rate && n > 0) setUsdcText((Math.ceil((n / rate) * 100) / 100).toFixed(2))
  }

  let baseAmount: Amount | null = null
  try {
    const parsed = Amount.parse(usdcText.trim().replace(',', '.'), USDC_DECIMALS)
    baseAmount = parsed.isPositive() ? parsed : null
  } catch {
    baseAmount = null
  }
  const chain = chainByKey(chainKey)
  const valid = Boolean(address && baseAmount && chain && fiatValue > 0 && (selected !== NEW || desc.trim()))

  const create = async () => {
    if (!address || !baseAmount || !chain) return
    setError(null)
    setBusy(true)
    try {
      const client = getPublicClient(config, { chainId: chain.chainId })
      if (!client) throw new Error(t('Rede indisponível.', 'Network unavailable.'))
      const head = await client.getBlockNumber()
      const taken = new Set(
        data.requests
          .filter((r) => r.status === 'open' && r.chainKey === chainKey && r.recipient.toLowerCase() === address.toLowerCase())
          .map((r) => Amount.parse(r.amount, USDC_DECIMALS).raw),
      )
      const exact = withTag(baseAmount, taken)
      const description = selected === NEW ? desc.trim() : (account?.description ?? '')
      const accId =
        selected === NEW
          ? addAccount({
              kind: 'receivable',
              description,
              contactName: t('Cobrança avulsa', 'One-off charge'),
              amount: fiatValue,
              dueDate: today(),
              category: 'Serviços prestados',
            })
          : selected
      const id = addRequest({
        accountId: accId,
        description,
        fiatAmount: fiatValue,
        amount: exact.toString(),
        chainKey,
        chainId: chain.chainId,
        recipient: address,
        fromBlock: head.toString(),
      })
      setCreatedId(id)
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  const link = created && base ? invoiceLink(base, requestToInvoice(created, data.settings.company)) : null
  const message = created
    ? t(
        `${data.settings.company}: cobrança de ${usdcFmt(created.amount)} USDC (${created.description}). Pague aqui: ${link ?? ''}`,
        `${data.settings.company}: payment request for ${usdcFmt(created.amount)} USDC (${created.description}). Pay here: ${link ?? ''}`,
      )
    : ''

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={t('Cobrar em USDC', 'Charge in USDC')}>
      {created ? (
        <div className="space-y-4">
          <div className="text-center">
            <CheckCircle2 size={40} className="mx-auto text-ok" />
            <p className="display mt-2 text-lg font-semibold">{t('Cobrança criada', 'Payment request created')}</p>
            <p className="num mt-1 text-2xl font-semibold">{usdcFmt(created.amount)} USDC</p>
            <p className="text-xs text-subtle">{money(created.fiatAmount)} · {chainByKey(created.chainKey)?.label}</p>
          </div>
          <div className="mono break-all rounded-xl border border-line bg-fill/5 p-3 text-xs">{link ?? t('Preparando link...', 'Preparing link...')}</div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!link}
              onClick={() => {
                if (!link) return
                void navigator.clipboard.writeText(link)
                toast.success(t('Link copiado.', 'Link copied.'))
              }}
            >
              <Copy size={16} /> {t('Copiar link', 'Copy link')}
            </Button>
            <a
              aria-disabled={!link}
              href={link ? `https://wa.me/?text=${encodeURIComponent(message)}` : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-surface-strong ${link ? '' : 'pointer-events-none opacity-50'}`}
            >
              <MessageCircle size={16} /> WhatsApp
            </a>
            {typeof navigator.share === 'function' ? (
              <Button
                variant="ghost"
                disabled={!link}
                onClick={() => {
                  void navigator.share({ text: message }).catch(() => undefined)
                }}
              >
                <Share2 size={16} /> {t('Compartilhar', 'Share')}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-subtle text-pretty">
            {t(
              'O valor tem uma pequena marca única para identificar o pagamento. Enquanto o app estiver aberto, ele detecta a transferência e dá baixa na conta sozinho.',
              'The amount carries a tiny unique tag to identify the payment. While the app is open, it detects the transfer and settles the bill automatically.',
            )}
          </p>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            {t('Concluir', 'Done')}
          </Button>
        </div>
      ) : !address ? (
        <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn text-pretty">
          {t('Conecte a carteira que vai receber o pagamento antes de criar a cobrança.', 'Connect the wallet that will receive the payment before creating the request.')}
        </p>
      ) : (
        <div className="space-y-4">
          <Field label={t('Conta a receber', 'Receivable')}>
            <select className={inputCls} value={selected} onChange={(e) => pickAccount(e.target.value)}>
              {receivables.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.contactName} · {a.description} · {money(a.amount)}
                </option>
              ))}
              <option value={NEW}>{t('Nova cobrança avulsa', 'New one-off charge')}</option>
            </select>
          </Field>

          {selected === NEW ? (
            <>
              <Field label={t('Descrição', 'Description')}>
                <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} />
              </Field>
              <Field label={t('Valor na moeda do negócio', 'Amount in business currency')}>
                <input className={inputCls} inputMode="decimal" value={fiat} onChange={(e) => onFiat(e.target.value)} placeholder="0,00" />
              </Field>
            </>
          ) : null}

          <Field
            label={t('Valor em USDC', 'Amount in USDC')}
            hint={rate ? undefined : t('Defina a cotação em Configurações para preencher isso sozinho.', 'Set the rate in Settings to fill this automatically.')}
          >
            <input className={inputCls} inputMode="decimal" value={usdcText} onChange={(e) => setUsdcText(e.target.value)} placeholder="0,00" />
          </Field>

          <Field label={t('Rede para receber', 'Network to receive on')}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                <ChainIcon chainKey={chainKey} size={20} />
              </span>
              <select className={`${inputCls} pl-10`} value={chainKey} onChange={(e) => setChainKey(e.target.value)}>
                {GATEWAY_CHAINS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          <p className="text-xs text-subtle text-pretty">
            {t('Recebe na carteira conectada:', 'Receives in the connected wallet:')} <span className="mono">{address}</span>
          </p>
          {error ? <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{error}</p> : null}
          <Button className="w-full" disabled={!valid || busy} onClick={() => void create()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null} {t('Criar cobrança', 'Create payment request')}
          </Button>
        </div>
      )}
    </Modal>
  )
}
