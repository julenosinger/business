import { Badge, Modal } from '@/components/ui'
import { t } from '@/lib/i18n'
import { specialtyIcon, specialtyTone } from './catalog'
import { specialtyLabel, type AgentSpecialty, type AgentStatus } from '@/lib/agents'
import { fmtDate } from '@/lib/format'

export interface AgentDetailsData {
  name: string
  description: string
  specialty: AgentSpecialty
  kind: 'template' | 'agent'
  status?: AgentStatus
  createdAt?: string
}

const ICON_BG: Record<string, string> = {
  ok: 'bg-ok/15 text-ok',
  violet: 'bg-violet/15 text-violet',
  warn: 'bg-warn/15 text-warn',
  sky: 'bg-sky/15 text-sky',
}

export function AgentDetailsModal({ item, onClose }: { item: AgentDetailsData | null; onClose: () => void }) {
  return (
    <Modal open={item !== null} onClose={onClose} title={item?.name ?? ''}>
      {item ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${ICON_BG[specialtyTone(item.specialty)]}`}>
              {specialtyIcon(item.specialty)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{item.name}</h3>
                {item.kind === 'template' ? <Badge tone="neutral">{t('Template', 'Template')}</Badge> : <Badge tone="warn">{t('Pausado', 'Paused')}</Badge>}
              </div>
              <p className="mt-1 text-xs text-subtle">{specialtyLabel(item.specialty)}</p>
            </div>
          </div>

          <p className="text-sm text-muted text-pretty">{item.description}</p>

          {item.createdAt ? (
            <p className="text-xs text-subtle">
              {t('Criado em', 'Created on')} {fmtDate(item.createdAt)}
            </p>
          ) : null}

          <p className="rounded-xl bg-warn/10 p-3 text-xs text-warn text-pretty">
            {item.kind === 'template'
              ? t(
                  'Este é um modelo de referência, não um agente operacional. A integração com execução de IA será habilitada em uma fase futura.',
                  'This is a reference template, not an operational agent. AI execution will be enabled in a future phase.',
                )
              : t(
                  'Este agente está configurado, mas sem execução de IA nesta fase.',
                  'This agent is configured but has no AI execution in this phase.',
                )}
          </p>
        </div>
      ) : null}
    </Modal>
  )
}
