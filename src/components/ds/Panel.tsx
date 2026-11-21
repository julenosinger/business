import type { ReactNode } from 'react'
import { clsx } from 'clsx'

/** Painel padrão da Tesouraria. */
export function TCard({ className, children, tint, id }: { className?: string; children: ReactNode; tint?: 'ok' | 'violet' | 'warn' | 'sky'; id?: string }) {
  const tints = {
    ok: 'border-ok/30 bg-gradient-to-br from-ok/10 to-transparent',
    violet: 'border-violet/30 bg-gradient-to-br from-violet/10 to-transparent',
    warn: 'border-warn/30 bg-gradient-to-br from-warn/10 to-transparent',
    sky: 'border-sky/30 bg-gradient-to-br from-sky/10 to-transparent',
  }
  return <section id={id} className={clsx('tcard relative min-w-0', tint && tints[tint], className)}>{children}</section>
}

export function PanelTitle({ icon, title, subtitle, action }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 shrink-0 text-sky">{icon}</span>
        <div className="min-w-0">
          <h2 className="display text-base font-semibold leading-tight">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-subtle">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  )
}
