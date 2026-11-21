import type { ReactNode } from 'react'
import { Hint } from '@/components/ui'
import { TCard } from './Panel'

export type Tone = 'ok' | 'violet' | 'warn' | 'sky' | 'bad'

const ICON_TONE: Record<Tone, string> = {
  ok: 'bg-ok/15 text-ok',
  violet: 'bg-violet/15 text-violet',
  warn: 'bg-warn/15 text-warn',
  sky: 'bg-sky/15 text-sky',
  bad: 'bg-bad/15 text-bad',
}

interface Props {
  tone: Tone
  icon: ReactNode
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  hint?: string
  /** Cor do valor, quando ele tem significado financeiro (ex.: prejuízo). */
  valueTone?: 'ok' | 'bad'
}

/** Cartão de indicador compartilhado: ícone colorido, rótulo, valor grande e linha de apoio. */
export function KpiTile({ tone, icon, label, value, unit, sub, hint, valueTone }: Props) {
  // Valores longos (ex.: -R$ 1.234.567,89) usam fonte menor para não quebrar a linha.
  const long = typeof value === 'string' && value.length > 12
  return (
    <TCard tint={tone === 'bad' ? undefined : tone} className="flex h-full flex-col items-start gap-2.5 p-3.5 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-11 ${ICON_TONE[tone]}`}>{icon}</span>
      <div className="min-w-0 sm:flex-1">
        <div className="text-xs font-semibold text-muted">{label}</div>
        <div className={`display num mt-0.5 flex flex-wrap items-baseline gap-x-1.5 font-semibold leading-tight ${long ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl'} ${valueTone === 'bad' ? 'text-bad' : ''}`}>
          <span className="whitespace-nowrap">{value}</span>
          {unit ? <span className="text-sm font-medium text-muted">{unit}</span> : null}
        </div>
        <div className="mt-0.5 flex min-h-4 flex-wrap items-center gap-x-1.5 text-xs text-subtle">
          {sub}
          {hint ? <Hint text={hint} /> : null}
        </div>
      </div>
    </TCard>
  )
}
