import type { ReactNode } from 'react'
import { GlobeBackdrop } from './GlobeBackdrop'

interface Props {
  title: string
  subtitle?: string
  /** Selo ao lado do título (ex.: ambiente ou integração). */
  badge?: ReactNode
  actions?: ReactNode
}

/** Cabeçalho de página no padrão da Tesouraria: título grande, subtítulo, ações à direita e globo decorativo. */
export function PageTop({ title, subtitle, badge, actions }: Props) {
  return (
    <header className="relative">
      <GlobeBackdrop />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="display text-3xl font-semibold text-balance sm:text-4xl">{title}</h1>
            {badge}
          </div>
          {subtitle ? <p className="mt-2 max-w-lg text-sm text-muted text-pretty">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}
