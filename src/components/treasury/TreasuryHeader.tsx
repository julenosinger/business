import { useEffect, useRef, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { Copy, MoreHorizontal, RefreshCw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import { GlobeBackdrop } from './GlobeBackdrop'
import { t } from '@/lib/i18n'

interface Props {
  isConnected: boolean
  address?: string
  fetching: boolean
  onRefresh: () => void
}

export function TreasuryHeader({ isConnected, address, fetching, onRefresh }: Props) {
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [menu])

  return (
    <header className="relative">
      <GlobeBackdrop />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="display text-3xl font-semibold text-balance sm:text-4xl">{t('Tesouraria Global', 'Global Treasury')}</h1>
            <span className="inline-flex items-center gap-2 rounded-full border border-violet/40 bg-violet/15 px-3 py-1 text-xs font-semibold">
              <span className="size-2 rounded-full bg-sky" aria-hidden="true" /> Circle Gateway · Testnet
            </span>
          </div>
          <p className="mt-2 max-w-lg text-sm text-muted text-pretty">
            {t('Gestão de liquidez, pagamentos e operações multichain com Circle Gateway.', 'Liquidity management, payments and multichain operations with Circle Gateway.')}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={onRefresh} disabled={fetching || !isConnected} aria-label={t('Atualizar saldos', 'Refresh balances')} className="!bg-fill/5">
            <RefreshCw size={15} className={fetching ? 'animate-spin motion-reduce:animate-none' : ''} />
            <span className="hidden sm:inline">{t('Atualizar saldos', 'Refresh balances')}</span>
          </Button>
          <div className="relative" ref={ref}>
            <button
              onClick={() => setMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label={t('Mais opções', 'More options')}
              className="flex size-11 items-center justify-center rounded-xl border border-line bg-fill/5 text-muted hover:bg-surface-strong hover:text-ink"
            >
              <MoreHorizontal size={18} />
            </button>
            {menu ? (
              <div role="menu" className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-panel p-1 shadow-xl">
                <ConnectKitButton.Custom>
                  {({ show }) => (
                    <button
                      role="menuitem"
                      className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-strong"
                      onClick={() => {
                        setMenu(false)
                        show?.()
                      }}
                    >
                      <Settings2 size={15} className="text-muted" /> {isConnected ? t('Gerenciar carteira', 'Manage wallet') : t('Conectar carteira', 'Connect wallet')}
                    </button>
                  )}
                </ConnectKitButton.Custom>
                <button
                  role="menuitem"
                  disabled={!address}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-strong disabled:opacity-50"
                  onClick={() => {
                    if (!address) return
                    void navigator.clipboard.writeText(address)
                    toast.success(t('Endereço copiado. Use-o para receber USDC.', 'Address copied. Use it to receive USDC.'))
                    setMenu(false)
                  }}
                >
                  <Copy size={15} className="text-muted" /> {t('Copiar endereço para receber', 'Copy address to receive')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}
