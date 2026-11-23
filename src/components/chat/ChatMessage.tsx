import { clsx } from 'clsx'
import { Bot, User } from 'lucide-react'
import type { ChatMessage as Msg } from '@/lib/chat'

/** Mensagem do chat. `system` é um aviso do app (ex.: indisponibilidade), não uma resposta de IA. */
export function ChatMessage({ message }: { message: Msg }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  return (
    <div className={clsx('flex w-full min-w-0 gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser ? (
        <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg', isSystem ? 'bg-warn/15 text-warn' : 'bg-violet/15 text-violet')}>
          <Bot size={16} />
        </span>
      ) : null}
      <div
        className={clsx(
          'min-w-0 max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm text-pretty [overflow-wrap:anywhere] sm:max-w-[75%]',
          isUser ? 'rounded-br-md bg-accent text-accent-ink' : isSystem ? 'rounded-bl-md border border-warn/30 bg-warn/10 text-warn' : 'rounded-bl-md border border-line bg-fill/5 text-ink',
        )}
      >
        {message.text}
      </div>
      {isUser ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <User size={16} />
        </span>
      ) : null}
    </div>
  )
}
