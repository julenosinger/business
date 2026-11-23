import { useState } from 'react'
import { Bot, MessageSquare, MessageSquarePlus, PanelLeftClose, Search, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'
import { addDays, fmtDate, today } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { Conversation } from '@/lib/chat'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onRemove: (id: string) => void
  /** Recolhe (desktop) ou fecha (gaveta) o painel. */
  onCollapse: () => void
}

/** Rótulo de data relativo ao dia atual, no idioma ativo. */
function dayLabel(date: string): string {
  const now = today()
  if (date === now) return t('Hoje', 'Today')
  if (date === addDays(now, -1)) return t('Ontem', 'Yesterday')
  return fmtDate(date)
}

/** Painel de histórico de conversas: cabeçalho, nova conversa, busca e lista rolável. */
export function ConversationSidebar({ conversations, activeId, onSelect, onNew, onRemove, onCollapse }: Props) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const visible = q
    ? conversations.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.text.toLowerCase().includes(q)))
    : conversations

  const closeSearch = () => {
    setSearching(false)
    setQuery('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet/15 text-violet">
          <Bot size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="display truncate text-sm font-semibold">{t('Assistente de IA', 'AI assistant')}</div>
          <div className="truncate text-[11px] text-subtle">{t('Converse com o seu negócio', 'Talk to your business')}</div>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label={t('Recolher histórico', 'Collapse history')}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <PanelLeftClose size={17} />
        </button>
      </div>

      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={onNew}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-accent-ink transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <MessageSquarePlus size={16} /> {t('Nova conversa', 'New chat')}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 pb-2">
        {searching ? (
          <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-fill/5 px-3 focus-within:border-accent">
            <Search size={15} className="shrink-0 text-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeSearch()
              }}
              aria-label={t('Buscar conversas', 'Search conversations')}
              placeholder={t('Buscar conversas…', 'Search conversations…')}
              className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-subtle sm:text-sm"
            />
            <button type="button" onClick={closeSearch} aria-label={t('Fechar busca', 'Close search')} className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle hover:text-ink">
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <span className="label">{t('Conversas', 'Conversations')}</span>
            <button
              type="button"
              onClick={() => setSearching(true)}
              aria-label={t('Buscar conversas', 'Search conversations')}
              className="flex size-10 items-center justify-center rounded-xl text-muted transition hover:bg-fill/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <Search size={16} />
            </button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-fill/10 text-subtle">
              <MessageSquare size={18} />
            </span>
            <p className="text-sm font-semibold text-ink">{t('Nenhuma conversa ainda', 'No conversations yet')}</p>
            <p className="text-xs text-subtle text-pretty">{t('Escreva uma pergunta para iniciar a primeira conversa.', 'Write a question to start your first conversation.')}</p>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-subtle">{t('Nenhuma conversa encontrada.', 'No conversations found.')}</p>
        ) : (
          <ul className="space-y-1">
            {visible.map((c) => {
              const active = c.id === activeId
              const last = c.messages[c.messages.length - 1]
              return (
                <li key={c.id}>
                  <div
                    className={clsx(
                      'group flex items-center gap-1 rounded-xl border pr-1 transition',
                      active ? 'border-accent/30 bg-accent/15 text-ink' : 'border-transparent text-muted hover:bg-fill/10 hover:text-ink',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      aria-current={active ? 'true' : undefined}
                      className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg', active ? 'bg-accent/20 text-accent' : 'bg-fill/10 text-subtle')}>
                        <MessageSquare size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.title}</span>
                        <span className="block truncate text-[11px] text-subtle">
                          {dayLabel(last?.at ?? c.createdAt)} · {c.messages.length} {c.messages.length === 1 ? t('mensagem', 'message') : t('mensagens', 'messages')}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={t('Excluir conversa', 'Delete conversation')}
                      onClick={() => onRemove(c.id)}
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle transition hover:bg-bad/10 hover:text-bad focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/50 lg:opacity-0 lg:group-hover:opacity-100"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
