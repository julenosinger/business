import { Sparkles } from 'lucide-react'
import { getLang, t } from '@/lib/i18n'

interface Props {
  onSuggestion: (text: string) => void
}

const SUGGESTIONS_PT = [
  'Analise minhas finanças.',
  'Mostre os próximos pagamentos.',
  'Revise o desempenho de vendas.',
  'Verifique o estoque.',
  'Explique meu fluxo de caixa.',
]

const SUGGESTIONS_EN = [
  'Analyze my finances.',
  'Show upcoming payments.',
  'Review sales performance.',
  'Check inventory.',
  'Explain my cash flow.',
]

/** Estado inicial: boas-vindas e sugestões de perguntas empresariais (sem respostas fictícias). */
export function ChatEmptyState({ onSuggestion }: Props) {
  const suggestions = getLang() === 'pt' ? SUGGESTIONS_PT : SUGGESTIONS_EN
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-4 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-violet/15 text-violet">
        <Sparkles size={26} />
      </div>
      <div className="max-w-md">
        <h2 className="display text-lg font-semibold">{t('Assistente de IA', 'AI assistant')}</h2>
        <p className="mt-1.5 text-sm text-muted text-pretty">
          {t(
            'Pergunte sobre o seu negócio. Nesta fase, a interface está pronta, mas o assistente ainda não está conectado.',
            'Ask about your business. In this phase, the interface is ready but the assistant is not connected yet.',
          )}
        </p>
      </div>
      <div className="flex max-w-xl flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggestion(s)}
            className="min-h-9 rounded-full border border-line bg-fill/5 px-3.5 text-xs font-semibold text-muted transition hover:border-violet/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
