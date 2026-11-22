import { useSyncExternalStore } from 'react'
import { t } from './i18n'
import { today } from './format'

export type AgentSpecialty = 'finance' | 'accounting' | 'treasury' | 'sales' | 'inventory' | 'logistics'

/** Um agente criado pelo usuário nunca é `active` nesta fase: não há execução/integração real. */
export type AgentStatus = 'active' | 'paused'

export interface AgentRecord {
  id: string
  name: string
  description: string
  specialty: AgentSpecialty
  status: AgentStatus
  createdAt: string
}

export const SPECIALTIES: AgentSpecialty[] = ['finance', 'accounting', 'treasury', 'sales', 'inventory', 'logistics']

export function specialtyLabel(s: AgentSpecialty): string {
  switch (s) {
    case 'finance':
      return t('Financeiro', 'Finance')
    case 'accounting':
      return t('Contabilidade', 'Accounting')
    case 'treasury':
      return t('Tesouraria', 'Treasury')
    case 'sales':
      return t('Vendas', 'Sales')
    case 'inventory':
      return t('Estoque', 'Inventory')
    default:
      return t('Logística', 'Logistics')
  }
}

const KEY = 'gbos:agents'
const listeners = new Set<() => void>()

function read(): AgentRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (a): a is AgentRecord =>
        typeof a === 'object' && a !== null && typeof (a as AgentRecord).id === 'string' && typeof (a as AgentRecord).name === 'string',
    )
  } catch {
    return []
  }
}

let agents: AgentRecord[] = read()

function commit(next: AgentRecord[]): void {
  agents = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // configuração preliminar: falha de armazenamento não deve quebrar a tela
  }
  listeners.forEach((l) => l())
}

const newId = (): string => crypto.randomUUID().slice(0, 12)

/** Cria um agente como configuração PRELIMINAR (status `paused`), sem execução de IA. */
export function addAgent(input: { name: string; description: string; specialty: AgentSpecialty }): string {
  const id = newId()
  const record: AgentRecord = { id, ...input, status: 'paused', createdAt: today() }
  commit([record, ...agents])
  return id
}

export function removeAgent(id: string): void {
  commit(agents.filter((a) => a.id !== id))
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useAgents(): AgentRecord[] {
  return useSyncExternalStore(subscribe, () => agents)
}
