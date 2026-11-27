import { describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

try {
  GlobalRegistrator.register()
} catch {
  // já registrado
}

const { PAGE_ROUTES, DEFAULT_PAGE, pageFromPath, routeFor } = await import('../src/lib/router')
const { navSections } = await import('../src/components/sidebar/nav-config')
import type { PageId } from '../src/lib/nav'

const ALL_PAGES: PageId[] = [
  'dashboard',
  'accounting',
  'finance',
  'sales',
  'stock',
  'purchases',
  'logistics',
  'customers',
  'suppliers',
  'hr',
  'treasury',
  'reports',
  'agents',
  'chatbot',
  'settings',
]

describe('roteamento (sitemap de rotas) — UI/UX NAVIGATION 1.0', () => {
  test('cada página tem uma rota estável e o mapeamento é bidirecional', () => {
    for (const p of ALL_PAGES) {
      expect(routeFor(p)).toBeTruthy()
      expect(routeFor(p).startsWith('/')).toBe(true)
      expect(pageFromPath(routeFor(p))).toBe(p)
    }
  })

  test('PAGE_ROUTES cobre exatamente as páginas conhecidas', () => {
    expect(Object.keys(PAGE_ROUTES).sort()).toEqual([...ALL_PAGES].sort())
  })

  test('sitemap (nav-config) e PAGE_ROUTES permanecem em sincronia', () => {
    const entries = navSections().flatMap((s) => s.items)
    expect(entries.map((e) => e.id).sort()).toEqual([...ALL_PAGES].sort())
    for (const e of entries) {
      expect(e.route).toBe(PAGE_ROUTES[e.id])
    }
  })

  test('sitemap organiza as categorias funcionais esperadas', () => {
    const ids = navSections().map((s) => s.id)
    expect(ids).toEqual(['overview', 'commercial', 'operations', 'financial', 'management', 'system'])
    const byId = Object.fromEntries(navSections().map((s) => [s.id, s.items.map((i) => i.id)]))
    expect(byId.overview).toEqual(['dashboard'])
    expect(byId.commercial).toEqual(['sales', 'purchases', 'customers', 'suppliers'])
    expect(byId.operations).toEqual(['stock', 'logistics'])
    expect(byId.financial).toEqual(['treasury', 'finance', 'accounting', 'reports'])
    expect(byId.management).toEqual(['hr', 'agents', 'chatbot'])
    expect(byId.system).toEqual(['settings'])
  })

  test('pathname desconhecido ou público retorna null (não é rota de página)', () => {
    expect(pageFromPath('/')).toBeNull()
    expect(pageFromPath('/nope')).toBeNull()
    expect(pageFromPath('/checkout/abc')).toBeNull()
    expect(pageFromPath('/')).toBeNull()
  })

  test('pathname com barra final normaliza para a página correta', () => {
    expect(pageFromPath('/sales/')).toBe('sales')
    expect(pageFromPath('/treasury/')).toBe('treasury')
  })

  test('rota padrão é a Dashboard', () => {
    expect(DEFAULT_PAGE).toBe('dashboard')
  })
})
