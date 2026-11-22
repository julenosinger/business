import { useMemo, useState } from 'react'
import { BookText, CheckCircle2, ExternalLink, FileSearch, PackageCheck, ShieldAlert, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Empty } from '@/components/ui'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { useStore } from '@/lib/store'
import { useNav } from '@/lib/nav'
import { planPurchaseReconciliation, type PurchaseAcctStatus, type PurchaseReconItem } from '@/lib/accounting/purchase-reconcile'
import { fmtDate, money } from '@/lib/format'
import { t } from '@/lib/i18n'

const STATUS_META: Record<PurchaseAcctStatus, { label: () => string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  posted: { label: () => t('Lançado', 'Posted'), tone: 'ok' },
  awaiting_receipt: { label: () => t('Aguardando recebimento', 'Awaiting receipt'), tone: 'warn' },
  ready: { label: () => t('Pronto para lançar', 'Ready to post'), tone: 'neutral' },
  requires_review: { label: () => t('Requer revisão', 'Requires review'), tone: 'bad' },
}

function reasonText(item: PurchaseReconItem): string {
  switch (item.reason) {
    case 'no_evidence':
      return t('Sem evidência de pagamento (nem conta a pagar nem saída no Livro-Caixa).', 'No payment evidence (neither a payable nor a Cash Book outflow).')
    case 'event_rejected':
      return t('Lançamento anterior rejeitado: revise antes de lançar de novo.', 'Previous posting was rejected: review before re-posting.')
    case 'event_pending':
      return t('Lançamento anterior ainda pendente.', 'Previous posting is still pending.')
    case 'insufficient_data':
      return t('Dados insuficientes para lançar.', 'Insufficient data to post.')
    case 'invalid_amount':
      return t('Valor inválido.', 'Invalid amount.')
    default:
      return t('Requer revisão manual.', 'Requires manual review.')
  }
}

export function PurchaseReconciliationPanel() {
  const { data, reconcilePurchases } = useStore()
  const { focusLedger } = useNav()
  const [expanded, setExpanded] = useState(true)

  const plan = useMemo(() => planPurchaseReconciliation(data), [data])
  const ready = plan.filter((i) => i.status === 'ready')
  const review = plan.filter((i) => i.status === 'requires_review')
  const posted = plan.filter((i) => i.status === 'posted')

  const apply = () => {
    if (ready.length === 0) return
    const r = reconcilePurchases(ready.map((i) => i.purchaseId))
    if (!r.ok) {
      toast.error(t('Falha ao conciliar compras.', 'Failed to reconcile purchases.'))
      return
    }
    toast.success(
      t(`Compras conciliadas: ${r.value.posted} lançada(s), ${r.value.duplicates} já existia(m), ${r.value.rejected} recusada(s).`, `Purchases reconciled: ${r.value.posted} posted, ${r.value.duplicates} already existed, ${r.value.rejected} rejected.`),
    )
  }

  if (plan.length === 0) return null

  return (
    <TCard className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:px-5">
        <PanelTitle
          icon={<FileSearch size={18} />}
          title={t('Contabilidade das compras', 'Purchase accounting')}
          subtitle={t('Situação de cada compra no razão. Compras criadas antes de ligar o lançamento automático aparecem aqui para reconciliação.', 'Each purchase\'s status in the ledger. Purchases created before automatic posting was enabled appear here for reconciliation.')}
        />
        <Button variant="ghost" small onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('Recolher', 'Collapse') : t('Expandir', 'Expand')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3 sm:px-5">
        <Badge tone="ok">{posted.length} {t('lançadas', 'posted')}</Badge>
        {ready.length > 0 ? <Badge tone="neutral">{ready.length} {t('prontas para lançar', 'ready to post')}</Badge> : null}
        {review.length > 0 ? <Badge tone="bad">{review.length} {t('requerem revisão', 'require review')}</Badge> : null}
        {ready.length > 0 ? (
          <Button small onClick={apply}>
            <PackageCheck size={15} /> {t('Lançar', 'Post')} {ready.length}
          </Button>
        ) : null}
      </div>

      {!expanded ? null : plan.length === 0 ? (
        <Empty icon={<Truck size={22} />} title={t('Nenhuma compra', 'No purchases')} />
      ) : (
        <ul className="divide-y divide-line">
          {plan.map((i) => {
            const meta = STATUS_META[i.status]
            return (
              <li key={i.purchaseId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label()}</Badge>
                    <span className="num text-xs text-subtle">{i.purchaseId}</span>
                  </div>
                  <div className="mt-0.5 truncate text-sm font-medium">{i.supplier}</div>
                  <p className="num text-xs text-muted">{fmtDate(i.date)} · {money(i.total)}</p>
                  {i.status === 'ready' ? (
                    <p className="mt-1 text-xs text-subtle">
                      {t('Proposto:', 'Proposed:')} <span className="text-ok">{t('D Estoque', 'Dr Inventory')}</span> · <span className="text-bad">{i.paidNow ? t('C Caixa', 'Cr Cash') : t('C Fornecedores', 'Cr Payables')}</span>
                    </p>
                  ) : null}
                  {i.status === 'requires_review' ? <p className="mt-1 text-xs text-subtle">{reasonText(i)}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {i.entryId ? (
                    <Button variant="ghost" small onClick={() => focusLedger(`purchase:${i.purchaseId}`)}>
                      <BookText size={14} /> {t('Ver no razão', 'View in ledger')} <ExternalLink size={12} />
                    </Button>
                  ) : null}
                  {i.status === 'ready' ? <CheckCircle2 size={18} className="text-accent" /> : i.status === 'requires_review' ? <ShieldAlert size={18} className="text-bad" /> : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </TCard>
  )
}
