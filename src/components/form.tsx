import type { ReactNode } from 'react'
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
