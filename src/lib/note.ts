/**
 * Notas/comprovantes internos (não-fiscais) para impressão ou salvamento em PDF.
 *
 * Gera um HTML imprimível (limpo, com CSS de impressão) e abre a janela de impressão do navegador
 * via `window.print()`. Não é um documento fiscal (NF-e); é um comprovante interno para imprimir/salvar.
 *
 * As funções `saleNote`/`purchaseNote`/`accountNote` são PURAS (devolvem HTML) e testáveis;
 * `openNote` é o único efeito colateral (abre a janela), restrito ao navegador.
 */
import type { Account, PurchaseRef, Sale, Settings } from './types'
import { fmtDate, money, num } from './format'
import { t } from './i18n'

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

export interface NoteItem {
  name: string
  sku?: string
  qty: number
  unitValue: number
  total: number
}

export interface NotePayload {
  kind: 'sale' | 'purchase' | 'account'
  /** Título do tipo de operação (ex.: "Venda", "Compra", "Conta a pagar"). */
  kindLabel: string
  number: string
  date: string
  partyLabel: string
  party: string
  status: string
  total: number
  items: NoteItem[]
  extra: { label: string; value: string }[]
}

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 24px; font-size: 13px; line-height: 1.45; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; }
  .co { color: #444; font-size: 12px; }
  .tag { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #666; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .total { font-size: 15px; font-weight: 700; }
  .status { display: inline-block; margin-top: 14px; padding: 4px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; background: #eee; }
  .foot { margin-top: 20px; color: #888; font-size: 11px; }
  .meta { width: 100%; border-collapse: collapse; }
  .meta td { border: none; padding: 3px 0; }
  .meta td:first-child { color: #666; width: 40%; }
  .print-btn { margin-top: 18px; padding: 8px 16px; font-size: 13px; }
  @media print { .print-btn { display: none; } body { margin: 0; } }
`

function renderNote(settings: Settings, p: NotePayload): string {
  const itemRows = p.items.length
    ? p.items
        .map(
          (i) =>
            `<tr><td>${esc(i.name)}${i.sku ? ` <span style="color:#888">(${esc(i.sku)})</span>` : ''}</td>` +
            `<td class="num">${num(i.qty)}</td>` +
            `<td class="num">${money(i.unitValue)}</td>` +
            `<td class="num">${money(i.total)}</td></tr>`,
        )
        .join('')
    : ''

  const extraRows = p.extra.map((e) => `<tr><td>${esc(e.label)}</td><td>${esc(e.value)}</td></tr>`).join('')

  const itemsSection = p.items.length
    ? `<table>
        <thead><tr><th>${t('Item', 'Item')}</th><th class="num">${t('Qtd', 'Qty')}</th><th class="num">${t('Unitário', 'Unit')}</th><th class="num">${t('Total', 'Total')}</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>`
    : ''

  const extraSection = p.extra.length ? `<table class="meta"><tbody>${extraRows}</tbody></table>` : ''

  return `<!doctype html>
<html lang="pt">
<head><meta charset="utf-8"><title>${esc(p.kindLabel)} ${esc(p.number)}</title><style>${CSS}</style></head>
<body>
  <header>
    <div>
      <h1>${esc(settings.company || t('Global Business OS', 'Global Business OS'))}</h1>
      ${settings.branch ? `<div class="co">${esc(settings.branch)}</div>` : ''}
      ${settings.owner ? `<div class="co">${esc(settings.owner)}</div>` : ''}
    </div>
    <div style="text-align:right">
      <div class="tag">${esc(p.kindLabel)}</div>
      <div style="font-size:14px;font-weight:700">${esc(p.number)}</div>
    </div>
  </header>

  <table class="meta">
    <tbody>
      <tr><td>${t('Data', 'Date')}</td><td>${esc(fmtDate(p.date))}</td></tr>
      <tr><td>${esc(p.partyLabel)}</td><td>${esc(p.party || '—')}</td></tr>
      ${extraRows}
    </tbody>
  </table>

  ${itemsSection}

  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px">
    <span class="status">${esc(p.status)}</span>
    <div class="total">${t('Total', 'Total')}: ${money(p.total)}</div>
  </div>

  ${extraSection}

  <div class="foot">${t('Comprovante interno — não é documento fiscal.', 'Internal receipt — not a fiscal document.')}</div>
  <button class="print-btn" onclick="window.print()">${t('Imprimir / Salvar PDF', 'Print / Save PDF')}</button>
  <script>setTimeout(function(){ window.focus(); window.print(); }, 250);</script>
</body>
</html>`
}

/** Nota de uma venda (PDV). */
export function saleNote(sale: Sale, settings: Settings): string {
  const status = sale.canceledAt ? t('Cancelada', 'Canceled') : t('Concluída', 'Completed')
  const methodLabel =
    sale.method === 'prazo'
      ? t('A prazo', 'On credit')
      : sale.method === 'usdc'
        ? 'USDC'
        : sale.method === 'cartao'
          ? t('Cartão', 'Card')
          : sale.method === 'dinheiro'
            ? t('Dinheiro', 'Cash')
            : 'Pix'
  return renderNote(settings, {
    kind: 'sale',
    kindLabel: t('Venda', 'Sale'),
    number: sale.id,
    date: sale.date,
    partyLabel: t('Cliente', 'Customer'),
    party: sale.customerName,
    status,
    total: sale.total,
    items: sale.items.map((i) => ({ name: i.name, qty: i.qty, unitValue: i.price, total: i.qty * i.price })),
    extra: [{ label: t('Pagamento', 'Payment'), value: methodLabel }],
  })
}

/** Nota de uma compra registrada. */
export function purchaseNote(purchase: PurchaseRef, settings: Settings): string {
  const status = purchase.stockPosted ? t('Recebida', 'Received') : t('Aguardando recebimento', 'Awaiting receipt')
  return renderNote(settings, {
    kind: 'purchase',
    kindLabel: t('Compra', 'Purchase'),
    number: purchase.id,
    date: purchase.date,
    partyLabel: t('Fornecedor', 'Supplier'),
    party: purchase.supplierName,
    status,
    total: purchase.total,
    items: purchase.items.map((i) => ({ name: i.name, sku: i.sku, qty: i.qty, unitValue: i.cost, total: i.qty * i.cost })),
    extra: [],
  })
}

/** Nota de uma conta a pagar/receber. */
export function accountNote(account: Account, settings: Settings): string {
  const partial = (account.settlements?.length ?? 0) > 0 && account.status === 'open'
  const status =
    account.status === 'paid'
      ? account.kind === 'payable'
        ? t('Paga', 'Paid')
        : t('Recebida', 'Received')
      : partial
        ? t('Parcial', 'Partial')
        : t('Aberta', 'Open')
  const extra: { label: string; value: string }[] = []
  if (account.kind === 'payable' && account.dueDate) extra.push({ label: t('Vencimento', 'Due date'), value: fmtDate(account.dueDate) })
  if (account.category) extra.push({ label: t('Categoria', 'Category'), value: account.category })
  return renderNote(settings, {
    kind: 'account',
    kindLabel: account.kind === 'payable' ? t('Conta a pagar', 'Payable') : t('Conta a receber', 'Receivable'),
    number: account.documentNumber || account.id,
    date: account.issuedAt || account.dueDate,
    partyLabel: account.kind === 'payable' ? t('Fornecedor', 'Supplier') : t('Cliente', 'Customer'),
    party: account.contactName,
    status,
    total: account.amount,
    items: [{ name: account.description, qty: 1, unitValue: account.amount, total: account.amount }],
    extra,
  })
}

/** Abre a nota em uma janela para imprimir/salvar em PDF (navegador apenas). */
export function openNote(html: string): void {
  if (typeof window === 'undefined') return
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}
