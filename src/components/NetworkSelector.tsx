import { useAccount, useSwitchChain } from 'wagmi'
import { Check, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { toast } from 'sonner'
import { t } from '@/lib/i18n'
import { getNetwork, networkInfo, useNetwork } from '@/lib/network'

export function NetworkDot({ env }: { env: 'live' | 'test' }) {
  return <span aria-hidden className={clsx('size-1.5 rounded-full', env === 'live' ? 'bg-ok' : 'bg-warn')} />
}

/**
 * Indicador de rede no cabeçalho. O ERP é exclusivamente Mainnet: não há mais alternância de
 * ambiente. O clique apenas garante que a carteira conectada esteja em Arc Mainnet (chain 5042).
 */
export function NetworkSelector() {
  const network = useNetwork()
  const { isConnected, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const info = networkInfo(network)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const ensureMainnet = async () => {
    setOpen(false)
    if (!isConnected || chainId === info.chainId) return
    setBusy(true)
    try {
      await switchChainAsync({ chainId: info.chainId })
      toast.success(t('Carteira alterada para Arc Mainnet.', 'Wallet switched to Arc Mainnet.'))
    } catch {
      toast.error(t('Não foi possível trocar a carteira para Arc Mainnet.', 'Could not switch the wallet to Arc Mainnet.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={isConnected ? () => void ensureMainnet() : () => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('Rede ativa', 'Active network')}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-strong"
      >
        {busy ? <Loader2 size={15} className="animate-spin text-subtle" /> : <NetworkDot env={info.env} />}
        <span className="hidden sm:inline">{info.label}</span>
        <span className="sm:hidden">{info.short}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-subtle">{t('Live', 'Live')}</span>
      </button>

      {open && !isConnected ? (
        <div role="listbox" aria-label={t('Escolher rede', 'Choose network')} className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
          <button type="button" role="option" aria-selected className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-surface">
            <NetworkDot env={info.env} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{info.label}</span>
              <span className="block text-xs text-subtle">{t('Rede real', 'Live network')}</span>
            </span>
            <Check size={16} className="text-accent" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Usa o valor atual (para exibir em outros pontos sem re-render por rede). */
export const currentNetwork = () => networkInfo(getNetwork())
