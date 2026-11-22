import { ArrowUpRight } from 'lucide-react'
import { Badge } from '@/components/ui'
import { t } from '@/lib/i18n'
import { specialtyLabel } from '@/lib/agents'
import { specialtyIcon, specialtyTone } from './catalog'
import type { AgentSpecialty } from '@/lib/agents'

interface Props {
  name: string
  description: string
  specialty: AgentSpecialty
  badge: string
  badgeTone: 'neutral' | 'ok' | 'warn'
  onView: () => void
}

const ICON_BG: Record<string, string> = {
  ok: 'bg-ok/15 text-ok',
  violet: 'bg-violet/15 text-violet',
  warn: 'bg-warn/15 text-warn',
  sky: 'bg-sky/15 text-sky',
}

/** Cartão de agente/template: ícone, nome, descrição, categoria e ação "Ver detalhes". */
export function AgentCard({ name, description, specialty, badge, badgeTone, onView }: Props) {
  const tone = specialtyTone(specialty)
  return (
    <article className="tcard flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${ICON_BG[tone]}`}>{specialtyIcon(specialty)}</span>
        <Badge tone={badgeTone}>{badge}</Badge>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-ink">{name}</h3>
        <p className="mt-1 line-clamp-2 text-xs text-muted">{description}</p>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-xs font-semibold text-subtle">{specialtyLabel(specialty)}</span>
        <button
          type="button"
          onClick={onView}
          className="inline-flex items-center gap-1 text-xs font-semibold text-sky hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
        >
          {t('Ver detalhes', 'View details')} <ArrowUpRight size={14} />
        </button>
      </div>
    </article>
  )
}
