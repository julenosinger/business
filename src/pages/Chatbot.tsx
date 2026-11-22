import { useState } from 'react'
import { Bot, History, PanelLeftClose, X } from 'lucide-react'
import { toast } from 'sonner'
import { PageTop } from '@/components/ds/PageTop'
import { Badge } from '@/components/ui'
import { ConversationSidebar } from '@/components/chat/ConversationSidebar'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { useChat } from '@/lib/chat'
import { useViewport } from '@/lib/sidebar'
import { t } from '@/lib/i18n'

export function Chatbot() {
  const chat = useChat()
  const vp = useViewport()
  const isMobile = vp === 'mobile'
  const [composer, setComposer] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const active = chat.active

  const send = (text: string) => {
    chat.send(text)
    setComposer('')
    toast.info(t('O assistente de IA ainda não está conectado — nenhuma resposta foi gerada.', 'The AI assistant is not connected yet — no response was generated.'))
  }

  const toggleHistory = () => (isMobile ? setHistoryOpen((v) => !v) : setCollapsed((v) => !v))

  const sidebar = (
    <ConversationSidebar
      conversations={chat.conversations}
      activeId={chat.activeId}
      onSelect={(id) => {
        chat.select(id)
        if (isMobile) setHistoryOpen(false)
      }}
      onNew={() => {
        chat.newConversation()
        if (isMobile) setHistoryOpen(false)
      }}
      onRemove={chat.removeConversation}
    />
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageTop
        title={t('Assistente de IA', 'AI assistant')}
        subtitle={t('Converse com o seu negócio. Interface pronta para integração futura.', 'Talk to your business. Interface ready for future integration.')}
        badge={<Badge tone="warn">{t('Não conectado', 'Not connected')}</Badge>}
        actions={
          <button
            type="button"
            onClick={toggleHistory}
            aria-label={t('Histórico de conversas', 'Conversation history')}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-strong"
          >
            <History size={16} /> {t('Histórico', 'History')}
          </button>
        }
      />

      <div className="tcard flex h-[calc(100dvh-15rem)] min-h-[480px] overflow-hidden">
        {!isMobile && !collapsed ? <aside className="hidden w-64 shrink-0 flex-col border-r border-line lg:flex">{sidebar}</aside> : null}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Indicador do agente selecionado + botão de recolher o histórico (desktop). */}
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            {!isMobile && collapsed ? (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                aria-label={t('Expandir histórico', 'Expand history')}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-fill/10 hover:text-ink"
              >
                <PanelLeftClose size={17} />
              </button>
            ) : null}
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet">
              <Bot size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{t('Assistente geral', 'General assistant')}</div>
              <div className="truncate text-[11px] text-subtle">{t('Nenhum agente conectado', 'No agent connected')}</div>
            </div>
            <Badge tone="neutral">{t('Preview', 'Preview')}</Badge>
          </div>

          <div className="flex-1 overflow-y-auto">
            {active && active.messages.length > 0 ? (
              <div className="space-y-4 p-4">
                {active.messages.map((m) => (
                  <ChatMessage key={m.id} message={m} />
                ))}
              </div>
            ) : (
              <ChatEmptyState onSuggestion={(text) => setComposer(text)} />
            )}
          </div>

          <ChatComposer value={composer} onChange={setComposer} onSend={send} />
        </div>
      </div>

      {/* Drawer de histórico no mobile. */}
      {isMobile && historyOpen ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('Histórico de conversas', 'Conversation history')}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setHistoryOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,calc(100vw-3rem))] flex-col border-r border-line bg-panel pt-4">
            <div className="flex items-center justify-between px-4 pb-2">
              <span className="display text-sm font-semibold">{t('Conversas', 'Conversations')}</span>
              <button
                type="button"
                aria-label={t('Fechar', 'Close')}
                onClick={() => setHistoryOpen(false)}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-fill/10 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      ) : null}
    </div>
  )
}
