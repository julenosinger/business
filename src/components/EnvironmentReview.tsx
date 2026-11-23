import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge, Button, Modal } from '@/components/ui'
import { useStore, type EntityKind } from '@/lib/store'
import { money } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { NetworkId } from '@/lib/network'

interface Row {
  kind: EntityKind
  id: string
  label: string
  detail: string
}

const KIND_LABEL: Record<EntityKind, string> = {
  product: 'Produto',
  sale: 'Venda',
  purchase: 'Compra',
  contact: 'Cadastro',
  employee: 'Funcionário',
  shipment: 'Remessa',
  carrier: 'Transportadora',
  return: 'Devolução',
  receipt: 'Recebimento',
}

/** Revisão manual de registros operacionais legados sem ambiente definido (fase 3.3). */
export function EnvironmentReview() {
  const { data, setRecordEnvironment } = useStore()
  const [open, setOpen] = useState(false)

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const push = (kind: EntityKind, id: string, label: string, detail: string) => out.push({ kind, id, label, detail })
    for (const p of data.products) if (!p.environment) push('product', p.id, p.name, `${p.category} · ${p.stock} ${p.unit}`)
    for (const s of data.sales) if (!s.environment) push('sale', s.id, `${s.customerName} · ${s.id}`, money(s.total))
    for (const p of data.purchases) if (!p.environment) push('purchase', p.id, `${p.supplierName} · ${p.id}`, money(p.total))
    for (const c of data.contacts) if (!c.environment) push('contact', c.id, c.name, c.kind === 'customer' ? t('Cliente', 'Customer') : t('Fornecedor', 'Supplier'))
    for (const e of data.employees) if (!e.environment) push('employee', e.id, e.name, e.role)
    for (const s of data.shipments) if (!s.environment) push('shipment', s.id, `${s.id} · ${s.recipientName}`, s.status)
    for (const c of data.carriers) if (!c.environment) push('carrier', c.id, c.name, c.id)
    for (const r of data.returns) if (!r.environment) push('return', r.id, r.id, r.status)
    for (const r of data.receipts) if (!r.environment) push('receipt', r.id, r.id, r.stockMode)
    return out
  }, [data])

  if (rows.length === 0) return null

  const classify = (row: Row, env: NetworkId) => {
    if (window.confirm(t(`Definir o ambiente de "${row.label}" como ${env === 'mainnet' ? 'Mainnet' : 'Testnet'}?`, `Set the "${row.label}" environment to ${env === 'mainnet' ? 'Mainnet' : 'Testnet'}?`))) setRecordEnvironment(row.kind, row.id, env)
  }

  return (
    <>
      <div className="tcard flex flex-wrap items-center gap-3 !border-warn/40 !bg-warn/10 p-4 text-sm" role="status">
        <AlertTriangle size={18} className="text-warn" />
        <p className="min-w-0 flex-1 text-pretty">
          {t(
            `${rows.length} registro(s) legado(s) sem ambiente definido. Eles ficam fora das listas de Mainnet/Testnet até a revisão.`,
            `${rows.length} legacy record(s) without a defined environment. They stay out of the Mainnet/Testnet lists until reviewed.`,
          )}
        </p>
        <Button small variant="ghost" onClick={() => setOpen(true)}>
          {t('Revisar', 'Review')}
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('Revisar ambiente de registros legados', 'Review legacy record environments')} wide>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {t('Atribua cada registro ao ambiente correto. A ação exige confirmação e fica registrada na auditoria.', 'Assign each record to the correct environment. The action requires confirmation and is recorded in the audit trail.')}
          </p>
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {rows.map((row) => (
              <li key={`${row.kind}:${row.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-fill/5 p-3 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{KIND_LABEL[row.kind]}</Badge>
                    <span className="truncate font-semibold">{row.label}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-subtle">{row.detail}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button small variant="subtle" onClick={() => classify(row, 'mainnet')}>
                    {t('Mainnet', 'Mainnet')}
                  </Button>
                  <Button small variant="subtle" onClick={() => classify(row, 'testnet')}>
                    {t('Testnet', 'Testnet')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </>
  )
}
