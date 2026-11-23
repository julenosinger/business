import { useEffect, useRef, useState } from 'react'
import { Bot, History, Info, PanelLeftOpen } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui'
import { ConversationSidebar } from '@/components/chat/ConversationSidebar'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { useChat } from '@/lib/chat'
import { useViewport } from '@/lib/sidebar'
import { t } from '@/lib/i18n'

/**
 * Workspace de chat em tela cheia. O Layout entrega uma área sem margens (page === 'chatbot'),
 * então tudo aqui usa flex com min-h-0/min-w-0: só a lista de mensagens rola; o composer fica sempre visível.
 */
export function Chatbot() {
  const chat = useChat()
  const vp = useViewport()
  // Desktop: histórico fixo ao lado (recolhível). Tablet e celular: gaveta sobreposta.
  const inline = vp === 'desktop'
  const [composer, setComposer] = useState('')
  const [focusTick, setFocusTick] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const active = chat.active
  const count = active?.messages.length ?? 0

  // Mantém a última mensagem à vista ao enviar ou trocar de conversa.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count, chat.activeId])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const send = (text: string) => {
    chat.send(text)
    setComposer('')
    toast.info(t('O assistente de IA ainda não está conectado — nenhuma resposta foi gerada.', 'The AI assistant is not connected yet — no response was generated.'))
  }

  const suggest = (text: string) => {
    if (text) setComposer(text)
    setFocusTick((n) => n + 1)
  }

  const historyLabel = t('Histórico de conversas', 'Conversation history')
  const showHistoryButton = !inline || collapsed

  const panel = (onCollapse: () => void, afterPick?: () => void) => (
    <ConversationSidebar
      conversations={chat.conversations}
      activeId={chat.activeId}
      onSelect={(id) => {
        chat.select(id)
        afterPick?.()
      }}
      onNew={() => {
        chat.newConversation()
        setComposer('')
        setFocusTick((n) => n + 1)
        afterPick?.()
      }}
      onRemove={chat.removeConversation}
      onCollapse={onCollapse}
    />
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-bg/40">
      {inline && !collapsed ? <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel/60 xl:w-80">{panel(() => setCollapsed(true))}</aside> : null}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5 sm:gap-3 sm:px-5">
          {showHistoryButton ? (
            <button
              type="button"
              onClick={() => (inline ? setCollapsed(false) : setDrawerOpen(true))}
              aria-label={inline ? t('Expandir histórico', 'Expand history') : historyLabel}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {inline ? <PanelLeftOpen size={17} /> : <History size={17} />}
            </button>
          ) : null}
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet/15 text-violet">
            <Bot size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="display truncate text-sm font-semibold sm:text-base">{t('Assistente geral', 'General assistant')}</h1>
            <p className="truncate text-[11px] text-subtle">{t('Não conectado nesta fase', 'Not connected in this phase')}</p>
          </div>
          <span className="hidden sm:inline-flex">
            <Badge tone="warn">{t('Não conectado', 'Not connected')}</Badge>
          </span>
          <button
            type="button"
            onClick={() => setInfoOpen((v) => !v)}
            aria-expanded={infoOpen}
            aria-label={t('Sobre o assistente', 'About the assistant')}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Info size={16} />
          </button>
        </div>

        {infoOpen ? (
          <div className="shrink-0 border-b border-warn/25 bg-warn/10 px-4 py-2.5 text-xs text-warn sm:px-5">
            <span className="sm:hidden">
              <strong>{t('Não conectado. ', 'Not connected. ')}</strong>
            </span>
            {t(
              'Esta fase entrega apenas a interface. Suas mensagens ficam salvas neste navegador e nenhuma resposta automática é gerada.',
              'This phase only delivers the interface. Your messages are saved in this browser and no automated response is generated.',
            )}
          </div>
        ) : null}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="log" aria-live="polite" aria-label={t('Mensagens', 'Messages')}>
          {active && active.messages.length > 0 ? (
            <div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-5 sm:px-5">
              {active.messages.map((m) => (
                <ChatMessage key={m.id} message={m} />
              ))}
            </div>
          ) : (
            <ChatEmptyState onSuggestion={suggest} />
          )}
        </div>

        <ChatComposer value={composer} onChange={setComposer} onSend={send} focusTick={focusTick} />
      </section>

      {/* Gaveta de histórico (tablet e celular). */}
      {!inline && drawerOpen ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={historyLabel}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,calc(100vw-3rem))] flex-col border-r border-line bg-panel pb-[env(safe-area-inset-bottom)]">
            {panel(() => setDrawerOpen(false), () => setDrawerOpen(false))}
          </aside>
        </div>
      ) : null}
    </div>
  )
}
