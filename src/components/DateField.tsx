import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { inputCls } from '@/components/ui'
import { addDaysIso, addMonthsIso, dateIssue, formatIso, inRange, isValidIso, isValidTime, joinDateTime, maskDigits, maskTime, monthGrid, parseText, placeholder, splitDateTime, weekday, type DateIssue } from '@/lib/dates'
import { today } from '@/lib/format'
import { locale, t, useLang } from '@/lib/i18n'

/**
 * Seletor de data localizado. O <input type="date"> nativo segue o idioma do sistema e não o do app, então aqui:
 *  - o campo mostra dd/mm/aaaa em português e mm/dd/yyyy em inglês, com máscara e validação;
 *  - o calendário usa os nomes de mês e dia do idioma do app;
 *  - o valor que sai (onChange) é sempre ISO (YYYY-MM-DD), ou '' quando vazio, incompleto ou fora do intervalo.
 * Tudo é calculado em UTC, então a data nunca anda um dia por causa do fuso.
 */
interface Props {
  value: string
  onChange: (iso: string) => void
  min?: string
  max?: string
  disabled?: boolean
  /** Classes extras do campo de texto. */
  className?: string
  /** Classes do contêiner (largura). */
  wrapperClassName?: string
  /** Avisa quando o texto digitado não vira uma data utilizável (incompleto, inexistente ou fora do intervalo). Campos opcionais usam isso para bloquear o envio. */
  onInvalidChange?: (invalid: boolean) => void
  'aria-label'?: string
  id?: string
}

const FOCUSABLE = 'button:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
/** O usuário apagou exatamente um caractere que não era dígito (uma barra). */
const deletedSeparator = (prev: string, raw: string): boolean => raw.length === prev.length - 1 && [...prev].some((c, i) => /\D/.test(c) && prev.slice(0, i) + prev.slice(i + 1) === raw)
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const issueText = (i: DateIssue): string =>
  i === 'incomplete' ? t('Data incompleta.', 'Incomplete date.') : i === 'invalid' ? t('Data inválida.', 'Invalid date.') : t('Data fora do intervalo permitido.', 'Date outside the allowed range.')

function Calendar({ selected, cursor, setCursor, min, max, onPick, onClear, onClose, popRef }: { selected: string; cursor: string; setCursor: (iso: string) => void; min?: string; max?: string; onPick: (iso: string) => void; onClear: () => void; onClose: () => void; popRef: React.RefObject<HTMLDivElement | null> }) {
  const loc = locale()
  const grid = monthGrid(cursor)
  const [year, month] = cursor.split('-').map(Number) as [number, number]
  const todayIso = today()
  const fmt = (opts: Intl.DateTimeFormatOptions, iso: string): string => new Intl.DateTimeFormat(loc, { ...opts, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
  const months = Array.from({ length: 12 }, (_, i) => cap(fmt({ month: 'long' }, `2026-${String(i + 1).padStart(2, '0')}-01`)))
  const weekdays = grid[0]?.map((d) => cap(fmt({ weekday: 'short' }, d)).replace('.', '')) ?? []
  const nowYear = Number(todayIso.slice(0, 4))
  const minYear = Math.min(min ? Number(min.slice(0, 4)) : nowYear - 80, year)
  const maxYear = Math.max(max ? Number(max.slice(0, 4)) : nowYear + 20, year)
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)

  // O foco acompanha o dia atual do cursor (sem rolar a página, para não fechar o calendário).
  useEffect(() => {
    popRef.current?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)?.focus({ preventScroll: true })
  }, [cursor, popRef])

  const onKey = (e: React.KeyboardEvent) => {
    const step: Record<string, string> = {
      ArrowLeft: addDaysIso(cursor, -1),
      ArrowRight: addDaysIso(cursor, 1),
      ArrowUp: addDaysIso(cursor, -7),
      ArrowDown: addDaysIso(cursor, 7),
      Home: addDaysIso(cursor, -weekday(cursor)),
      End: addDaysIso(cursor, 6 - weekday(cursor)),
      PageUp: addMonthsIso(cursor, e.shiftKey ? -12 : -1),
      PageDown: addMonthsIso(cursor, e.shiftKey ? 12 : 1),
    }
    const next = step[e.key]
    if (next) {
      e.preventDefault()
      setCursor(next)
    }
  }

  // Tab fica dentro do calendário.
  const onTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !popRef.current) return
    const items = Array.from(popRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const navBtn = 'flex size-9 items-center justify-center rounded-lg text-muted hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60'
  const sel = 'h-9 rounded-lg border border-line bg-panel px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60'

  return (
    <div onKeyDown={onTab}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" className={navBtn} aria-label={t('Mês anterior', 'Previous month')} onClick={() => setCursor(addMonthsIso(cursor, -1))}>
          <ChevronLeft size={18} />
        </button>
        <div className="flex items-center gap-1">
          <select aria-label={t('Mês', 'Month')} className={sel} value={month} onChange={(e) => setCursor(`${String(year).padStart(4, '0')}-${String(Number(e.target.value)).padStart(2, '0')}-01`)}>
            {months.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select aria-label={t('Ano', 'Year')} className={sel} value={year} onChange={(e) => setCursor(`${e.target.value}-${String(month).padStart(2, '0')}-01`)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={navBtn} aria-label={t('Próximo mês', 'Next month')} onClick={() => setCursor(addMonthsIso(cursor, 1))}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div role="grid" aria-label={`${months[month - 1]} ${year}`} onKeyDown={onKey}>
        <div role="row" className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wider text-subtle">
          {weekdays.map((w, i) => (
            <span key={i} role="columnheader" className="py-1">
              {w}
            </span>
          ))}
        </div>
        {grid.map((week, wi) => (
          <div key={wi} role="row" className="grid grid-cols-7">
            {week.map((d) => {
              const inMonth = d.slice(0, 7) === cursor.slice(0, 7)
              const allowed = inRange(d, min, max)
              const isSel = d === selected
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  data-day={d}
                  tabIndex={d === cursor ? 0 : -1}
                  disabled={!allowed}
                  aria-selected={isSel}
                  aria-current={d === todayIso ? 'date' : undefined}
                  aria-label={fmt({ dateStyle: 'full' }, d)}
                  onClick={() => onPick(d)}
                  className={clsx(
                    'num m-0.5 flex size-9 items-center justify-center rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                    isSel ? 'bg-violet font-semibold text-accent-ink' : d === todayIso ? 'border border-violet/60' : '',
                    !isSel && inMonth && allowed && 'hover:bg-fill/10',
                    !inMonth && 'text-subtle',
                    !allowed && 'cursor-not-allowed opacity-30',
                  )}
                >
                  {Number(d.slice(8))}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <button type="button" disabled={!inRange(todayIso, min, max)} className="rounded-lg px-2 py-1.5 text-sm font-medium text-accent hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40" onClick={() => onPick(todayIso)}>
          {t('Hoje', 'Today')}
        </button>
        <div className="flex gap-1">
          <button type="button" className="rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={onClear}>
            {t('Limpar', 'Clear')}
          </button>
          <button type="button" className="rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={onClose}>
            {t('Fechar', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DateField({ value, onChange, min, max, disabled, className, wrapperClassName, id, onInvalidChange, ...rest }: Props) {
  const { lang } = useLang()
  const [text, setText] = useState(() => formatIso(value, lang))
  const [seen, setSeen] = useState({ value, lang })
  const [touched, setTouched] = useState(false)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(() => (isValidIso(value) ? value : today()))
  const [pos, setPos] = useState({ top: 0, left: 0, sheet: false })
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const errId = useId()

  // Valor externo ou idioma mudou: reescreve o texto (o que já representa o mesmo valor não é tocado).
  if (seen.value !== value || seen.lang !== lang) {
    setSeen({ value, lang })
    if (seen.lang !== lang || (parseText(text, lang) ?? '') !== value) setText(formatIso(value, lang))
  }

  const issue = touched || text.replace(/\D/g, '').length >= 8 ? dateIssue(text, lang, min, max) : null

  const emit = (masked: string) => {
    const iso = parseText(masked, lang)
    onChange(iso && inRange(iso, min, max) ? iso : '')
    onInvalidChange?.(masked.trim() !== '' && !(iso && inRange(iso, min, max)))
  }

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      // ISO direto (colar ou automação): reescreve no formato do idioma.
      const iso = parseText(raw, lang)
      const masked = iso ? formatIso(iso, lang) : raw
      setText(masked)
      onChange(iso && inRange(iso, min, max) ? iso : '')
      onInvalidChange?.(!(iso && inRange(iso, min, max)))
      return
    }
    let digits = raw.replace(/\D/g, '')
    // Apagar só uma barra "não faz nada" na máscara: apaga o dígito anterior. (Substituir o texto todo não cai aqui.)
    if (deletedSeparator(text, raw)) digits = digits.slice(0, -1)
    const masked = maskDigits(digits, lang)
    setText(masked)
    emit(masked)
  }

  /** Posiciona o calendário junto ao campo (ou como folha inferior no celular). Também é usado quando a tela rola. */
  const place = () => {
    const r = wrapRef.current?.getBoundingClientRect()
    const sheet = window.innerWidth < 640
    if (!r) return
    const width = 308
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8))
    const below = r.bottom + 6
    setPos({ top: below + 372 > window.innerHeight && r.top > 380 ? r.top - 378 : below, left, sheet })
  }

  const openCalendar = () => {
    if (disabled) return
    place()
    setCursor(isValidIso(value) ? value : inRange(today(), min, max) ? today() : (min ?? today()))
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) inputRef.current?.focus()
  }

  // Fechar com Esc sem fechar o formulário ou a gaveta que contêm o campo; clique fora, rolagem e redimensionamento também fecham.
  useEffect(() => {
    if (!open) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      inputRef.current?.focus()
    }
    const onDown = (e: MouseEvent) => {
      const el = e.target as Node
      if (!popRef.current?.contains(el) && !wrapRef.current?.contains(el)) setOpen(false)
    }
    // Rolagem ou redimensionamento: o calendário acompanha o campo (nunca fecha por um ajuste de rolagem do navegador).
    const onMove = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return
      place()
    }
    window.addEventListener('keydown', onEsc, true)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('keydown', onEsc, true)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  const pick = (iso: string) => {
    if (!inRange(iso, min, max)) return
    setText(formatIso(iso, lang))
    setTouched(true)
    onChange(iso)
    onInvalidChange?.(false)
    close()
  }

  return (
    <div ref={wrapRef} className={clsx('relative', wrapperClassName)}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        aria-label={rest['aria-label']}
        aria-invalid={issue ? true : undefined}
        aria-describedby={issue ? errId : undefined}
        placeholder={placeholder(lang)}
        className={clsx(inputCls, 'num pr-11', issue && 'border-bad/60', className)}
        value={text}
        onChange={onInput}
        onBlur={() => setTouched(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && (e.altKey || !text)) {
            e.preventDefault()
            openCalendar()
          }
        }}
      />
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-label={t('Abrir calendário', 'Open calendar')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openCalendar())}
        className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
      >
        <CalendarDays size={18} />
      </button>
      {issue ? (
        <p id={errId} role="alert" className="mt-1 text-xs text-bad">
          {issueText(issue)}
        </p>
      ) : null}
      {open
        ? createPortal(
            <>
              {pos.sheet ? <div className="fixed inset-0 z-[80] bg-black/50" aria-hidden="true" onMouseDown={() => setOpen(false)} /> : null}
              <div
                ref={popRef}
                role="dialog"
                aria-label={t('Escolher data', 'Choose a date')}
                style={pos.sheet ? undefined : { top: pos.top, left: pos.left, width: 308 }}
                className={clsx('fixed z-[90] border border-line bg-panel p-3 shadow-2xl', pos.sheet ? 'inset-x-0 bottom-0 rounded-t-2xl pb-5' : 'rounded-2xl')}
              >
                <Calendar selected={isValidIso(value) ? value : ''} cursor={cursor} setCursor={setCursor} min={min} max={max} onPick={pick} onClear={() => { setText(''); onChange(''); onInvalidChange?.(false); close() }} onClose={() => close()} popRef={popRef} />
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  )
}

/**
 * Data e hora (24h). O valor tem o formato 'YYYY-MM-DDTHH:mm' (ou '' quando incompleto, inválido ou fora do intervalo).
 * `max` e `min` usam o mesmo formato.
 */
export function DateTimeField({ value, onChange, min, max, disabled }: { value: string; onChange: (v: string) => void; min?: string; max?: string; disabled?: boolean }) {
  const [parts, setParts] = useState(() => splitDateTime(value))
  const [seen, setSeen] = useState(value)
  const [touched, setTouched] = useState(false)
  const errId = useId()
  if (seen !== value) {
    setSeen(value)
    if (joinDateTime(parts.date, parts.time) !== value) setParts(splitDateTime(value))
  }
  const combined = joinDateTime(parts.date, parts.time)
  const outOfRange = !!combined && ((max !== undefined && combined > max) || (min !== undefined && combined < min))
  const timeBad = touched && !!parts.time && !isValidTime(parts.time)

  const update = (date: string, time: string) => {
    setParts({ date, time })
    const v = joinDateTime(date, time)
    const ok = !!v && !((max !== undefined && v > max) || (min !== undefined && v < min))
    setSeen(ok ? v : '')
    onChange(ok ? v : '')
  }

  return (
    <div>
      <div className="flex gap-2">
        <DateField wrapperClassName="min-w-0 flex-1" value={parts.date} onChange={(d) => update(d, parts.time)} min={min?.slice(0, 10)} max={max?.slice(0, 10)} disabled={disabled} aria-label={t('Data', 'Date')} />
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          aria-label={t('Hora (24h)', 'Time (24h)')}
          aria-invalid={timeBad || outOfRange ? true : undefined}
          aria-describedby={timeBad || outOfRange ? errId : undefined}
          placeholder="HH:MM"
          className={clsx(inputCls, 'num w-24 shrink-0 text-center', (timeBad || outOfRange) && 'border-bad/60')}
          value={parts.time}
          onChange={(e) => update(parts.date, maskTime(e.target.value))}
          onBlur={() => setTouched(true)}
        />
      </div>
      {timeBad || outOfRange ? (
        <p id={errId} role="alert" className="mt-1 text-xs text-bad">
          {timeBad ? t('Hora inválida (use 00:00 a 23:59).', 'Invalid time (use 00:00 to 23:59).') : t('Data e hora fora do intervalo permitido.', 'Date and time outside the allowed range.')}
        </p>
      ) : null}
    </div>
  )
}
