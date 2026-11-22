import { MessageSquarePlus, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { t } from '@/lib/i18n'
import type { Conversation } from '@/lib/chat'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onRemove: (id: string) => void
}

/** Painel de histórico de conversas (recolhível no desktop, drawer no mobile). */
export function ConversationSidebar({ conversations, activeId, onSelect, onNew, onRemove }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-accent-ink transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <MessageSquarePlus size={16} /> {t('Nova conversa', 'New chat')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-subtle">{t('Nenhuma conversa ainda.', 'No conversations yet.')}</p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <div
                  className={clsx(
                    'group flex items-center gap-2 rounded-xl px-3 py-2 transition',
                    c.id === activeId ? 'bg-accent/15 text-ink' : 'text-muted hover:bg-fill/10 hover:text-ink',
                  )}
                >
                  <button type="button" onClick={() => onSelect(c.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium">{c.title}</span>
                    <span className="block truncate text-[11px] text-subtle">
                      {c.messages.length} {c.messages.length === 1 ? t('mensagem', 'message') : t('mensagens', 'messages')}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('Excluir conversa', 'Delete conversation')}
                    onClick={() => onRemove(c.id)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle opacity-0 transition hover:bg-bad/10 hover:text-bad focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
