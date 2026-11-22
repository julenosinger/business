import type { ReactNode } from 'react'
import { ConnectKitButton } from 'connectkit'
import { clsx } from 'clsx'
import { Menu, Moon, Sun, Wallet } from 'lucide-react'
import { MobileDrawer, Sidebar, useSidebarWidth } from '@/components/sidebar/Sidebar'
import { NetworkSelector } from '@/components/NetworkSelector'
import { sidebar, useSidebar } from '@/lib/sidebar'
import { useNav } from '@/lib/nav'
import { useStore } from '@/lib/store'
import { shortAddr } from '@/lib/format'
import { t, useLang } from '@/lib/i18n'
import { setTheme, useTheme } from '@/lib/theme'

export function Toggles() {
  const { lang, setLang } = useLang()
  const theme = useTheme()
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex rounded-xl border border-line p-0.5" role="group" aria-label={t('Idioma', 'Language')}>
        {(['pt', 'en'] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            aria-pressed={lang === l}
            className={clsx('min-h-9 rounded-lg px-2.5 text-xs font-bold uppercase', lang === l ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink')}
          >
            {l}
          </button>
        ))}
      </div>
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={theme === 'dark' ? t('Usar tema claro', 'Use light theme') : t('Usar tema escuro', 'Use dark theme')}
        className="flex size-10 items-center justify-center rounded-xl border border-line text-muted hover:bg-surface-strong"
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { data } = useStore()
  const { go } = useNav()
  const { mobileOpen } = useSidebar()
  const width = useSidebarWidth()

  return (
    <div className="min-h-dvh">
      <Sidebar />
      <MobileDrawer />

      <div className="min-w-0 transition-[padding-left] duration-200 ease-out motion-reduce:transition-none" style={{ paddingLeft: width }}>
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur sm:px-6">
          <button
            type="button"
            aria-label={t('Abrir menu', 'Open menu')}
            aria-haspopup="dialog"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            onClick={() => sidebar.setMobileOpen(true)}
            className="flex size-10 items-center justify-center rounded-xl border border-line text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 md:hidden"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="display truncate text-base font-semibold">{data.settings.company}</div>
            <div className="truncate text-xs text-subtle">
              {data.settings.branch} · {data.settings.currency}
            </div>
          </div>
          <NetworkSelector />
          <Toggles />
          <ConnectKitButton.Custom>
            {({ isConnected, show, address }) => (
              <button
                onClick={() => (isConnected ? go('treasury') : show?.())}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-strong"
              >
                <Wallet size={16} className="text-accent" />
                {isConnected && address ? <span className="mono text-xs">{shortAddr(address)}</span> : t('Conectar carteira', 'Connect wallet')}
              </button>
            )}
          </ConnectKitButton.Custom>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-6 sm:px-6">{children}</main>
      </div>
    </div>
  )
}
