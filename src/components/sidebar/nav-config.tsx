import type { ReactNode } from 'react'
import { BarChart3, BookOpen, Bot, Boxes, Landmark, LayoutDashboard, MessageSquareText, Package, Receipt, Settings, ShoppingBag, ShoppingCart, Truck, UserRound, Users } from 'lucide-react'
import type { PageId } from '@/lib/nav'
import { t } from '@/lib/i18n'

export interface NavEntry {
  id: PageId
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

/** Menu agrupado. Usa exatamente as páginas que já existem no app (PageId). */
export function navSections(): NavSection[] {
  return [
    {
      id: 'workspace',
      label: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: icon((p) => <LayoutDashboard {...p} />) },
        { id: 'accounting', label: t('Contabilidade', 'Accounting'), icon: icon((p) => <BookOpen {...p} />) },
        { id: 'finance', label: t('Contas a pagar e receber', 'Payables and receivables'), icon: icon((p) => <Receipt {...p} />) },
        { id: 'sales', label: t('Vendas e PDV', 'Sales and POS'), icon: icon((p) => <ShoppingCart {...p} />) },
        { id: 'stock', label: t('Estoque', 'Inventory'), icon: icon((p) => <Boxes {...p} />) },
        { id: 'purchases', label: t('Compras', 'Purchases'), icon: icon((p) => <ShoppingBag {...p} />) },
        { id: 'logistics', label: t('Logística Global', 'Global Logistics'), icon: icon((p) => <Package {...p} />) },
      ],
    },
    {
      id: 'relations',
      label: t('Relacionamento', 'Relationships'),
      items: [
        { id: 'customers', label: t('Clientes', 'Customers'), icon: icon((p) => <Users {...p} />) },
        { id: 'suppliers', label: t('Fornecedores', 'Suppliers'), icon: icon((p) => <Truck {...p} />) },
        { id: 'hr', label: t('Funcionários', 'Employees'), icon: icon((p) => <UserRound {...p} />) },
      ],
    },
    {
      id: 'global',
      label: t('Financeiro global', 'Global finance'),
      items: [
        { id: 'treasury', label: t('Tesouraria', 'Treasury'), icon: icon((p) => <Landmark {...p} />), badge: 'Circle' },
        { id: 'reports', label: t('Relatórios', 'Reports'), icon: icon((p) => <BarChart3 {...p} />) },
      ],
    },
    {
      id: 'ai',
      label: t('Inteligência artificial', 'Artificial intelligence'),
      items: [
        { id: 'agents', label: t('Agents', 'Agents'), icon: icon((p) => <Bot {...p} />) },
        { id: 'chatbot', label: t('Chatbot', 'Chatbot'), icon: icon((p) => <MessageSquareText {...p} />) },
      ],
    },
    {
      id: 'system',
      label: t('Sistema', 'System'),
      items: [{ id: 'settings', label: t('Configurações', 'Settings'), icon: icon((p) => <Settings {...p} />) }],
    },
  ]
}
