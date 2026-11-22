import { useState } from 'react'
import { Bot, CheckCircle2, History, PauseCircle, Plus } from 'lucide-react'
import { PageTop } from '@/components/ds/PageTop'
import { KpiTile } from '@/components/ds/KpiTile'
import { PillTabs } from '@/components/ds/PillTabs'
import { Badge, Button, Empty } from '@/components/ui'
import { useAgents } from '@/lib/agents'
import { agentTemplates } from '@/components/agents/catalog'
import { AgentCard } from '@/components/agents/AgentCard'
import { CreateAgentModal } from '@/components/agents/CreateAgentModal'
import { AgentDetailsModal, type AgentDetailsData } from '@/components/agents/AgentDetailsModal'
import { t } from '@/lib/i18n'
import type { AgentSpecialty } from '@/lib/agents'

type Filter = 'all' | 'active' | 'paused' | 'templates'

interface ListItem {
  key: string
  name: string
  description: string
  specialty: AgentSpecialty
  kind: 'template' | 'agent'
  status?: 'active' | 'paused'
  createdAt?: string
}

export function Agents() {
  const agents = useAgents()
  const [filter, setFilter] = useState<Filter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [details, setDetails] = useState<AgentDetailsData | null>(null)

  const templates = agentTemplates()
  const activeCount = agents.filter((a) => a.status === 'active').length
  const pausedCount = agents.filter((a) => a.status === 'paused').length
  const recent = agents[0]

  const templateItems: ListItem[] = templates.map((tp) => ({
    key: `tpl-${tp.key}`,
    name: tp.name,
    description: tp.description,
    specialty: tp.specialty,
    kind: 'template',
  }))
  const agentItems: ListItem[] = agents.map((a) => ({
    key: a.id,
    name: a.name,
    description: a.description,
    specialty: a.specialty,
    kind: 'agent',
    status: a.status,
    createdAt: a.createdAt,
  }))

  const shown: ListItem[] =
    filter === 'templates'
      ? templateItems
      : filter === 'active'
        ? agentItems.filter((a) => a.status === 'active')
        : filter === 'paused'
          ? agentItems.filter((a) => a.status === 'paused')
          : [...agentItems, ...templateItems]

  const filters = [
    { id: 'all' as const, label: `${t('Todos', 'All')} (${agentItems.length + templateItems.length})` },
    { id: 'active' as const, label: `${t('Ativos', 'Active')} (${activeCount})` },
    { id: 'paused' as const, label: `${t('Pausados', 'Paused')} (${pausedCount})` },
    { id: 'templates' as const, label: `${t('Templates', 'Templates')} (${templateItems.length})` },
  ]

  const view = (item: ListItem) =>
    setDetails({
      name: item.name,
      description: item.description,
      specialty: item.specialty,
      kind: item.kind,
      status: item.status,
      createdAt: item.createdAt,
    })

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title="AI Agents"
        subtitle={t('Gerencie os agentes de IA do seu negócio.', 'Manage your business AI agents.')}
        badge={<Badge tone="warn">{t('Preview', 'Preview')}</Badge>}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> {t('Criar agente', 'Create agent')}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="violet" icon={<Bot size={20} />} label={t('Total de agentes', 'Total agents')} value={agents.length} sub={t('configurados', 'configured')} />
        <KpiTile tone="ok" icon={<CheckCircle2 size={20} />} label={t('Ativos', 'Active')} value={activeCount} sub={t('com integração real', 'with real integration')} />
        <KpiTile tone="warn" icon={<PauseCircle size={20} />} label={t('Pausados', 'Paused')} value={pausedCount} sub={t('sem execução', 'without execution')} />
        <KpiTile
          tone="sky"
          icon={<History size={20} />}
          label={t('Atividade recente', 'Recent activity')}
          value={recent ? recent.name : '—'}
          sub={recent ? t('último criado', 'last created') : t('nenhuma atividade', 'no activity')}
        />
      </div>

      <PillTabs label={t('Filtro', 'Filter')} value={filter} onChange={setFilter} items={filters} />

      {shown.length === 0 ? (
        <Empty
          icon={<Bot size={22} />}
          title={t('Nenhum agente aqui', 'No agents here')}
          text={t('Crie um agente para começar, ou explore os templates disponíveis.', 'Create an agent to get started, or explore the available templates.')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {shown.map((item) => (
            <AgentCard
              key={item.key}
              name={item.name}
              description={item.description}
              specialty={item.specialty}
              badge={item.kind === 'template' ? t('Template', 'Template') : t('Pausado', 'Paused')}
              badgeTone={item.kind === 'template' ? 'neutral' : 'warn'}
              onView={() => view(item)}
            />
          ))}
        </div>
      )}

      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <AgentDetailsModal item={details} onClose={() => setDetails(null)} />
    </div>
  )
}
