/**
 * Roteamento do Global Business OS (fase UI/UX NAVIGATION 1.0).
 *
 * A URL é a fonte AUTORITATIVA da navegação: cada página tem uma rota estável e navegável, e o
 * pathname determina a página renderizada (inclusive após refresh). A navegação usa
 * `history.pushState`/`replaceState` — compatível com o `installShareSync` (que espelha a URL no
 * endereço do Arc Studio) e com o botão Voltar/Avançar do navegador.
 */
import { useCallback, useState } from 'react'
import type { PageId } from './nav'

/** Mapeamento página ↔ rota (fonte única do sitemap de rotas). */
export const PAGE_ROUTES: Record<PageId, string> = {
  dashboard: '/dashboard',
  accounting: '/accounting',
  finance: '/finance',
  sales: '/sales',
  stock: '/stock',
  purchases: '/purchases',
  logistics: '/logistics',
  customers: '/customers',
  suppliers: '/suppliers',
  hr: '/employees',
  treasury: '/treasury',
  reports: '/reports',
  agents: '/agents',
  chatbot: '/chatbot',
  settings: '/settings',
}

const ROUTE_TO_PAGE: Record<string, PageId> = Object.fromEntries(
  (Object.entries(PAGE_ROUTES) as [PageId, string][]).map(([page, route]) => [route, page]),
)

export const DEFAULT_PAGE: PageId = 'dashboard'

export const routeFor = (page: PageId): string => PAGE_ROUTES[page]

/** Resolve a página a partir do pathname. `null` quando o caminho não é uma rota de página. */
export function pageFromPath(pathname: string): PageId | null {
  const clean = pathname.replace(/\/+$/, '') || '/'
  return ROUTE_TO_PAGE[clean] ?? null
}

/**
 * Estado de aba persistido em um parâmetro de URL (`?name=value`). Lê no mount (síncrono, sem
 * flash) e usa `replaceState` ao mudar, preservando o histórico e os demais parâmetros.
 */
export function useUrlParam<T extends string>(name: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = new URLSearchParams(window.location.search).get(name)
      return (v as T) ?? fallback
    } catch {
      return fallback
    }
  })

  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        const url = new URL(window.location.href)
        if (v === fallback) url.searchParams.delete(name)
        else url.searchParams.set(name, v)
        window.history.replaceState(null, '', url.pathname + url.search + url.hash)
      } catch {
        // falha de armazenamento/URL não deve quebrar a aba
      }
    },
    [name, fallback],
  )

  return [value, set]
}
