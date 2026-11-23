import type { ReactNode } from 'react'
import { ArrowRight, BarChart3, Bot, CalendarClock, Layers, ShoppingCart, Sparkles, TrendingUp } from 'lucide-react'
import { getLang, t } from '@/lib/i18n'

interface Props {
  /** Preenche o campo de mensagem (nunca envia). Texto vazio apenas foca o campo. */
  onSuggestion: (text: string) => void
}

interface Suggestion {
  icon: ReactNode
  pt: string
  en: string
  /** Texto inserido no campo; vazio = só focar o campo. */
  promptPt: string
  promptEn: string
}

const SUGGESTIONS: Suggestion[] = [
  { icon: <BarChart3 size={17} />, pt: 'Analisar minhas finanças', en: 'Analyze my finances', promptPt: 'Analise minhas finanças.', promptEn: 'Analyze my finances.' },
  { icon: <CalendarClock size={17} />, pt: 'Mostrar pagamentos a vencer', en: 'Show upcoming payments', promptPt: 'Mostre os pagamentos a vencer.', promptEn: 'Show upcoming payments.' },
  { icon: <ShoppingCart size={17} />, pt: 'Revisar o desempenho de vendas', en: 'Review sales performance', promptPt: 'Revise o desempenho de vendas.', promptEn: 'Review sales performance.' },
  { icon: <Layers size={17} />, pt: 'Verificar o estoque', en: 'Check inventory', promptPt: 'Verifique o estoque.', promptEn: 'Check inventory.' },
  { icon: <TrendingUp size={17} />, pt: 'Explicar meu fluxo de caixa', en: 'Explain my cash flow', promptPt: 'Explique meu fluxo de caixa.', promptEn: 'Explain my cash flow.' },
  { icon: <Sparkles size={17} />, pt: 'Outros assuntos da empresa', en: 'Other business topics', promptPt: '', promptEn: '' },
]

/** Estado inicial centralizado: boas-vindas e atalhos que só preenchem o campo (sem respostas fictícias). */
export function ChatEmptyState({ onSuggestion }: Props) {
  const pt = getLang() === 'pt'
  return (
    <div className="flex min-h-full flex-col items-center px-4 py-8 text-center sm:px-6">
      <div className="my-auto flex w-full max-w-3xl flex-col items-center gap-6">
        <div className="relative flex size-24 items-center justify-center" aria-hidden="true">
          <span className="absolute inset-0 rounded-full border border-violet/15" />
          <span className="absolute inset-3 rounded-full border border-violet/25 bg-violet/5" />
          <span className="relative flex size-14 items-center justify-center rounded-2xl bg-violet/20 text-violet">
            <Bot size={28} />
          </span>
        </div>
        <div className="max-w-xl">
          <h2 className="display text-3xl font-semibold text-balance sm:text-4xl">{t('Assistente de IA', 'AI assistant')}</h2>
          <p className="mt-1.5 text-base font-medium text-muted">{t('O seu copiloto empresarial', 'Your business copilot')}</p>
          <p className="mt-3 text-sm text-subtle text-pretty">
            {t(
              'Escreva perguntas sobre finanças, vendas, estoque e tesouraria. Nesta fase a interface está pronta, mas o assistente ainda não está conectado.',
              'Write questions about finances, sales, inventory and treasury. In this phase the interface is ready, but the assistant is not connected yet.',
            )}
          </p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.en}
              type="button"
              onClick={() => onSuggestion(pt ? s.promptPt : s.promptEn)}
              className="group flex min-h-12 items-center gap-3 rounded-xl border border-line bg-fill/5 px-4 py-2.5 text-left text-sm font-medium text-ink transition hover:border-violet/40 hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
            >
              <span className="shrink-0 text-violet">{s.icon}</span>
              <span className="min-w-0 flex-1 text-pretty">{pt ? s.pt : s.en}</span>
              <ArrowRight size={15} className="shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-ink motion-reduce:transition-none" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
