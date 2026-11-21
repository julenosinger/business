import { clsx } from 'clsx'
import { RailTip } from './RailTip'
import type { NavEntry } from './nav-config'

interface Props {
  entry: NavEntry
  active: boolean
  collapsed: boolean
  /** Falso quando o item está dentro de um grupo recolhido: sai da ordem de tabulação. */
  focusable?: boolean
  onPick: (entry: NavEntry) => void
}

export function NavItem({ entry, active, collapsed, focusable = true, onPick }: Props) {
  return (
    <RailTip label={entry.label} enabled={collapsed}>
      <button
        type="button"
        data-nav-item
        tabIndex={focusable ? 0 : -1}
        aria-current={active && focusable ? 'page' : undefined}
        aria-label={collapsed ? entry.label : undefined}
        onClick={() => onPick(entry)}
        className={clsx(
          'group relative flex items-center rounded-xl text-sm font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          collapsed ? 'mx-auto size-11 justify-center' : 'min-h-10 w-full gap-3 px-3',
          active ? 'bg-accent/15 text-ink' : 'text-muted hover:bg-fill/10 hover:text-ink',
        )}
      >
        {active ? <span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent" /> : null}
        <span className={clsx('shrink-0 transition-colors', active ? 'text-accent' : 'text-subtle group-hover:text-ink')}>{entry.icon}</span>
        {collapsed ? (
          entry.badge ? <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-violet" /> : null
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
            {entry.badge ? <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-bold', active ? 'bg-accent/20 text-accent' : 'bg-violet/15 text-violet')}>{entry.badge}</span> : null}
          </>
        )}
      </button>
    </RailTip>
  )
}
