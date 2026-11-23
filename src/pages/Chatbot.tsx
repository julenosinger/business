import { useEffect, useRef, useState } from 'react'
import { Bot, History, Info, LogIn, LogOut, PanelLeftOpen, Square } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { ConversationSidebar } from '@/components/chat/ConversationSidebar'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { useChat } from '@/lib/chat'
import { useStore } from '@/lib/store'
import { useNetwork } from '@/lib/network'
import { businessContext } from '@/lib/intelligence'
import { fetchChatStatus, login, logout, type AiStatus } from '@/lib/ai-runtime'
import { useViewport } from '@/lib/sidebar'
import { t } from '@/lib/i18n'

/**
 * Workspace de chat em tela cheia. O Layout entrega uma área sem margens (page === 'chatbot'),
 * então tudo aqui usa flex com min-h-0/min-w-0: só a lista de mensagens rola; o composer fica sempre visível.
 */
export function Chatbot() {
  const chat = useChat()
  const { data } = useStore()
  const network = useNetwork()
  const vp = useViewport()
  // Desktop: histórico fixo ao lado (recolhível). Tablet e celular: gaveta sobreposta.
  const inline = vp === 'desktop'
  const [composer, setComposer] = useState('')
  const [focusTick, setFocusTick] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [status, setStatus] = useState<AiStatus>({ kind: 'not_configured' })
  const scrollRef = useRef<HTMLDivElement>(null)

  const active = chat.active
  const count = active?.messages.length ?? 0
  const responding = active?.messages.some((m) => m.status === 'responding') ?? false

  const refreshStatus = () => {
    void fetchChatStatus().then(setStatus)
  }

  // Estado real de conexão (transporte + backend + sessão + provedor).
  useEffect(() => {
    let mounted = true
    void fetchChatStatus().then((s) => {
      if (mounted) setStatus(s)
    })
    return () => {
      mounted = false
    }
  }, [chat.configured])

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
    // Envia a mensagem + um contexto empresarial minimizado (somente leitura) para o backend de IA.
    chat.send(text, businessContext(data, network))
    setComposer('')
  }

  const retry = () => {
    const lastUser = active ? [...active.messages].reverse().find((m) => m.role === 'user') : undefined
    if (lastUser) send(lastUser.text)
  }

  const doLogin = async () => {
    if (!secret.trim() || loginBusy) return
    setLoginBusy(true)
    const ok = await login(secret.trim())
    setLoginBusy(false)
    if (ok) {
      setSecret('')
      setLoginOpen(false)
      refreshStatus()
    }
  }

  const doLogout = async () => {
    await logout()
    refreshStatus()
  }

  const authenticated = status.kind === 'ready' || status.kind === 'no_provider'
  const statusLabel =
    status.kind === 'ready'
      ? t('Conectado', 'Connected')
      : status.kind === 'unavailable'
        ? t('Indisponível', 'Unavailable')
        : status.kind === 'no_provider'
          ? t('Sem provedor', 'No provider')
          : status.kind === 'unauthenticated'
            ? t('Não autenticado', 'Not authenticated')
            : t('Não configurado', 'Not configured')
  const statusSub =
    status.kind === 'ready'
      ? t('Conectado ao backend de IA', 'Connected to the AI backend')
      : status.kind === 'unavailable'
        ? t('Backend indisponível', 'Backend unavailable')
        : status.kind === 'no_provider'
          ? t('Provedor de IA não configurado', 'AI provider not configured')
          : status.kind === 'unauthenticated'
            ? t('Faça login para conversar', 'Sign in to chat')
            : t('Backend não configurado', 'Backend not configured')

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
            <p className="truncate text-[11px] text-subtle">{statusSub}</p>
          </div>
          <span className="hidden sm:inline-flex">
            <Badge tone={status.kind === 'ready' ? 'ok' : 'warn'}>{statusLabel}</Badge>
          </span>
          {authenticated ? (
            <button
              type="button"
              onClick={() => void doLogout()}
              aria-label={t('Sair', 'Sign out')}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <LogOut size={16} />
            </button>
          ) : status.kind === 'unauthenticated' ? (
            <button
              type="button"
              onClick={() => setLoginOpen((v) => !v)}
              aria-expanded={loginOpen}
              aria-label={t('Conectar', 'Connect')}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <LogIn size={16} />
            </button>
          ) : null}
          {responding ? (
            <button
              type="button"
              onClick={chat.cancelResponse}
              aria-label={t('Cancelar resposta', 'Cancel response')}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <Square size={14} />
            </button>
          ) : null}
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

        {loginOpen ? (
          <form
            className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5 sm:px-5"
            onSubmit={(e) => {
              e.preventDefault()
              void doLogin()
            }}
          >
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={t('Segredo de acesso', 'Access secret')}
              aria-label={t('Segredo de acesso', 'Access secret')}
              className="min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-fill/5 px-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <Button type="submit" small disabled={!secret.trim() || loginBusy}>
              {loginBusy ? t('Conectando…', 'Connecting…') : t('Conectar', 'Connect')}
            </Button>
          </form>
        ) : null}

        {infoOpen ? (
          <div className="shrink-0 border-b border-warn/25 bg-warn/10 px-4 py-2.5 text-xs text-warn sm:px-5">
            {t(
              'O assistente responde apenas com os dados reais da empresa (somente leitura) e nunca executa operações automaticamente. A conversa exige uma sessão autenticada no servidor.',
              'The assistant answers only with your real business data (read-only) and never performs operations automatically. Chat requires an authenticated server session.',
            )}
          </div>
        ) : null}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="log" aria-live="polite" aria-label={t('Mensagens', 'Messages')}>
          {active && active.messages.length > 0 ? (
            <div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-5 sm:px-5">
              {active.messages.map((m) => (
                <ChatMessage key={m.id} message={m} onRetry={m.status === 'error' ? retry : undefined} />
              ))}
            </div>
          ) : (
            <ChatEmptyState onSuggestion={suggest} />
          )}
        </div>

        <ChatComposer value={composer} onChange={setComposer} onSend={send} focusTick={focusTick} disabled={responding} />
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
