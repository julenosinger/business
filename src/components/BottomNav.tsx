import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Home, Landmark, MoreHorizontal, Receipt, ShoppingCart } from 'lucide-react'
import { useNav, type PageId } from '@/lib/nav'
import { sidebar } from '@/lib/sidebar'
import { t } from '@/lib/i18n'

type NavKind = PageId | 'more'

interface Item {
  id: NavKind
  label: string
  icon: (p: { size: number; strokeWidth: number }) => ReactNode
}

/**
 * Navegação inferior compacta (mobile). Os módulos principais ficam a um toque; "Mais" abre a
 * gaveta completa do menu, sem esconder nenhuma página. Respeita a área segura do dispositivo.
 */
export function BottomNav() {
  const { page, go } = useNav()

  const items: Item[] = [
    { id: 'dashboard', label: t('Início', 'Home'), icon: (p) => <Home {...p} /> },
    { id: 'sales', label: t('Vendas', 'Sales'), icon: (p) => <ShoppingCart {...p} /> },
    { id: 'treasury', label: t('Tesouraria', 'Treasury'), icon: (p) => <Landmark {...p} /> },
    { id: 'finance', label: t('Financeiro', 'Financial'), icon: (p) => <Receipt {...p} /> },
  ]

  const pick = (id: NavKind) => {
    if (id === 'more') {
      sidebar.setMobileOpen(true)
      return
    }
    go(id)
  }

  return (
    <nav
      aria-label={t('Navegação inferior', 'Bottom navigation')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch">
        {items.map((it) => {
          const active = page === it.id
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => pick(it.id)}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                active ? 'text-accent' : 'text-muted hover:text-ink',
              )}
            >
              {it.icon({ size: 20, strokeWidth: 1.75 })}
              <span>{it.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => pick('more')}
          aria-label={t('Mais opções', 'More options')}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <MoreHorizontal size={20} strokeWidth={1.75} />
          <span>{t('Mais', 'More')}</span>
        </button>
      </div>
    </nav>
  )
}
