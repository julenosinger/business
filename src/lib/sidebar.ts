import { useSyncExternalStore } from 'react'

/** Larguras do menu lateral em desktop (px). */
export const SIDEBAR_EXPANDED = 260
export const SIDEBAR_COLLAPSED = 76

const KEY = 'gbos:sidebar'

interface Persisted {
  /** Preferência do usuário no desktop. */
  collapsed: boolean
  /** Seções do menu recolhidas (só visual). */
  closedSections: string[]
}

export interface SidebarState extends Persisted {
  /** Gaveta do celular aberta. */
  mobileOpen: boolean
}

function read(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { collapsed: false, closedSections: [] }
    const p = JSON.parse(raw) as Partial<Persisted>
    return {
      collapsed: p.collapsed === true,
      closedSections: Array.isArray(p.closedSections) ? p.closedSections.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return { collapsed: false, closedSections: [] }
  }
}

// Fonte única da verdade. Lida de forma síncrona ao carregar o módulo, então o primeiro render já usa a largura certa.
let state: SidebarState = { ...read(), mobileOpen: false }
const listeners = new Set<() => void>()

function commit(next: SidebarState): void {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify({ collapsed: next.collapsed, closedSections: next.closedSections } satisfies Persisted))
  } catch {
    // preferência apenas visual: ignorar falha de armazenamento
  }
  listeners.forEach((l) => l())
}

export const sidebar = {
  toggleCollapsed: () => commit({ ...state, collapsed: !state.collapsed }),
  setMobileOpen: (open: boolean) => {
    if (state.mobileOpen !== open) commit({ ...state, mobileOpen: open })
  },
  toggleSection: (id: string) =>
    commit({ ...state, closedSections: state.closedSections.includes(id) ? state.closedSections.filter((s) => s !== id) : [...state.closedSections, id] }),
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useSidebar(): SidebarState {
  return useSyncExternalStore(subscribe, () => state)
}

export type Viewport = 'mobile' | 'tablet' | 'desktop'

const TABLET = '(min-width: 768px)'
const DESKTOP = '(min-width: 1024px)'

function viewport(): Viewport {
  if (window.matchMedia(DESKTOP).matches) return 'desktop'
  return window.matchMedia(TABLET).matches ? 'tablet' : 'mobile'
}

function subscribeViewport(cb: () => void): () => void {
  const a = window.matchMedia(TABLET)
  const b = window.matchMedia(DESKTOP)
  a.addEventListener('change', cb)
  b.addEventListener('change', cb)
  return () => {
    a.removeEventListener('change', cb)
    b.removeEventListener('change', cb)
  }
}

/** Faixa de tela atual: celular (gaveta), tablet (trilho recolhido) ou desktop (expandido ou recolhido). */
export function useViewport(): Viewport {
  return useSyncExternalStore(subscribeViewport, viewport)
}
