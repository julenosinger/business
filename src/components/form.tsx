import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui'
import { networkInfo, useNetwork } from '@/lib/network'
import { t } from '@/lib/i18n'

/** Seção de um formulário empresarial: título discreto (opcionalmente com ícone) e conteúdo. */
export function FormSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        {icon ? <span className="text-sky">{icon}</span> : null}
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Texto de apoio curto (explicações, sem substituir o label). */
export function FormHelpText({ children }: { children: ReactNode }) {
  return <p className="text-xs text-subtle text-pretty">{children}</p>
}

/** Mensagem de erro acessível, próxima ao campo. */
export function FormFieldError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-1 text-xs text-bad">
      {children}
    </p>
  )
}

/** Seção expansível para dados adicionais/opcionais (evita formulários longos). */
export function FormAccordion({ title, icon, defaultOpen = false, children }: { title: string; icon?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-xl border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60"
      >
        <span className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
          {icon ? <span className="text-sky">{icon}</span> : null}
          <span className="truncate">{title}</span>
        </span>
        <ChevronDown size={16} className={clsx('shrink-0 text-subtle transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <div className={clsx('grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3 border-t border-line p-3.5">{children}</div>
        </div>
      </div>
    </section>
  )
}

/** Rodapé de formulário: ações alinhadas à direita, com separação visual e estados de carregamento/desabilitado. */
export function FormFooter({
  onCancel,
  onSubmit,
  submitLabel = t('Salvar', 'Save'),
  submitDisabled,
  submitting,
  left,
}: {
  onCancel: () => void
  onSubmit?: () => void
  submitLabel?: string
  submitDisabled?: boolean
  submitting?: boolean
  /** Conteúdo à esquerda do rodapé (ex.: indicador de ambiente). */
  left?: ReactNode
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      <div className="min-w-0">{left}</div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t('Cancelar', 'Cancel')}
        </Button>
        <Button disabled={submitDisabled || submitting} onClick={onSubmit}>
          {submitting ? t('Salvando…', 'Saving…') : submitLabel}
        </Button>
      </div>
    </div>
  )
}

/** Indicador discreto do ambiente operacional ativo (somente leitura, sem troca). */
export function EnvironmentBadge() {
  const network = useNetwork()
  const info = networkInfo(network)
  const live = info.env === 'live'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-fill/5 px-2.5 py-1 text-[11px] font-semibold text-subtle">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${live ? 'bg-ok' : 'bg-warn'}`} />
      {info.label} · {live ? t('Produção', 'Production') : t('Testes', 'Testing')}
    </span>
  )
}

/** Aviso discreto de rascunho não salvo, com opções de restaurar ou descartar. */
export function DraftPrompt({
  active,
  hasDraft,
  onRestore,
  onDiscard,
}: {
  active: boolean
  hasDraft: boolean
  onRestore: () => void
  onDiscard: () => void
}) {
  // Captura se havia rascunho no MOMENTO em que o modal abriu (não reage ao auto-save seguinte).
  const [visible, setVisible] = useState(false)
  const prevActive = useRef(false)
  useEffect(() => {
    if (active && !prevActive.current) setVisible(hasDraft)
    prevActive.current = active
  }, [active, hasDraft])

  if (!active || !visible) return null

  return (
    <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm" role="status">
      <p className="text-warn text-pretty">{t('Há um rascunho não salvo deste formulário.', 'There is an unsaved draft of this form.')}</p>
      <div className="mt-2 flex gap-2">
        <Button
          small
          variant="subtle"
          onClick={() => {
            onRestore()
            setVisible(false)
          }}
        >
          {t('Restaurar', 'Restore')}
        </Button>
        <Button
          small
          variant="ghost"
          onClick={() => {
            onDiscard()
            setVisible(false)
          }}
        >
          {t('Descartar', 'Discard')}
        </Button>
      </div>
    </div>
  )
}
