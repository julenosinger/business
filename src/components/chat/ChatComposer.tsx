import { Send } from 'lucide-react'
import { Button, inputCls } from '@/components/ui'
import { t } from '@/lib/i18n'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: (text: string) => void
}

/** Campo de composição fixado na parte inferior da área de chat (controlado pelo pai). */
export function ChatComposer({ value, onChange, onSend }: Props) {
  const submit = () => {
    const text = value.trim()
    if (!text) return
    onSend(text)
  }

  return (
    <div className="border-t border-line bg-panel p-3 sm:p-4">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          aria-label={t('Escreva sua mensagem', 'Type your message')}
          placeholder={t('Pergunte sobre o seu negócio…', 'Ask about your business…')}
          className={`${inputCls} max-h-40 min-h-11 flex-1 resize-none py-2.5`}
        />
        <Button type="submit" aria-label={t('Enviar', 'Send')} disabled={!value.trim()} className="shrink-0">
          <Send size={16} />
        </Button>
      </form>
      <p className="mt-2 text-[11px] text-subtle">
        {t('O assistente de IA ainda não está conectado nesta fase — nenhuma resposta automática será gerada.', 'The AI assistant is not connected yet in this phase — no automated response will be generated.')}
      </p>
    </div>
  )
}
