import type { ReactNode } from 'react'
import { BarChart3, BookOpen, Bot, Boxes, Landmark, LayoutDashboard, MessageSquareText, Package, Receipt, Settings, ShoppingBag, ShoppingCart, Truck, UserRound, Users } from 'lucide-react'
import type { PageId } from '@/lib/nav'
import { t } from '@/lib/i18n'

export interface NavEntry {
  id: PageId
  /** Rota estável da página (fonte do sitemap; espelha `PAGE_ROUTES` em `lib/router.ts`). */
  route: string
  label: string
  icon: ReactNode
  badge?: string
}

export interface NavSection {
  id: string
  label: string
  items: NavEntry[]
}

const icon = (node: (p: { size: number; strokeWidth: number }) => ReactNode) => node({ size: 18, strokeWidth: 1.75 })

/** Rótulo (já localizado) de uma página a partir do sitemap. Vazio quando a página não existe. */
export function pageLabel(page: PageId): string {
  for (const s of navSections()) {
    const e = s.items.find((i) => i.id === page)
    if (e) return e.label
  }
  return ''
}

/**
 * Sitemap centralizado do Global Business OS — fonte única da estrutura de navegação.
 * Usa exatamente as páginas que já existem no app (PageId), organizadas em categorias funcionais.
 */
export function navSections(): NavSection[] {
  return [
    {
      id: 'overview',
      label: t('Visão geral', 'Overview'),
      items: [{ id: 'dashboard', route: '/dashboard', label: t('Dashboard', 'Dashboard'), icon: icon((p) => <LayoutDashboard {...p} />) }],
    },
    {
      id: 'commercial',
      label: t('Comercial', 'Commercial'),
      items: [
        { id: 'sales', route: '/sales', label: t('Vendas e PDV', 'Sales and POS'), icon: icon((p) => <ShoppingCart {...p} />) },
        { id: 'purchases', route: '/purchases', label: t('Compras', 'Purchases'), icon: icon((p) => <ShoppingBag {...p} />) },
        { id: 'customers', route: '/customers', label: t('Clientes', 'Customers'), icon: icon((p) => <Users {...p} />) },
        { id: 'suppliers', route: '/suppliers', label: t('Fornecedores', 'Suppliers'), icon: icon((p) => <Truck {...p} />) },
      ],
    },
    {
      id: 'operations',
      label: t('Operações', 'Operations'),
      items: [
        { id: 'stock', route: '/stock', label: t('Produtos e estoque', 'Products and inventory'), icon: icon((p) => <Boxes {...p} />) },
        { id: 'logistics', route: '/logistics', label: t('Logística Global', 'Global Logistics'), icon: icon((p) => <Package {...p} />) },
      ],
    },
    {
      id: 'financial',
      label: t('Financeiro', 'Financial'),
      items: [
        { id: 'treasury', route: '/treasury', label: t('Tesouraria', 'Treasury'), icon: icon((p) => <Landmark {...p} />), badge: 'Circle' },
        { id: 'finance', route: '/finance', label: t('Contas a pagar e receber', 'Payables and receivables'), icon: icon((p) => <Receipt {...p} />) },
        { id: 'accounting', route: '/accounting', label: t('Contabilidade', 'Accounting'), icon: icon((p) => <BookOpen {...p} />) },
        { id: 'reports', route: '/reports', label: t('Relatórios', 'Reports'), icon: icon((p) => <BarChart3 {...p} />) },
      ],
    },
    {
      id: 'management',
      label: t('Gestão', 'Management'),
      items: [
        { id: 'hr', route: '/employees', label: t('Funcionários e folha', 'Employees and payroll'), icon: icon((p) => <UserRound {...p} />) },
        { id: 'agents', route: '/agents', label: t('Agents', 'Agents'), icon: icon((p) => <Bot {...p} />) },
        { id: 'chatbot', route: '/chatbot', label: t('Chatbot', 'Chatbot'), icon: icon((p) => <MessageSquareText {...p} />) },
      ],
    },
    {
      id: 'system',
      label: t('Sistema', 'System'),
      items: [{ id: 'settings', route: '/settings', label: t('Configurações', 'Settings'), icon: icon((p) => <Settings {...p} />) }],
    },
  ]
}
