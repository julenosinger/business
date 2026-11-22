import type { ReactNode } from 'react'
import { BookOpen, Boxes, Landmark, ShoppingCart, Truck, Wallet } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { AgentSpecialty } from '@/lib/agents'

export interface AgentTemplate {
  key: string
  specialty: AgentSpecialty
  name: string
  description: string
}

export function agentTemplates(): AgentTemplate[] {
  return [
    {
      key: 'finance',
      specialty: 'finance',
      name: t('Finance Agent', 'Finance Agent'),
      description: t('Acompanha contas a pagar e a receber e o fluxo de caixa.', 'Tracks payables, receivables and cash flow.'),
    },
    {
      key: 'accounting',
      specialty: 'accounting',
      name: t('Accounting Agent', 'Accounting Agent'),
      description: t('Auxilia no razão geral e nas conciliações contábeis.', 'Assists with the general ledger and accounting reconciliations.'),
    },
    {
      key: 'treasury',
      specialty: 'treasury',
      name: t('Treasury Agent', 'Treasury Agent'),
      description: t('Monitora saldos USDC e pagamentos via Circle Gateway.', 'Monitors USDC balances and Circle Gateway payments.'),
    },
    {
      key: 'sales',
      specialty: 'sales',
      name: t('Sales Agent', 'Sales Agent'),
      description: t('Analisa desempenho de vendas e tendências de receita.', 'Analyzes sales performance and revenue trends.'),
    },
    {
      key: 'inventory',
      specialty: 'inventory',
      name: t('Inventory Agent', 'Inventory Agent'),
      description: t('Monitora níveis de estoque e sugestões de reposição.', 'Monitors stock levels and replenishment suggestions.'),
    },
    {
      key: 'logistics',
      specialty: 'logistics',
      name: t('Logistics Agent', 'Logistics Agent'),
      description: t('Acompanha remessas e o cumprimento de entregas.', 'Follows shipments and delivery fulfillment.'),
    },
  ]
}

export function specialtyIcon(s: AgentSpecialty): ReactNode {
  const p = { size: 20, strokeWidth: 1.75 }
  switch (s) {
    case 'finance':
      return <Wallet {...p} />
    case 'accounting':
      return <BookOpen {...p} />
    case 'treasury':
      return <Landmark {...p} />
    case 'sales':
      return <ShoppingCart {...p} />
    case 'inventory':
      return <Boxes {...p} />
    default:
      return <Truck {...p} />
  }
}

export function specialtyTone(s: AgentSpecialty): 'ok' | 'violet' | 'warn' | 'sky' {
  switch (s) {
    case 'finance':
      return 'ok'
    case 'accounting':
      return 'violet'
    case 'treasury':
      return 'sky'
    case 'sales':
      return 'warn'
    case 'inventory':
      return 'sky'
    default:
      return 'violet'
  }
}
