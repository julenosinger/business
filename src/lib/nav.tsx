import { createContext, useContext } from 'react'

export type PageId =
  | 'dashboard'
  | 'accounting'
  | 'finance'
  | 'sales'
  | 'stock'
  | 'purchases'
  | 'logistics'
  | 'customers'
  | 'suppliers'
  | 'hr'
  | 'treasury'
  | 'reports'
  | 'agents'
  | 'chatbot'
  | 'settings'

export type Intent = { kind: 'batch'; ids: string[] } | { kind: 'charge'; accountId: string | null }

/**
 * Intenção de navegação originada em um perfil (Cliente/Fornecedor/Funcionário).
 * A página de destino consome e limpa; nunca executa operações automaticamente.
 */
export type ProfileIntent =
  | { kind: 'sale'; customerId: string }
  | { kind: 'sales'; customerId: string; customerName: string }
  | { kind: 'purchase'; supplierId: string }
  | { kind: 'purchases'; supplierId: string; supplierName: string }
  | { kind: 'account'; accountKind: 'receivable' | 'payable'; contactId: string; contactName: string }
  | { kind: 'accounts'; contactId?: string; employeeId?: string; label: string }

export interface Nav {
  page: PageId
  go: (page: PageId) => void
  /** Conta que o usuário quer pagar pela tesouraria. */
  payAccountId: string | null
  requestPay: (accountId: string | null) => void
  /** Pedido para abrir pagamento em lote ou cobrança na tesouraria. */
  intent: Intent | null
  requestIntent: (intent: Intent | null) => void
  /** Busca pré-preenchida no Razão Geral (ex.: `purchase:PUR-0001`). Nulo = sem foco. */
  ledgerFocus: string | null
  /** Navega para a Contabilidade e abre o Razão Geral filtrado por `query`. */
  focusLedger: (query: string) => void
  /** Limpa o foco do Razão (chamado pela página ao consumir). */
  clearLedgerFocus: () => void
  /** Intenção de navegação originada em um perfil. */
  profileIntent: ProfileIntent | null
  /** Navega para o módulo de destino e entrega a intenção do perfil. */
  openProfileIntent: (i: ProfileIntent) => void
  /** Limpa a intenção do perfil (chamado pela página destino ao consumir). */
  clearProfileIntent: () => void
}

export const NavContext = createContext<Nav | null>(null)

export function useNav(): Nav {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav fora do provider')
  return ctx
}
