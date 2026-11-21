import { useState, type ReactNode } from 'react'
import { ConnectKitButton } from 'connectkit'
import { clsx } from 'clsx'
import {
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  Landmark,
  LayoutDashboard,
  Menu,
  Moon,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sun,
  Truck,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useNav, type PageId } from '@/lib/nav'
import { useStore } from '@/lib/store'
import { shortAddr } from '@/lib/format'
import { t, useLang } from '@/lib/i18n'
import { setTheme, useTheme } from '@/lib/theme'

function navItems(): { id: PageId; label: string; icon: ReactNode; badge?: string }[] {
  return [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'accounting', label: t('Contabilidade', 'Accounting'), icon: <BookOpen size={18} /> },
    { id: 'finance', label: t('Contas a pagar e receber', 'Payables and receivables'), icon: <Receipt size={18} /> },
    { id: 'sales', label: t('Vendas e PDV', 'Sales and POS'), icon: <ShoppingCart size={18} /> },
    { id: 'stock', label: t('Estoque', 'Inventory'), icon: <Boxes size={18} /> },
    { id: 'purchases', label: t('Compras', 'Purchases'), icon: <ShoppingBag size={18} /> },
    { id: 'customers', label: t('Clientes', 'Customers'), icon: <Users size={18} /> },
    { id: 'suppliers', label: t('Fornecedores', 'Suppliers'), icon: <Truck size={18} /> },
    { id: 'hr', label: t('Funcionários', 'Employees'), icon: <UserRound size={18} /> },
    { id: 'treasury', label: t('Tesouraria', 'Treasury'), icon: <Landmark size={18} />, badge: 'Circle' },
    { id: 'reports', label: t('Relatórios', 'Reports'), icon: <BarChart3 size={18} /> },
    { id: 'settings', label: t('Configurações', 'Settings'), icon: <Settings size={18} /> },
  ]
}

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

function Brand() {
  return (
    <div className="flex items-center gap-3 px-2">
      <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-ink">
        <Building2 size={20} />
      </div>
      <div className="leading-tight">
        <div className="display text-base font-semibold">Global Business OS</div>
        <div className="text-[11px] text-subtle">{t('ERP, finanças e tesouraria', 'ERP, finance and treasury')}</div>
      </div>
    </div>
  )
}

function NavList({ onPick }: { onPick: () => void }) {
  const { page, go } = useNav()
  return (
    <nav className="mt-6 flex flex-col gap-1" aria-label={t('Principal', 'Main')}>
      {navItems().map((it) => (
        <button
          key={it.id}
          onClick={() => {
            go(it.id)
            onPick()
          }}
          aria-current={page === it.id ? 'page' : undefined}
          className={clsx(
            'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition',
            page === it.id ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-strong hover:text-ink',
          )}
        >
          {it.icon}
          <span className="flex-1 text-left">{it.label}</span>
          {it.badge ? (
            <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-bold', page === it.id ? 'bg-accent-ink/15' : 'bg-accent/15 text-accent')}>
              {it.badge}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { data } = useStore()
  const { go } = useNav()

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r border-line bg-fill/5 p-4 lg:flex">
        <Brand />
        <NavList onPick={() => undefined} />
        <div className="mt-auto pt-6">
          <div className="rounded-2xl border border-line bg-surface p-3 text-xs text-muted">
            <div className="label mb-1">{t('Rede', 'Network')}</div>
            {t('Tesouraria operando em testnet com USDC.', 'Treasury running on testnet with USDC.')}
          </div>
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" onMouseDown={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-line bg-panel p-4" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <Brand />
              <button aria-label={t('Fechar menu', 'Close menu')} onClick={() => setOpen(false)} className="flex size-10 items-center justify-center rounded-xl text-muted">
                <X size={18} />
              </button>
            </div>
            <NavList onPick={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur sm:px-6">
          <button aria-label={t('Abrir menu', 'Open menu')} onClick={() => setOpen(true)} className="flex size-10 items-center justify-center rounded-xl border border-line text-muted lg:hidden">
            <Menu size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="display truncate text-base font-semibold">{data.settings.company}</div>
            <div className="truncate text-xs text-subtle">
              {data.settings.branch} · {data.settings.currency}
            </div>
          </div>
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
