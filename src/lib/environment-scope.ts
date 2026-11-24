/**
 * Partição lógica dos dados por ambiente (fase FIN-03.2.1).
 *
 * Mantém a configuração compartilhada legítima (plano de contas, catálogo de categorias, flags,
 * regras fiscais, taxas) e restringe a OPERAÇÃO (eventos, partidas, períodos e registros do ERP)
 * ao ambiente indicado. Registros `unassigned` ficam de fora da visão (nunca misturados).
 *
 * Este módulo fica separado de `selectors.ts` de propósito: os indicadores do DRE/Dashboard não
 * podem depender do razão contábil.
 */
import {
  accountsForEnvironment,
  carriersForEnvironment,
  contactsForEnvironment,
  employeesForEnvironment,
  entriesForEnvironment,
  movesForEnvironment,
  productsForEnvironment,
  purchasesForEnvironment,
  receiptsForEnvironment,
  returnsForEnvironment,
  salesForEnvironment,
  scopedByEnvironment,
  shipmentsForEnvironment,
} from './selectors'
import type { AppData } from './types'
import type { LedgerState } from './accounting/types'
import type { NetworkId } from './network'

export function ledgerForEnvironment(ledger: LedgerState, network: NetworkId): LedgerState {
  return {
    ...ledger,
    events: scopedByEnvironment(ledger.events, network),
    journal: scopedByEnvironment(ledger.journal, network),
    periods: ledger.periods.filter((p) => p.environment === network),
  }
}

/** Dados operacionais + razão isolados por ambiente (para conciliação e balancetes). */
export function appDataForEnvironment(data: AppData, network: NetworkId): AppData {
  return {
    ...data,
    products: productsForEnvironment(data, network),
    moves: movesForEnvironment(data, network),
    sales: salesForEnvironment(data, network),
    purchases: purchasesForEnvironment(data, network),
    contacts: contactsForEnvironment(data, network),
    employees: employeesForEnvironment(data, network),
    shipments: shipmentsForEnvironment(data, network),
    carriers: carriersForEnvironment(data, network),
    returns: returnsForEnvironment(data, network),
    receipts: receiptsForEnvironment(data, network),
    entries: entriesForEnvironment(data, network),
    accounts: accountsForEnvironment(data.accounts, network),
    ledger: ledgerForEnvironment(data.ledger, network),
  }
}
