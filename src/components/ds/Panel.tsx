import type { ReactNode } from 'react'
import { clsx } from 'clsx'

/** Painel padrão da Tesouraria. */
interface TCardProps {
  className?: string
  children: ReactNode
  tint?: 'ok' | 'violet' | 'warn' | 'sky'
  id?: string
  /** Quando definido, o painel vira um botão (ex.: cartão de indicador que filtra uma lista). */
  onClick?: () => void
  /** Estado de seleção do botão (aria-pressed). */
  pressed?: boolean
}

export function TCard({ className, children, tint, id, onClick, pressed }: TCardProps) {
  const tints = {
    ok: 'border-ok/30 bg-gradient-to-br from-ok/10 to-transparent',
    violet: 'border-violet/30 bg-gradient-to-br from-violet/10 to-transparent',
    warn: 'border-warn/30 bg-gradient-to-br from-warn/10 to-transparent',
    sky: 'border-sky/30 bg-gradient-to-br from-sky/10 to-transparent',
  }
  if (onClick) {
    return (
      <button
        type="button"
        id={id}
        onClick={onClick}
        aria-pressed={pressed}
        className={clsx(
          'tcard relative min-w-0 w-full cursor-pointer text-left transition-[border-color,background-color,box-shadow] duration-150 hover:border-accent/50 hover:bg-fill/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 motion-reduce:transition-none',
          tint && tints[tint],
          pressed && '!border-violet/70 !bg-violet/10 ring-1 ring-violet/40',
          className,
        )}
      >
        {children}
      </button>
    )
  }
  return (
    <section id={id} className={clsx('tcard relative min-w-0', tint && tints[tint], className)}>
      {children}
    </section>
  )
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
