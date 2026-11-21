/** Globo decorativo estático atrás do cabeçalho (sem animação). */
export function GlobeBackdrop() {
  const stroke = 'rgb(var(--blue-rgb) / 0.28)'
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-8 h-56 overflow-hidden">
      <svg viewBox="0 0 640 260" className="globe absolute -right-32 top-0 h-full w-[560px] max-w-none sm:right-0 lg:right-16" fill="none">
        <defs>
          <radialGradient id="globe-glow" cx="50%" cy="100%" r="70%">
            <stop offset="0%" stopColor="rgb(var(--blue-rgb))" stopOpacity="0.35" />
            <stop offset="60%" stopColor="rgb(var(--blue-rgb))" stopOpacity="0.08" />
            <stop offset="100%" stopColor="rgb(var(--blue-rgb))" stopOpacity="0" />
          </radialGradient>
          <clipPath id="globe-clip">
            <rect x="0" y="0" width="640" height="260" />
          </clipPath>
        </defs>
        <ellipse cx="320" cy="300" rx="300" ry="200" fill="url(#globe-glow)" />
        <g clipPath="url(#globe-clip)" style={{ stroke }} strokeWidth="1">
          <circle cx="320" cy="300" r="250" />
          <ellipse cx="320" cy="300" rx="180" ry="250" />
          <ellipse cx="320" cy="300" rx="90" ry="250" />
          <ellipse cx="320" cy="300" rx="250" ry="70" />
          <ellipse cx="320" cy="300" rx="250" ry="140" />
          <line x1="320" y1="50" x2="320" y2="300" />
        </g>
      </svg>
    </div>
  )
}
