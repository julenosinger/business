import { useEffect, useRef, useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { Check, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { toast } from 'sonner'
import { t } from '@/lib/i18n'
import { getNetwork, networkInfo, setNetwork, useNetwork, type NetworkId } from '@/lib/network'

const OPTIONS: NetworkId[] = ['mainnet', 'testnet']

export function NetworkDot({ env }: { env: 'live' | 'test' }) {
  return <span aria-hidden className={clsx('size-1.5 rounded-full', env === 'live' ? 'bg-ok' : 'bg-warn')} />
}

/**
 * Seletor de rede no cabeçalho. Mostra a rede ativa e permite trocar explicitamente.
 * A troca pede a mudança de chain na carteira (quando conectada) e SÓ atualiza a rede do app
 * depois de validar. Em caso de recusa/erro, mantém a rede anterior e mostra o erro.
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

  const choose = async (id: NetworkId) => {
    if (id === network) {
      setOpen(false)
      return
    }
    const target = networkInfo(id)
    setBusy(true)
    try {
      // Carteira conectada: troca a chain primeiro. Falha (recusa do usuário) mantém a rede atual.
      if (isConnected && chainId !== target.chainId) {
        await switchChainAsync({ chainId: target.chainId })
      }
      setNetwork(id)
      toast.success(
        id === 'mainnet'
          ? t('Rede alterada para Arc Mainnet (rede real).', 'Switched to Arc Mainnet (live network).')
          : t('Rede alterada para Arc Testnet (ambiente de teste).', 'Switched to Arc Testnet (test environment).'),
      )
    } catch {
      toast.error(t('Não foi possível trocar a rede. A rede anterior foi mantida.', 'Could not switch network. The previous network was kept.'))
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('Rede ativa', 'Active network')}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-strong"
      >
        {busy ? <Loader2 size={15} className="animate-spin text-subtle" /> : <NetworkDot env={info.env} />}
        <span className="hidden sm:inline">{info.label}</span>
        <span className="sm:hidden">{info.short}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-subtle">{info.env === 'live' ? t('Live', 'Live') : t('Teste', 'Test')}</span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={t('Escolher rede', 'Choose network')}
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-panel shadow-xl"
        >
          {OPTIONS.map((id) => {
            const o = networkInfo(id)
            const active = id === network
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => void choose(id)}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-surface"
              >
                <NetworkDot env={o.env} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{o.label}</span>
                  <span className="block text-xs text-subtle">{o.env === 'live' ? t('Rede real', 'Live network') : t('Ambiente de teste', 'Test network')}</span>
                </span>
                {active ? <Check size={16} className="text-accent" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** Usa o valor atual (para exibir em outros pontos sem re-render por rede). */
export const currentNetwork = () => networkInfo(getNetwork())
