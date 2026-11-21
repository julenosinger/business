import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Building2, ChevronDown } from 'lucide-react'
import { useNav } from '@/lib/nav'
import { useStore } from '@/lib/store'
import { sidebar, useSidebar } from '@/lib/sidebar'
import { t } from '@/lib/i18n'
import { navSections, type NavEntry, type NavSection } from './nav-config'
import { NavItem } from './NavItem'
import { RailTip } from './RailTip'

interface Props {
  collapsed: boolean
  /** Botão de recolher (desktop) ou de fechar (gaveta). */
  headerAction: ReactNode
  onNavigate?: () => void
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={clsx('flex min-w-0 items-center gap-3', collapsed && 'justify-center')}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink">
        <Building2 size={20} />
      </span>
      {collapsed ? null : (
        <span className="min-w-0 leading-tight">
          <span className="display block truncate text-[15px] font-semibold">Global Business OS</span>
          <span className="block truncate text-[11px] text-subtle">Enterprise Workspace</span>
        </span>
      )}
    </div>
  )
}

function Company({ collapsed }: { collapsed: boolean }) {
  const { data } = useStore()
  const { company, branch, currency } = data.settings
  const initial = company.trim().charAt(0).toUpperCase() || '?'
  const label = `${company} · ${branch} · ${currency}`
  return (
    <RailTip label={label} enabled={collapsed}>
      <div
        className={clsx('flex items-center rounded-xl border border-line bg-fill/5', collapsed ? 'mx-auto size-11 justify-center' : 'gap-2.5 p-2.5')}
        role="group"
        aria-label={`${t('Empresa atual', 'Current company')}: ${label}`}
        tabIndex={collapsed ? 0 : undefined}
      >
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sky/15 text-xs font-bold text-sky">
          {initial}
        </span>
        {collapsed ? null : (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold">{company}</span>
            <span className="block truncate text-[11px] text-subtle">
              {branch} · {currency}
            </span>
          </span>
        )}
      </div>
    </RailTip>
  )
}

function Section({ section, collapsed, onPick }: { section: NavSection; collapsed: boolean; onPick: (e: NavEntry) => void }) {
  const { page } = useNav()
  const { closedSections } = useSidebar()
  const closed = !collapsed && closedSections.includes(section.id)
  const listId = `nav-section-${section.id}`
  const activeItem = section.items.find((i) => i.id === page)

  if (collapsed) {
    // Trilho de ícones: sem títulos, só um separador entre os grupos.
    return (
      <div role="group" aria-label={section.label} className="space-y-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
        {section.items.map((it) => (
          <NavItem key={it.id} entry={it} active={it.id === page} collapsed onPick={onPick} />
        ))}
      </div>
    )
  }

  return (
    <div role="group" aria-label={section.label}>
      <button
        type="button"
        data-nav-section
        aria-expanded={!closed}
        aria-controls={listId}
        onClick={() => sidebar.toggleSection(section.id)}
        className="flex min-h-8 w-full items-center justify-between rounded-lg px-3 text-[11px] font-semibold uppercase tracking-wider text-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none"
      >
        {section.label}
        <ChevronDown size={14} className={clsx('transition-transform duration-200 motion-reduce:transition-none', closed && '-rotate-90')} aria-hidden="true" />
      </button>
      {/* Em grupo recolhido, a página atual continua visível e acessível. */}
      {closed && activeItem ? (
        <div className="mt-0.5">
          <NavItem entry={activeItem} active collapsed={false} onPick={onPick} />
        </div>
      ) : null}
      <div id={listId} className={clsx('grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none', closed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')}>
        <div
          className="min-h-0 overflow-hidden"
          style={{ visibility: closed ? 'hidden' : 'visible', transition: closed ? 'visibility 0s linear 0.2s' : undefined }}
        >
          <div className="mt-0.5 space-y-0.5 pb-1">
            {section.items.map((it) => (
              <NavItem key={it.id} entry={it} active={it.id === page} collapsed={false} focusable={!closed} onPick={onPick} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SidebarContent({ collapsed, headerAction, onNavigate }: Props) {
  const { go } = useNav()
  const navRef = useRef<HTMLElement>(null)

  const pick = (e: NavEntry) => {
    go(e.id)
    onNavigate?.()
  }

  // Setas, Home e End percorrem os itens visíveis do menu.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const all = Array.from(navRef.current?.querySelectorAll<HTMLElement>('[data-nav-item],[data-nav-section]') ?? []).filter((el) => el.tabIndex >= 0 && el.offsetParent !== null)
    if (all.length === 0) return
    const i = all.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : e.key === 'ArrowDown' ? (i + 1) % all.length : (i - 1 + all.length) % all.length
    e.preventDefault()
    all[next]?.focus()
  }

  return (
    <div className="flex min-h-full flex-col px-3 py-4">
      <div className={clsx('flex gap-2', collapsed ? 'flex-col items-center' : 'items-center justify-between')}>
        <Brand collapsed={collapsed} />
        {headerAction}
      </div>

      <div className="mt-4">
        <Company collapsed={collapsed} />
      </div>

      <nav ref={navRef} onKeyDown={onKeyDown} aria-label={t('Principal', 'Main')} className={clsx('mt-4 flex flex-col', collapsed ? 'gap-3' : 'gap-2')}>
        {navSections().map((s) => (
          <Section key={s.id} section={s} collapsed={collapsed} onPick={pick} />
        ))}
      </nav>

      <div className="mt-auto pt-6">
        <RailTip label={t('Tesouraria em testnet com USDC', 'Treasury on testnet with USDC')} enabled={collapsed}>
          <div
            className={clsx('flex items-center rounded-xl border border-line bg-fill/5 text-xs text-muted', collapsed ? 'mx-auto size-11 justify-center' : 'gap-2.5 p-3')}
            role="status"
            aria-label={t('Tesouraria em testnet com USDC', 'Treasury on testnet with USDC')}
            tabIndex={collapsed ? 0 : undefined}
          >
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-ok" />
            {collapsed ? null : (
              <span className="leading-snug">
                <span className="block font-semibold text-ink">Testnet</span>
                {t('Tesouraria com USDC', 'Treasury with USDC')}
              </span>
            )}
          </div>
        </RailTip>
      </div>
    </div>
  )
}
