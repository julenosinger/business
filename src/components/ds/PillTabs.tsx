import { clsx } from 'clsx'

interface Props<T extends string> {
  value: T
  onChange: (v: T) => void
  items: { id: T; label: string }[]
  /** Rótulo acessível do grupo (ex.: "Período"). */
  label?: string
}

/** Seletor em pílulas no padrão da Tesouraria: item ativo em roxo, foco visível. */
export function PillTabs<T extends string>({ value, onChange, items, label }: Props<T>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={value === it.id}
          onClick={() => onChange(it.id)}
          className={clsx(
            'min-h-8 rounded-full border px-3.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60',
            value === it.id ? 'border-violet/70 bg-violet/25 text-ink' : 'border-line text-muted hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
