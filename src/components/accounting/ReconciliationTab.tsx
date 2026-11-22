import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Eye, FileSearch, Plus, Scale, Search, ShieldAlert, Zap } from 'lucide-react'
import clsx from 'clsx'
import { toast } from 'sonner'
import { Badge, Button, Empty, Field, Modal, inputCls } from '@/components/ui'
import { DateField } from '@/components/DateField'
import { KpiTile } from '@/components/ds/KpiTile'
import { PanelTitle, TCard } from '@/components/ds/Panel'
import { EntryDrawer } from './EntryDrawer'
import { explainLedger, reasonText } from './messages'
import { useStore } from '@/lib/store'
import { buildReconciliation, summarize, type ReconGroup, type ReconItem, type ReconState } from '@/lib/accounting/reconcile-center'
import { trialBalance } from '@/lib/accounting/engine'
import { formatDecimal, parseMinor } from '@/lib/accounting/money'
import type { LedgerFlags, FeeKind, FeePaidFrom } from '@/lib/accounting/types'
import { useGatewayBalances } from '@/lib/gateway'
import { formatCurrency, fmtDate, iso, today } from '@/lib/format'
import { t, getLang } from '@/lib/i18n'

type AdapterKey = keyof LedgerFlags['adapters']

const ADAPTERS: { key: AdapterKey; title: () => string; text: () => string }[] = [
  { key: 'cashBook', title: () => t('Livro-Caixa (manuais)', 'Cash Book (manual)'), text: () => t('Novos lançamentos manuais, com estorno ao editar ou remover.', 'New manual entries, reversed when edited or removed.') },
  { key: 'sales', title: () => t('Vendas e PDV', 'Sales and POS'), text: () => t('Receita e custo das mercadorias; cancelamento estorna. Venda a prazo: ligue também Contas a pagar e receber.', 'Revenue and cost of goods; cancellation reverses. For credit sales also turn on Payables and receivables.') },
  { key: 'payables', title: () => t('Contas a pagar e receber (inclui frete)', 'Payables and receivables (incl. freight)'), text: () => t('Criação, edição e remoção da obrigação e a baixa. Pagamento via USDC fica pendente até você confirmar.', 'Obligation creation, edit, removal and settlement. USDC payments stay pending until you confirm.') },
  { key: 'purchases', title: () => t('Compras', 'Purchases'), text: () => t('Estoque e fornecedor; só lança quando o estoque efetivamente entra.', 'Inventory and supplier; posts only when stock actually enters.') },
  { key: 'payroll', title: () => t('Folha de pagamento', 'Payroll'), text: () => t('Apropriação do salário e pagamento.', 'Salary accrual and payment.') },
  { key: 'treasury', title: () => t('Tesouraria (depósitos)', 'Treasury (deposits)'), text: () => t('Depósitos no Gateway nascem pendentes até a sua confirmação com evidência.', 'Gateway deposits start pending until you confirm them with evidence.') },
]

const STATE_TONE: Record<ReconState, 'ok' | 'warn' | 'bad' | 'neutral'> = { matched: 'ok', pending: 'warn', mismatch: 'bad', review: 'neutral' }
const stateLabel = (s: ReconState): string => ({ matched: t('Conferido', 'Matched'), pending: t('Pendente', 'Pending'), mismatch: t('Divergência', 'Mismatch'), review: t('Requer revisão', 'Requires review') })[s]
const groupLabel = (g: ReconGroup): string =>
  ({ cashbook: t('Livro-Caixa', 'Cash Book'), sales: t('Vendas', 'Sales'), purchases: t('Compras', 'Purchases'), obligations: t('Contas', 'Accounts'), treasury: t('Tesouraria', 'Treasury'), fees: t('Taxas', 'Fees'), integrity: t('Integridade', 'Integrity') })[g]

function AutoPostingPanel() {
  const { data, setLedgerAdapter } = useStore()
  const flags = data.ledger.flags.adapters
  return (
    <TCard className="p-4 sm:p-5">
      <PanelTitle icon={<Zap size={18} />} title={t('Lançamento automático', 'Automatic posting')} subtitle={t('Cada integração só trata registros criados DEPOIS de ligada. Nada histórico é alterado.', 'Each integration only handles records created AFTER it is turned on. Nothing historical is changed.')} />
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {ADAPTERS.map((a) => (
          <li key={a.key} className="flex items-start justify-between gap-3 rounded-xl border border-line p-3">
            <div className="min-w-0 text-sm">
              <div className="font-semibold">{a.title()}</div>
              <p className="text-xs text-subtle text-pretty">{a.text()}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={flags[a.key]}
              aria-label={a.title()}
              onClick={() => setLedgerAdapter(a.key, !flags[a.key])}
              className={clsx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full border border-line transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none', flags[a.key] ? 'bg-ok/60' : 'bg-fill/15')}
            >
              <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] duration-150 motion-reduce:transition-none', flags[a.key] ? 'left-[22px]' : 'left-0.5')} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-subtle text-pretty">
        {t('Modo transitório: os dados ficam no navegador (localStorage), sem consistência multiusuário de produção. Lançamentos postados são imutáveis; correções usam estorno vinculado.', 'Transitional mode: data lives in the browser (localStorage), without production-grade multi-user consistency. Posted entries are immutable; corrections use linked reversals.')}
      </p>
    </TCard>
  )
}

/** Três visões do mesmo dinheiro em USDC: nunca são somadas. */
function BalanceViews() {
  const { data } = useStore()
  const { address } = useAccount()
  const gw = useGatewayBalances(address)
  const tb = trialBalance(data.ledger, { currency: 'USDC' })[0]
  const bal = (code: string): string => {
    const v = tb?.rows.find((r) => r.code === code)?.balance ?? 0n
    return formatCurrency(Number(formatDecimal(v, 'USDC')), 'USDC')
  }
  const onchain = !address ? t('Conecte a carteira', 'Connect wallet') : gw.isLoading ? t('Consultando…', 'Loading…') : gw.isError ? t('Indisponível', 'Unavailable') : formatCurrency(gw.data?.total ?? 0, 'USDC')
  const cards: [string, string, string][] = [
    [t('Saldo unificado no Gateway', 'Gateway unified balance'), onchain, t('Lido do Circle Gateway (confirmado)', 'Read from Circle Gateway (confirmed)')],
    [t('Contábil: Gateway (1020)', 'Accounting: Gateway (1020)'), bal('1020'), t('Só inclui operações já confirmadas por você', 'Only operations you confirmed')],
    [t('Contábil: carteiras (1010)', 'Accounting: wallets (1010)'), bal('1010'), t('Saldo on-chain da carteira não é lido aqui', 'On-chain wallet balance is not read here')],
  ]
  return (
    <TCard className="p-4 sm:p-5">
      <PanelTitle icon={<Scale size={18} />} title={t('Saldos de USDC: três visões do mesmo dinheiro', 'USDC balances: three views of the same funds')} subtitle={t('Não somar: são visões distintas dos mesmos fundos.', 'Do not add them up: they are different views of the same funds.')} />
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        {cards.map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border border-line p-3">
            <dt className="text-xs text-subtle">{label}</dt>
            <dd className="num mt-0.5 text-lg font-semibold">{value}</dd>
            <p className="text-xs text-subtle">{hint}</p>
          </div>
        ))}
      </dl>
    </TCard>
  )
}

function ReviewModal({ item, onClose, onOpenEntry }: { item: ReconItem | null; onClose: () => void; onOpenEntry: (id: string) => void }) {
  const { reviewLedgerItem } = useStore()
  const [loaded, setLoaded] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [hash, setHash] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  if (loaded !== (item?.key ?? null)) {
    setLoaded(item?.key ?? null)
    setNote('')
    setHash(item?.refs.txHash ?? '')
    setUrl(item?.refs.explorerUrl ?? '')
    setError('')
  }
  const pending = item?.state === 'pending' && item.refs.eventKey !== undefined
  const send = (decision: 'confirmed' | 'failed' | 'dismissed') => {
    if (!item) return
    const r = reviewLedgerItem({ itemKey: item.key, decision, note, ...(hash || url ? { evidence: { ...(hash ? { txHash: hash.trim() } : {}), ...(url ? { explorerUrl: url.trim() } : {}) } } : {}) })
    if (!r.ok) {
      setError(explainLedger(r.errors))
      return
    }
    toast.success(decision === 'confirmed' ? t('Liquidação confirmada e lançada.', 'Settlement confirmed and posted.') : decision === 'failed' ? t('Operação marcada como falha (nada foi lançado).', 'Operation marked as failed (nothing posted).') : t('Item revisado.', 'Item reviewed.'))
    onClose()
  }
  return (
    <Modal open={item !== null} onClose={onClose} title={pending ? t('Confirmar liquidação', 'Confirm settlement') : t('Revisar item', 'Review item')}>
      {item ? (
        <>
          <p className="text-sm text-muted text-pretty">{reasonText(item.reason)}</p>
          <p className="mt-1 text-sm"><span className="font-medium">{item.label}</span> {item.amount !== undefined ? <span className="num text-muted">· {formatCurrency(item.amount, item.currency ?? 'USDC')}</span> : null}</p>
          {pending ? (
            <p className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-pretty">
              {t('O app não verifica a rede por você. Confirme apenas depois de conferir a transação no explorer. A confirmação lança a liquidação e fica registrada com o seu nome e a evidência.', 'The app does not verify the network for you. Confirm only after checking the transaction on the explorer. Confirming posts the settlement and records your name and the evidence.')}
            </p>
          ) : null}
          <div className="mt-3 grid gap-3">
            <Field label={t('Hash da transação (evidência)', 'Transaction hash (evidence)')}>
              <input className={inputCls} value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x…" />
            </Field>
            <Field label={t('Link do explorer (https)', 'Explorer link (https)')}>
              <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>
            <Field label={t('Nota da revisão', 'Review note')}>
              <textarea className={clsx(inputCls, 'min-h-20 py-2')} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {error ? <p role="alert" className="mt-3 text-sm text-bad">{error}</p> : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {item.refs.journalId ? <Button variant="ghost" onClick={() => onOpenEntry(item.refs.journalId as string)}><Eye size={16} /> {t('Ver lançamento', 'View entry')}</Button> : null}
            <Button variant="ghost" onClick={onClose}>{t('Cancelar', 'Cancel')}</Button>
            {pending ? (
              <>
                <Button variant="danger" onClick={() => send('failed')}>{t('Marcar como falha', 'Mark as failed')}</Button>
                <Button onClick={() => send('confirmed')}>{t('Confirmar liquidação', 'Confirm settlement')}</Button>
              </>
            ) : (
              <Button onClick={() => send('dismissed')}>{t('Dispensar com nota', 'Dismiss with note')}</Button>
            )}
          </div>
        </>
      ) : null}
    </Modal>
  )
}

function FeeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { registerLedgerFee } = useStore()
  const [kind, setKind] = useState<FeeKind>('gateway')
  const [status, setStatus] = useState<'estimated' | 'confirmed'>('confirmed')
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState('')
  const [ref, setRef] = useState('')
  const [rate, setRate] = useState('')
  const [paidFrom, setPaidFrom] = useState<FeePaidFrom>('usdc_gateway')
  const [date, setDate] = useState(today)
  const [error, setError] = useState('')
  const submit = () => {
    const minor = parseMinor(amount.trim().replace(',', '.'), 'USDC')
    if (minor === null || minor <= 0n) {
      setError(t('Informe o valor em USDC (até 6 casas).', 'Enter the amount in USDC (up to 6 decimals).'))
      return
    }
    const r = registerLedgerFee({ source: { module: 'treasury', recordId: source.trim() }, kind, status, amountMinor: minor.toString(), currency: 'USDC', ...(rate.trim() ? { rate: rate.trim().replace(',', '.') } : {}), ...(ref.trim() ? { relatedRef: ref.trim() } : {}), paidFrom, accountingDate: date })
    if (!r.ok) {
      setError(explainLedger(r.errors))
      return
    }
    toast.success(r.value.duplicate ? t('Taxa já registrada: nada foi duplicado.', 'Fee already recorded: nothing was duplicated.') : t('Taxa registrada.', 'Fee recorded.'))
    setAmount('')
    setError('')
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={t('Registrar taxa (USDC)', 'Record fee (USDC)')}>
      <p className="mb-3 text-xs text-subtle text-pretty">{t('Informe o valor real. O app nunca inventa percentuais. Taxa estimada não lança; só a confirmada vira lançamento.', 'Enter the actual amount. The app never invents percentages. An estimated fee does not post; only a confirmed one becomes an entry.')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Tipo', 'Type')}>
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as FeeKind)}>
            <option value="gateway">{t('Gateway Circle', 'Circle Gateway')}</option>
            <option value="network">{t('Rede (gas)', 'Network (gas)')}</option>
            <option value="processing">{t('Processamento', 'Processing')}</option>
            <option value="service">{t('Serviço', 'Service')}</option>
          </select>
        </Field>
        <Field label={t('Situação', 'Status')}>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as 'estimated' | 'confirmed')}>
            <option value="confirmed">{t('Confirmada', 'Confirmed')}</option>
            <option value="estimated">{t('Estimada', 'Estimated')}</option>
          </select>
        </Field>
        <Field label={t('Valor (USDC)', 'Amount (USDC)')}>
          <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.25" />
        </Field>
        <Field label={t('Data', 'Date')}>
          <DateField value={date} onChange={setDate} />
        </Field>
        <Field label={t('Operação de origem (ID)', 'Source operation (ID)')}>
          <input className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <Field label={t('Hash/referência', 'Hash/reference')}>
          <input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Field label={t('Taxa percentual (opcional)', 'Rate (optional)')}>
          <input className={inputCls} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.005" />
        </Field>
        <Field label={t('Paga com', 'Paid from')}>
          <select className={inputCls} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value as FeePaidFrom)}>
            <option value="usdc_gateway">{t('Saldo no Gateway', 'Gateway balance')}</option>
            <option value="usdc_wallet">{t('Carteira', 'Wallet')}</option>
            <option value="cash">{t('Caixa', 'Cash')}</option>
          </select>
        </Field>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-bad">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t('Cancelar', 'Cancel')}</Button>
        <Button onClick={submit} disabled={!source.trim()}>{t('Registrar', 'Record')}</Button>
      </div>
    </Modal>
  )
}

export function ReconciliationTab() {
  const { data, confirmLedgerFee } = useStore()
  const ledger = data.ledger
  const lang = getLang()
  const [state, setState] = useState<ReconState | ''>('')
  const [group, setGroup] = useState<ReconGroup | ''>('')
  const [q, setQ] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [page, setPage] = useState(0)
  const [review, setReview] = useState<ReconItem | null>(null)
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const [feeOpen, setFeeOpen] = useState(false)

  const items = useMemo(() => buildReconciliation(data), [data])
  const summary = useMemo(() => summarize(items), [items])
  const visible = items.filter((i) => (showResolved || !i.resolved) && (!state || i.state === state) && (!group || i.group === group) && (!q.trim() || `${i.label} ${i.key} ${reasonText(i.reason)}`.toLowerCase().includes(q.trim().toLowerCase())))
  const PAGE = 20
  const pages = Math.max(1, Math.ceil(visible.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const shown = visible.slice(cur * PAGE, cur * PAGE + PAGE)
  const pick = (s: ReconState) => {
    setState(state === s ? '' : s)
    setPage(0)
  }
  const confirmEstimated = (dedupeKey: string) => {
    const r = confirmLedgerFee(dedupeKey, { accountingDate: iso(new Date()) })
    if (r.ok) toast.success(t('Taxa confirmada e lançada.', 'Fee confirmed and posted.'))
    else toast.error(explainLedger(r.errors))
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <AutoPostingPanel />

      <div role="group" aria-label={t('Resumo da conciliação', 'Reconciliation summary')} className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KpiTile tone="ok" icon={<CheckCircle2 size={20} />} label={t('Conferidos', 'Matched')} value={String(summary.matched)} sub={t('Conferem com o razão', 'Match the ledger')} onClick={() => pick('matched')} selected={state === 'matched'} />
        <KpiTile tone="warn" icon={<Clock size={20} />} label={t('Pendentes', 'Pending')} value={String(summary.pending)} sub={t('Aguardam confirmação', 'Awaiting confirmation')} onClick={() => pick('pending')} selected={state === 'pending'} />
        <KpiTile tone="bad" icon={<AlertTriangle size={20} />} label={t('Divergências', 'Mismatches')} value={String(summary.mismatch)} valueTone={summary.mismatch > 0 ? 'bad' : undefined} sub={t('Valores ou lançamentos que não batem', 'Amounts or entries that disagree')} onClick={() => pick('mismatch')} selected={state === 'mismatch'} />
        <KpiTile tone="violet" icon={<ShieldAlert size={20} />} label={t('Requer revisão', 'Requires review')} value={String(summary.review)} sub={t(`${summary.resolved} já revisados`, `${summary.resolved} already reviewed`)} onClick={() => pick('review')} selected={state === 'review'} />
      </div>

      <BalanceViews />

      <TCard className="overflow-hidden">
        <div className="p-4 sm:p-5">
          <PanelTitle icon={<FileSearch size={18} />} title={t('Centro de Conciliação', 'Reconciliation center')} subtitle={t('Somente leitura: nada aqui altera saldos nem gera pagamentos. Apenas as suas decisões ficam registradas.', 'Read-only: nothing here changes balances or creates payments. Only your decisions are recorded.')} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
              <input className={clsx(inputCls, 'pl-9')} value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder={t('Buscar itens', 'Search items')} aria-label={t('Buscar itens', 'Search items')} />
            </div>
            <select className={clsx(inputCls, '!w-auto')} value={group} onChange={(e) => { setGroup(e.target.value as ReconGroup | ''); setPage(0) }} aria-label={t('Grupo', 'Group')}>
              <option value="">{t('Todos os grupos', 'All groups')}</option>
              {(['cashbook', 'sales', 'purchases', 'obligations', 'treasury', 'fees', 'integrity'] as ReconGroup[]).map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> {t('Mostrar revisados', 'Show reviewed')}
            </label>
          </div>
        </div>
        {visible.length === 0 ? (
          <Empty icon={<CheckCircle2 size={22} />} title={items.length === 0 ? t('Nada para conciliar', 'Nothing to reconcile') : t('Nenhum item com estes filtros', 'No items match these filters')} />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {shown.map((i) => (
              <li key={i.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATE_TONE[i.state]}>{stateLabel(i.state)}</Badge>
                    <span className="text-xs text-subtle">{groupLabel(i.group)}</span>
                    {i.resolved ? <Badge tone="neutral">{t('Revisado', 'Reviewed')}</Badge> : null}
                  </div>
                  <div className="mt-1 truncate text-sm font-medium">{i.label}</div>
                  <p className="text-xs text-muted text-pretty">{reasonText(i.reason)}</p>
                  <div className="num mt-0.5 text-xs text-subtle">
                    {i.date ? fmtDate(i.date) : ''} {i.amount !== undefined ? `· ${formatCurrency(i.amount, i.currency ?? data.settings.currency)}` : ''} {i.refs.txHash ? `· ${i.refs.txHash.slice(0, 10)}…` : ''}
                  </div>
                  {i.resolved ? <p className="mt-0.5 text-xs text-subtle">{i.resolved.actor.id}: {i.resolved.note}</p> : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {i.refs.explorerUrl ? (
                    <a href={i.refs.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-accent hover:bg-fill/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                      <ExternalLink size={13} /> {t('Explorer', 'Explorer')}
                    </a>
                  ) : null}
                  {i.refs.journalId ? (
                    <Button variant="ghost" onClick={() => setOpenEntry(i.refs.journalId as string)}><Eye size={15} /> {t('Lançamento', 'Entry')}</Button>
                  ) : null}
                  {i.state === 'pending' && i.refs.eventKey ? <Button onClick={() => setReview(i)}>{t('Confirmar…', 'Confirm…')}</Button> : null}
                  {i.state !== 'matched' && !(i.state === 'pending' && i.refs.eventKey) && !i.resolved && i.group !== 'fees' ? <Button variant="ghost" onClick={() => setReview(i)}>{t('Revisar', 'Review')}</Button> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
          <span className="num text-muted">{visible.length === 0 ? 0 : cur * PAGE + 1}–{Math.min(visible.length, cur * PAGE + PAGE)} {t('de', 'of')} {visible.length}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0}>{t('Anterior', 'Previous')}</Button>
            <span className="num text-muted">{cur + 1}/{pages}</span>
            <Button variant="ghost" onClick={() => setPage(Math.min(pages - 1, cur + 1))} disabled={cur >= pages - 1}>{t('Próxima', 'Next')}</Button>
          </div>
        </div>
      </TCard>

      <TCard className="p-4 sm:p-5">
        <PanelTitle
          icon={<Scale size={18} />}
          title={t('Taxas', 'Fees')}
          subtitle={t('Gateway, rede (gas), processamento. Estimadas ficam separadas das confirmadas.', 'Gateway, network (gas), processing. Estimated fees stay separate from confirmed ones.')}
          action={<Button variant="ghost" onClick={() => setFeeOpen(true)}><Plus size={15} /> {t('Registrar taxa', 'Record fee')}</Button>}
        />
        {ledger.fees.length === 0 ? (
          <p className="mt-3 text-sm text-subtle">{t('Nenhuma taxa registrada.', 'No fees recorded.')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
            {[...ledger.fees].reverse().map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium">{f.kind}</span> <Badge tone={f.status === 'confirmed' ? 'ok' : 'warn'}>{f.status === 'confirmed' ? t('confirmada', 'confirmed') : t('estimada', 'estimated')}</Badge>
                  <div className="text-xs text-subtle">{f.source.recordId}{f.relatedRef ? ` · ${f.relatedRef.slice(0, 12)}…` : ''}{f.rate ? ` · ${t('taxa', 'rate')} ${f.rate}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="num">{formatCurrency(Number(formatDecimal(BigInt(f.amountMinor), f.currency)), f.currency)}</span>
                  {f.status === 'estimated' ? <Button variant="ghost" onClick={() => confirmEstimated(f.dedupeKey)}>{t('Confirmar', 'Confirm')}</Button> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </TCard>

      <p className="text-xs text-subtle">{t(`Plano de contas com ${ledger.chart.length} contas · idioma ${lang.toUpperCase()}`, `Chart with ${ledger.chart.length} accounts · language ${lang.toUpperCase()}`)}</p>

      <EntryDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
      <ReviewModal item={review} onClose={() => setReview(null)} onOpenEntry={(id) => { setReview(null); setOpenEntry(id) }} />
      <FeeModal open={feeOpen} onClose={() => setFeeOpen(false)} />
    </div>
  )
}
