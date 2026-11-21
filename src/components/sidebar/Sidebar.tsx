import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { SIDEBAR_COLLAPSED, SIDEBAR_EXPANDED, sidebar, useSidebar, useViewport } from '@/lib/sidebar'
import { t } from '@/lib/i18n'
import { RailTip } from './RailTip'
import { SidebarContent } from './SidebarContent'

const ctrl =
  'flex size-9 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none'

/** Largura efetiva do menu fixo: 0 no celular, trilho de ícones no tablet, expandido ou recolhido no desktop. */
export function useSidebarWidth(): number {
  const vp = useViewport()
  const { collapsed } = useSidebar()
  if (vp === 'mobile') return 0
  return vp === 'tablet' || collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED
}

/** Menu lateral fixo (tablet e desktop). */
export function Sidebar() {
  const vp = useViewport()
  const { collapsed } = useSidebar()
  const width = useSidebarWidth()
  if (vp === 'mobile') return null
  const rail = vp === 'tablet' || collapsed
  const label = rail ? t('Expandir menu', 'Expand menu') : t('Recolher menu', 'Collapse menu')

  return (
    <aside
      id="app-sidebar"
      aria-label={t('Navegação principal', 'Main navigation')}
      style={{ width }}
      className="sidebar-scroll fixed inset-y-0 left-0 z-40 overflow-y-auto overflow-x-hidden border-r border-line bg-panel transition-[width] duration-200 ease-out motion-reduce:transition-none"
    >
      <SidebarContent
        collapsed={rail}
        headerAction={
          vp === 'desktop' ? (
            <RailTip label={label} enabled={rail} className="block">
              <button type="button" onClick={sidebar.toggleCollapsed} aria-label={label} aria-expanded={!rail} aria-controls="app-sidebar" className={ctrl}>
                {rail ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
            </RailTip>
          ) : null
        }
      />
    </aside>
  )
}

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'

/** Gaveta de navegação do celular: fecha ao navegar, com Esc ou ao tocar fora; trava a rolagem e prende o foco. */
export function MobileDrawer() {
  const vp = useViewport()
  const { mobileOpen } = useSidebar()
  const open = mobileOpen && vp === 'mobile'
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Se a tela crescer com a gaveta aberta, fecha.
  useEffect(() => {
    if (mobileOpen && vp !== 'mobile') sidebar.setMobileOpen(false)
  }, [mobileOpen, vp])

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        sidebar.setMobileOpen(false)
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null && el.tabIndex >= 0)
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [open])

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open ? (
          <motion.div key="drawer" className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="absolute inset-0 bg-black/60" onMouseDown={() => sidebar.setMobileOpen(false)} aria-hidden="true" />
            <motion.aside
              ref={panelRef}
              id="mobile-nav"
              role="dialog"
              aria-modal="true"
              aria-label={t('Menu de navegação', 'Navigation menu')}
              className="sidebar-scroll absolute inset-y-0 left-0 w-[min(20rem,calc(100vw-3rem))] overflow-y-auto border-r border-line bg-panel"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <SidebarContent
                collapsed={false}
                onNavigate={() => sidebar.setMobileOpen(false)}
                headerAction={
                  <button ref={closeRef} type="button" aria-label={t('Fechar menu', 'Close menu')} onClick={() => sidebar.setMobileOpen(false)} className={ctrl}>
                    <X size={18} />
                  </button>
                }
              />
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  )
}
