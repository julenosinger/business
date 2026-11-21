import type { ReactNode } from 'react'
import { ArrowDownToLine, ArrowLeftRight, HandCoins, Send, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { t } from '@/lib/i18n'
import { PanelTitle, TCard } from '@/components/ds/Panel'

interface Props {
  enabled: boolean
  onDeposit: () => void
  onSend: () => void
  onCrossChain: () => void
  onCharge: () => void
}

function Tile({ icon, label, sub, onClick, disabled, primary }: { icon: ReactNode; label: string; sub: string; onClick: () => void; disabled: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'group flex min-h-[104px] flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 py-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60 disabled:cursor-not-allowed disabled:opacity-50',
        primary
          ? 'border-violet/70 bg-violet/15 shadow-[0_0_0_1px_rgb(var(--violet-rgb)/0.25)] hover:bg-violet/25'
          : 'border-line bg-fill/5 hover:border-violet/40 hover:bg-fill/10',
      )}
    >
      <span className={clsx('transition group-hover:scale-105 motion-reduce:transition-none', primary ? 'text-violet' : 'text-violet/90')}>{icon}</span>
      <span className="text-[12.5px] font-semibold leading-tight text-balance">{label}</span>
      <span className="text-[10.5px] leading-tight text-subtle text-balance">{sub}</span>
    </button>
  )
}

export function QuickActions({ enabled, onDeposit, onSend, onCrossChain, onCharge }: Props) {
  return (
    <TCard className="flex h-full flex-col gap-4 p-4 sm:p-5">
      <PanelTitle icon={<Zap size={18} className="text-violet" />} title={t('Operações rápidas', 'Quick actions')} />
      <div className="grid flex-1 grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <Tile primary disabled={!enabled} onClick={onDeposit} icon={<ArrowDownToLine size={24} />} label={t('Depositar', 'Deposit')} sub={t('Adicionar USDC', 'Add USDC')} />
        <Tile disabled={!enabled} onClick={onSend} icon={<Send size={24} />} label={t('Enviar', 'Send')} sub={t('Transferir USDC', 'Transfer USDC')} />
        <Tile disabled={!enabled} onClick={onCrossChain} icon={<ArrowLeftRight size={24} />} label={t('Entre redes', 'Cross-chain')} sub={t('Mover USDC', 'Move USDC')} />
        <Tile disabled={!enabled} onClick={onCharge} icon={<HandCoins size={24} />} label={t('Cobrar em USDC', 'Charge in USDC')} sub={t('Gerar cobrança', 'Create request')} />
      </div>
      {!enabled ? <p className="text-xs text-subtle">{t('Conecte a carteira para operar.', 'Connect your wallet to operate.')}</p> : null}
    </TCard>
  )
}
