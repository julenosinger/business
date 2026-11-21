import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  label: string
  /** Só mostra a dica quando o menu está recolhido (rótulo escondido). */
  enabled: boolean
  children: ReactNode
  className?: string
}

/** Dica flutuante ao passar o mouse ou focar com o teclado. Renderiza fora do menu para não ser cortada. */
export function RailTip({ label, enabled, children, className }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const visible = enabled && pos !== null

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPos(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setPos({ top: r.top + r.height / 2, left: r.right + 10 })
  }

  return (
    <span
      className={className ?? 'block'}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setPos(null)}
      onFocus={(e) => {
        // só mostra no foco por teclado, não no clique
        if ((e.target).matches(':focus-visible')) show(e.currentTarget)
      }}
      onBlur={() => setPos(null)}
    >
      {children}
      {visible && pos
        ? createPortal(
            <span
              aria-hidden="true"
              className="pointer-events-none fixed z-[70] -translate-y-1/2 whitespace-nowrap rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-semibold text-ink shadow-lg"
              style={{ top: pos.top, left: pos.left }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  )
}
