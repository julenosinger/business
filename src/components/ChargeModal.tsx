import { useEffect, useRef, useState } from 'react'
import { getPublicClient } from 'wagmi/actions'
import { CheckCircle2, Copy, Loader2, MessageCircle, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { config } from '@/config'
import { Button, Field, Modal, inputCls } from '@/components/ui'
import { ChainIcon } from '@/components/ChainIcon'
import { chainByKey, explainError, gatewayChainsFor } from '@/lib/gateway'
import { treasuryRecipientFor, validateBeneficiary, validateGatewayTreasury } from '@/lib/gateway-config'
import { arcGatewayKeyOf, useNetwork } from '@/lib/network'
import { invoiceLink, requestToInvoice, useShareBase } from '@/lib/invoice'
import { createCheckoutToken, checkoutUrlFor } from '@/lib/gateway-charge'
import { useStore } from '@/lib/store'
import { money, parseNum, toUsdc, today, usdcFmt, usdcRateOf } from '@/lib/format'
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

/** Soma uma marca única (100 a 999 unidades mínimas) para identificar o pagamento sem memo (fluxo legado). */
function withTag(base: Amount, taken: Set<bigint>): Amount | null {
  for (let i = 0; i < 50; i++) {
    const tag = BigInt(100 + Math.floor(Math.random() * 900))
    const candidate = Amount.fromRaw(base.raw + tag, USDC_DECIMALS)
    if (!taken.has(candidate.raw)) return candidate
  }
  return null // sem marca disponível: erro explícito (sem fallback de marca fixa)
}

function newIdempotencyKey(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  } catch {
    // fallback
  }
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function defaultExpiryIso(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

export function ChargeModal({ open, accountId, onClose }: Props) {
  const { data, addAccount, addRequest, createPaymentIntent } = useStore()
  const base = useShareBase()
  const network = useNetwork()
  const receivables = data.accounts.filter((a) => a.kind === 'receivable' && a.status === 'open' && !a.canceledAt && a.environment === network)
  const rate = usdcRateOf(data.settings)
  // Destino institucional da Treasury (nunca a carteira conectada do operador), resolvido por ambiente.
  const treasuryRecipient = treasuryRecipientFor(data.settings, network)

  const [selected, setSelected] = useState('')
  const [desc, setDesc] = useState('')
  const [fiat, setFiat] = useState('')
  const [usdcText, setUsdcText] = useState('')
  const [chainKey, setChainKey] = useState<string>(arcGatewayKeyOf(network))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const created = createdId ? (data.requests.find((r) => r.id === createdId) ?? null) : null
  // Fluxo Gateway (Payment Intent): referência de checkout + diagnóstico de configuração.
  const [gatewayIntentId, setGatewayIntentId] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [configPending, setConfigPending] = useState(false)
  const [seed, setSeed] = useState<string | null>(null)

  // Lock imediato (anti duplo clique) e identidade de sessão (invalida respostas assíncronas obsoletas).
  const busyRef = useRef(false)
  const sessionRef = useRef(0)
  // Idempotência estável durante retries da MESMA operação comercial (reseta ao trocar contexto).
  const idempotencyKeyRef = useRef(newIdempotencyKey())

  // A chave de inicialização inclui o AMBIENTE: ao trocar de rede, o modal reinicializa o estado.
  const seedKey = open ? `open:${network}:${accountId ?? ''}` : null
  // Invalida qualquer sessão em voo e reemite a chave de idempotência sempre que o contexto mudar.
  useEffect(() => {
    sessionRef.current += 1
    idempotencyKeyRef.current = newIdempotencyKey()
  }, [seedKey])
  if (seedKey !== seed) {
    setSeed(seedKey)
    setCreatedId(null)
    setGatewayIntentId(null)
    setCheckoutUrl(null)
    setConfigPending(false)
    setError(null)
    setDesc('')
    setFiat('')
    setChainKey(arcGatewayKeyOf(network))
    const acc = accountId ? receivables.find((a) => a.id === accountId) : undefined
    setSelected(acc ? acc.id : receivables[0] ? receivables[0].id : NEW)
    setUsdcText(acc && rate ? toUsdc(acc.amount, rate).toFixed(2) : '')
  }

  const account = receivables.find((a) => a.id === selected)
  const fiatValue = selected === NEW ? parseNum(fiat) : (account?.amount ?? 0)

  const pickAccount = (id: string) => {
    setSelected(id)
    const acc = receivables.find((a) => a.id === id)
    if (acc && rate) setUsdcText(toUsdc(acc.amount, rate).toFixed(2))
  }

  const onFiat = (v: string) => {
    setFiat(v)
    const n = parseNum(v)
    if (rate && n > 0) setUsdcText(toUsdc(n, rate).toFixed(2))
  }

  let baseAmount: Amount | null = null
  try {
    const parsed = Amount.parse(usdcText.trim().replace(',', '.'), USDC_DECIMALS)
    baseAmount = parsed.isPositive() ? parsed : null
  } catch {
    baseAmount = null
  }
  const chain = chainByKey(chainKey)
  // Destino pode ser o GatewayWallet (depósito oficial Circle Gateway) OU um beneficiário convencional (legado).
  const beneficiary = treasuryRecipient ? validateBeneficiary(treasuryRecipient, network) : null
  const gatewayValid = chain ? validateGatewayTreasury(treasuryRecipient, network, chain.chainId) : false
  const destinationValid = Boolean(beneficiary?.ok || gatewayValid)

  const handleCreateCharge = async () => {
    if (busyRef.current) return
    const session = sessionRef.current
    busyRef.current = true
    setBusy(true)
    setError(null)

    try {
      // Validações autoritativas com erro explicativo (nunca bloqueio silencioso).
      if (!treasuryRecipient) {
        setError(t('Configure o endereço institucional da Treasury (Configurações) para receber pagamentos.', 'Configure the institutional Treasury address (Settings) to receive payments.'))
        return
      }
      if (!chain) {
        setError(t('Rede selecionada inválida.', 'Invalid selected network.'))
        return
      }
      if (!gatewayValid && !beneficiary?.ok) {
        setError(t('O destino configurado não é um beneficiário válido nem o GatewayWallet deste ambiente. Revise nas Configurações.', 'The configured destination is neither a valid beneficiary nor the GatewayWallet for this environment. Review in Settings.'))
        return
      }
      if (!baseAmount) {
        setError(t('Informe um valor em USDC maior que zero.', 'Enter a USDC amount greater than zero.'))
        return
      }
      if (fiatValue <= 0) {
        setError(t('Valor inválido.', 'Invalid amount.'))
        return
      }
      if (selected === NEW && !desc.trim()) {
        setError(t('Informe uma descrição para a cobrança avulsa.', 'Enter a description for the one-off charge.'))
        return
      }
      if (selected !== NEW && !account) {
        setError(t('Selecione uma conta a receber válida.', 'Select a valid receivable.'))
        return
      }

      if (session !== sessionRef.current) return

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

      if (gatewayValid) {
        // Fluxo Gateway (Payment Intent): sem marca aleatória, sem transferência direta.
        const token = createCheckoutToken()
        const result = createPaymentIntent({
          accountId: accId,
          amount: Number(baseAmount.toString()),
          amountDecimal: baseAmount.toString(),
          usdcMinor: baseAmount.raw.toString(),
          currency: 'USDC',
          idempotencyKey: idempotencyKeyRef.current,
          checkoutToken: token.token,
          expiresAt: defaultExpiryIso(),
        })
        if (!result.ok) {
          if (result.reason === 'conflict') setError(t('Já existe uma cobrança com esta operação.', 'A charge already exists for this operation.'))
          else setError(t('Não foi possível criar a cobrança. Verifique o saldo disponível e a configuração.', 'Could not create the charge. Check the available balance and configuration.'))
          return
        }
        if (session !== sessionRef.current) return
        // Configuração pendente quando a conta depositante institucional ainda não foi resolvida.
        setConfigPending(!beneficiary?.ok)
        setGatewayIntentId(result.intentId)
        setCheckoutUrl(base ? checkoutUrlFor(base, token.token) : null)
      } else {
        // Fluxo legado (transferência ERC20 simples para carteira convencional) — preservado.
        const client = getPublicClient(config, { chainId: chain.chainId })
        let fromBlock = '0'
        try {
          if (client) fromBlock = (await client.getBlockNumber()).toString()
        } catch {
          fromBlock = '0'
        }
        if (session !== sessionRef.current) return
        const taken = new Set(
          data.requests
            .filter((r) => r.status === 'open' && r.chainKey === chainKey && r.recipient.toLowerCase() === treasuryRecipient.toLowerCase())
            .map((r) => Amount.parse(r.amount, USDC_DECIMALS).raw),
        )
        const exact = withTag(baseAmount, taken)
        if (!exact) {
          setError(t('Não há valor marcado disponível para esta cobrança. Tente novamente.', 'No tagged amount available for this charge. Please try again.'))
          return
        }
        const id = addRequest({
          accountId: accId,
          description,
          fiatAmount: fiatValue,
          amount: exact.toString(),
          chainKey,
          chainId: chain.chainId,
          recipient: treasuryRecipient,
          fromBlock,
          paymentRail: 'legacy_transfer',
        })
        if (session !== sessionRef.current) return
        setCreatedId(id)
      }
    } catch (err) {
      if (session === sessionRef.current) setError(explainError(err))
    } finally {
      if (session === sessionRef.current) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  const link = created && base ? invoiceLink(base, requestToInvoice(created, data.settings.company)) : null
  const message = created
    ? t(
        `${data.settings.company}: cobrança de ${usdcFmt(created.amount)} USDC (${created.description}). Pague aqui: ${link ?? ''}`,
        `${data.settings.company}: payment request for ${usdcFmt(created.amount)} USDC (${created.description}). Pay here: ${link ?? ''}`,
      )
    : checkoutUrl
      ? t(
          `${data.settings.company}: cobrança. Pague aqui: ${checkoutUrl}`,
          `${data.settings.company}: payment request. Pay here: ${checkoutUrl}`,
        )
      : ''

  const showLink = link ?? checkoutUrl

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={t('Cobrar em USDC', 'Charge in USDC')}>
      {created || gatewayIntentId ? (
        <div className="space-y-4">
          <div className="text-center">
            <CheckCircle2 size={40} className="mx-auto text-ok" />
            <p className="display mt-2 text-lg font-semibold">{t('Cobrança criada', 'Payment request created')}</p>
            <p className="num mt-1 text-2xl font-semibold">{usdcFmt(baseAmount?.toString() ?? '0')} USDC</p>
            <p className="text-xs text-subtle">{chainByKey(chainKey)?.label}</p>
          </div>
          {configPending ? (
            <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn text-pretty">
              {t('Configuração pendente: a conta depositante institucional ainda não foi definida. A cobrança foi salva, mas o pagamento via Circle Gateway aguarda essa configuração.', 'Pending configuration: the institutional depositor account has not been set yet. The charge was saved, but Circle Gateway payment awaits this configuration.')}
            </p>
          ) : null}
          <div className="mono break-all rounded-xl border border-line bg-fill/5 p-3 text-xs">{showLink ?? t('Preparando link...', 'Preparing link...')}</div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!showLink}
              onClick={() => {
                if (!showLink) return
                void navigator.clipboard.writeText(showLink)
                toast.success(t('Link copiado.', 'Link copied.'))
              }}
            >
              <Copy size={16} /> {t('Copiar link', 'Copy link')}
            </Button>
            <a
              aria-disabled={!showLink}
              href={showLink ? `https://wa.me/?text=${encodeURIComponent(message)}` : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-surface-strong ${showLink ? '' : 'pointer-events-none opacity-50'}`}
            >
              <MessageCircle size={16} /> WhatsApp
            </a>
            {typeof navigator.share === 'function' ? (
              <Button
                variant="ghost"
                disabled={!showLink}
                onClick={() => {
                  void navigator.share({ text: message }).catch(() => undefined)
                }}
              >
                <Share2 size={16} /> {t('Compartilhar', 'Share')}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-subtle text-pretty">
            {created
              ? t(
                  'O valor tem uma pequena marca única para identificar o pagamento. Enquanto o app estiver aberto, ele detecta a transferência e dá baixa na conta sozinho.',
                  'The amount carries a tiny unique tag to identify the payment. While the app is open, it detects the transfer and settles the bill automatically.',
                )
              : t(
                  'O pagamento será confirmado somente após verificação independente do depósito Circle Gateway.',
                  'Payment will be confirmed only after independent verification of the Circle Gateway deposit.',
                )}
          </p>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            {t('Concluir', 'Done')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {!treasuryRecipient ? (
            <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn text-pretty">
              {t('Configure o endereço institucional da Treasury (Configurações) para receber pagamentos. A carteira conectada não é usada como destinatário.', 'Configure the institutional Treasury address (Settings) to receive payments. The connected wallet is not used as the recipient.')}
            </p>
          ) : !destinationValid ? (
            <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn text-pretty">
              {t('O destino configurado não é um beneficiário válido nem o GatewayWallet deste ambiente. Revise nas Configurações.', 'The configured destination is neither a valid beneficiary nor the GatewayWallet for this environment. Review in Settings.')}
            </p>
          ) : null}

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
                {gatewayChainsFor(network).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          <p className="text-xs text-subtle text-pretty">
            {t('Recebe na Treasury institucional:', 'Receives at the institutional Treasury:')} <span className="mono">{treasuryRecipient}</span>
          </p>
          {error ? <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{error}</p> : null}
          <Button className="w-full" disabled={busy} aria-busy={busy} onClick={() => void handleCreateCharge()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null} {busy ? t('Criando cobrança...', 'Creating charge...') : t('Criar cobrança', 'Create payment request')}
          </Button>
        </div>
      )}
    </Modal>
  )
}
