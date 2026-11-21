import { useId } from 'react'
import { moneyCompact } from '@/lib/format'
import { t } from '@/lib/i18n'

/** Theme-aware colors (resolve to the active theme's CSS variables). */
export const C = {
  accent: 'rgb(var(--accent-rgb))',
  ok: 'rgb(var(--ok-rgb))',
  bad: 'rgb(var(--bad-rgb))',
  warn: 'rgb(var(--warn-rgb))',
  grid: 'rgb(var(--fill-rgb) / 0.1)',
  text: 'var(--subtle)',
}

export interface Series {
  name: string
  color: string
  values: number[]
}

export function AreaChart({ labels, series, height = 220 }: { labels: string[]; series: Series[]; height?: number }) {
  const gid = useId()
  const W = 640
  const H = height
  const pad = { l: 52, r: 12, t: 12, b: 26 }
  const all = series.flatMap((s) => s.values)
  const max = Math.max(1, ...all)
  const min = Math.min(0, ...all)
  const span = max - min || 1
  const x = (i: number) => pad.l + (labels.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (labels.length - 1))
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((tk) => min + tk * span)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('Gráfico de evolução mensal', 'Monthly trend chart')}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={s.name} id={`${gid}-${i}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.32 }} />
            <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
          </linearGradient>
        ))}
      </defs>
      {ticks.map((tk) => (
        <g key={tk}>
          <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} style={{ stroke: C.grid }} />
          <text x={pad.l - 8} y={y(tk) + 4} textAnchor="end" fontSize="10" style={{ fill: C.text }}>
            {moneyCompact(tk)}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <text key={l + i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" style={{ fill: C.text }}>
          {l}
        </text>
      ))}
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`)
        const area = `M${x(0)},${y(min)} L${pts.join(' L')} L${x(s.values.length - 1)},${y(min)} Z`
        return (
          <g key={s.name}>
            <path d={area} fill={`url(#${gid}-${si})`} />
            <polyline points={pts.join(' ')} fill="none" style={{ stroke: s.color }} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="3" style={{ fill: s.color }} />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

export interface Segment {
  label: string
  value: number
  color: string
}

export function Donut({ segments, size = 168, thickness = 22, children }: { segments: Segment[]; size?: number; thickness?: number; children?: React.ReactNode }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const arcs = segments.map((s, i) => {
    const len = total > 0 ? (Math.max(0, s.value) / total) * c : 0
    const start = segments.slice(0, i).reduce((acc, x) => acc + (total > 0 ? (Math.max(0, x.value) / total) * c : 0), 0)
    return { s, len, start }
  })
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={t('Distribuição', 'Distribution')}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: C.grid }} strokeWidth={thickness} />
        {total > 0
          ? arcs.map(({ s, len, start }) => (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                style={{ stroke: s.color }}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`}
                strokeDashoffset={-start}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            ))
          : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

export function Bar({ value, max, color = C.accent }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-fill/10">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  )
}
