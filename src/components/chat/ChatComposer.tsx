import { useEffect, useLayoutEffect, useRef } from 'react'
import { Info, Send } from 'lucide-react'
import { t } from '@/lib/i18n'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: (text: string) => void
  /** Incrementar para devolver o foco ao campo (ex.: após escolher uma sugestão). */
  focusTick?: number
  disabled?: boolean
}

/** Campo de composição fixo no rodapé do workspace (controlado pelo pai). Enter envia, Shift+Enter quebra linha. */
export function ChatComposer({ value, onChange, onSend, focusTick = 0, disabled = false }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Cresce com o conteúdo até o limite (max-h do CSS) e volta ao tamanho mínimo quando esvazia.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  useEffect(() => {
    if (focusTick > 0) ref.current?.focus()
  }, [focusTick])

  const canSend = !disabled && value.trim().length > 0

  const submit = () => {
    if (!canSend) return
    onSend(value.trim())
  }

  return (
    <div className="shrink-0 border-t border-line bg-panel px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
      <form
        className="mx-auto flex w-full max-w-5xl items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          ref={ref}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          aria-label={t('Escreva sua mensagem', 'Type your message')}
          placeholder={t('Pergunte sobre o seu negócio…', 'Ask about your business…')}
          className="max-h-40 min-h-12 min-w-0 flex-1 resize-none rounded-xl border border-line bg-fill/5 px-4 py-3 text-base text-ink outline-none placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-60 sm:text-sm"
        />
        <button
          type="submit"
          aria-label={t('Enviar', 'Send')}
          disabled={!canSend}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </form>
      <p className="mx-auto mt-2 flex w-full max-w-5xl items-start gap-1.5 text-[11px] text-subtle">
        <Info size={12} className="mt-px shrink-0" />
        <span>{t('O assistente de IA ainda não está conectado nesta fase — nenhuma resposta automática será gerada.', 'The AI assistant is not connected yet in this phase — no automated response will be generated.')}</span>
      </p>
    </div>
  )
}
