import { C } from '@/components/charts'

interface Props {
  labels: string[]
  a: number[]
  b: number[]
  aLabel: string
  bLabel: string
  aColor?: string
  bColor?: string
}

/** Barras agrupadas para contagens inteiras (o AreaChart do app formata valores como moeda). */
export function CountBars({ labels, a, b, aLabel, bLabel, aColor = C.accent, bColor = C.ok }: Props) {
  const W = 600
  const H = 190
  const pad = { l: 34, r: 8, t: 10, b: 26 }
  const max = Math.max(1, ...a, ...b)
  const top = Math.ceil(max / (max > 4 ? 2 : 1)) * (max > 4 ? 2 : 1)
  const ticks = [0, Math.round(top / 2), top].filter((v, i, arr) => arr.indexOf(v) === i)
  const slot = (W - pad.l - pad.r) / Math.max(labels.length, 1)
  const bw = Math.min(14, slot / 2.6)
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b)
  const every = Math.ceil(labels.length / 7)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${aLabel} / ${bLabel}`}>
      {ticks.map((tk) => (
        <g key={tk}>
          <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} style={{ stroke: C.grid }} />
          <text x={pad.l - 6} y={y(tk) + 4} textAnchor="end" fontSize="10" style={{ fill: C.text }}>
            {tk}
          </text>
        </g>
      ))}
      {labels.map((l, i) => {
        const cx = pad.l + slot * i + slot / 2
        const av = a[i] ?? 0
        const bv = b[i] ?? 0
        return (
          <g key={`${l}-${i}`}>
            <title>{`${l}: ${aLabel} ${av} · ${bLabel} ${bv}`}</title>
            <rect x={cx - bw - 1} y={y(av)} width={bw} height={Math.max(0, y(0) - y(av))} rx="2" style={{ fill: aColor }} />
            <rect x={cx + 1} y={y(bv)} width={bw} height={Math.max(0, y(0) - y(bv))} rx="2" style={{ fill: bColor }} />
            {i % every === 0 ? (
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" style={{ fill: C.text }}>
                {l}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
