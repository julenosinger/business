import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { clsx } from 'clsx'
import { t } from '@/lib/i18n'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx('rounded-2xl border border-line bg-surface p-4 sm:p-5 backdrop-blur', className)}>{children}</section>
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="display text-base font-semibold text-ink">{children}</h3>
      {action}
    </div>
  )
}

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110',
  ghost: 'border border-line text-ink hover:bg-surface-strong',
  subtle: 'bg-surface-strong text-ink hover:bg-fill/15',
  danger: 'border border-bad/40 text-bad hover:bg-bad/10',
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  small?: boolean
}

export function Button({ variant = 'primary', small, className, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        small ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4 text-sm',
        variants[variant],
        className,
      )}
    />
  )
}

export const inputCls =
  'w-full min-h-11 rounded-xl border border-line bg-fill/5 px-3 text-sm text-ink placeholder:text-subtle outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'

export function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">
        {label}
        {required ? (
          <span className="text-bad" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-subtle">{hint}</span> : null}
    </label>
  )
}

type Tone = 'ok' | 'bad' | 'warn' | 'neutral' | 'accent'
const tones: Record<Tone, string> = {
  ok: 'bg-ok/15 text-ok',
  bad: 'bg-bad/15 text-bad',
  warn: 'bg-warn/15 text-warn',
  neutral: 'bg-fill/10 text-muted',
  accent: 'bg-accent/15 text-accent',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="display text-2xl font-semibold text-balance sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-xl text-sm text-muted text-pretty">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string
  value: string
  sub?: ReactNode
  tone?: 'ok' | 'bad'
  icon?: ReactNode
}) {
  return (
    <Card className="!p-4">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {icon ? <span className="text-subtle">{icon}</span> : null}
      </div>
      <div className={clsx('display num mt-2 text-2xl font-semibold', tone === 'ok' && 'text-ok', tone === 'bad' && 'text-bad')}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </Card>
  )
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-strong text-accent">{icon}</div>
      <p className="display text-base font-semibold">{title}</p>
      {text ? <p className="max-w-sm text-sm text-muted text-pretty">{text}</p> : null}
      {action}
    </div>
  )
}

export function Modal({
  open,
  title,
  subtitle,
  icon,
  onClose,
  children,
  wide,
  size,
}: {
  open: boolean
  title: string
  subtitle?: ReactNode
  icon?: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /** Largura do modal. `form` = formulário empresarial (~720px). */
  size?: 'md' | 'lg' | 'form'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const maxW = size === 'form' ? 'sm:max-w-[720px]' : size === 'lg' ? 'sm:max-w-2xl' : wide ? 'sm:max-w-2xl' : 'sm:max-w-md'

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 !mt-0 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={clsx(
              'max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-panel p-5 shadow-2xl sm:rounded-3xl sm:p-6',
              maxW,
            )}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                {icon ? <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">{icon}</span> : null}
                <div className="min-w-0">
                  <h2 className="display text-xl font-semibold leading-tight">{title}</h2>
                  {subtitle ? <p className="mt-0.5 text-sm text-muted text-pretty">{subtitle}</p> : null}
                </div>
              </div>
              <button onClick={onClose} aria-label={t('Fechar', 'Close')} className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-fill/5 p-1">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={clsx(
            'min-h-9 rounded-lg px-3 text-sm font-semibold transition',
            value === it.id ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export const th = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle whitespace-nowrap'
export const td = 'px-3 py-3 text-sm whitespace-nowrap'

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse [&_tbody_tr]:border-t [&_tbody_tr]:border-line">{children}</table>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={clsx('animate-pulse rounded-lg bg-fill/10 motion-reduce:animate-none', className)} />
}

/** Dica acessível: botão focável com texto no atributo title e no rótulo. */
export function Hint({ text }: { text: string }) {
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={text}
      title={text}
      className="inline-flex size-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-bold text-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      i
    </span>
  )
}
