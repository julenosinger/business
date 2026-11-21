import { useState } from 'react'
import { BarChart3, Boxes, Landmark, Send, Sparkles, Truck } from 'lucide-react'
import { Card } from '@/components/ui'
import { useStore } from '@/lib/store'
import { useNav } from '@/lib/nav'
import { accountTotals, cashBalance, dueSoon, kpis, lowStock, monthPeriod } from '@/lib/selectors'
import { money, num } from '@/lib/format'
import { t } from '@/lib/i18n'
import { CAT_PURCHASE } from '@/lib/types'

type QuestionId = 'profit' | 'restock' | 'suppliers' | 'gateway'

function questions(): { id: QuestionId; label: string; icon: React.ReactNode }[] {
  return [
    { id: 'profit', label: t('Mostre o lucro deste mês', 'Show this month profit'), icon: <BarChart3 size={16} /> },
    { id: 'restock', label: t('Quais produtos precisam de reposição?', 'Which products need restocking?'), icon: <Boxes size={16} /> },
    { id: 'suppliers', label: t('Posso pagar os fornecedores esta semana?', 'Can I pay suppliers this week?'), icon: <Truck size={16} /> },
    { id: 'gateway', label: t('Prepare um pagamento via Circle Gateway', 'Prepare a payment via Circle Gateway'), icon: <Landmark size={16} /> },
  ]
}

export function AssistantPanel() {
  const { data } = useStore()
  const { requestPay, go } = useNav()
  const [answer, setAnswer] = useState<{ q: string; lines: string[] } | null>(null)

  const ask = (id: QuestionId, label: string) => {
    if (id === 'profit') {
      const k = kpis(data, monthPeriod(0))
      setAnswer({
        q: label,
        lines: [
          `${t('Faturamento', 'Revenue')}: ${money(k.revenue)}`,
          `${t('Custo das mercadorias vendidas', 'Cost of goods sold')}: ${money(k.cogs)}`,
          `${t('Despesas operacionais', 'Operating expenses')}: ${money(k.opex)}`,
          `${t('Lucro líquido do mês', 'Net profit this month')}: ${money(k.profit)}`,
        ],
      })
    } else if (id === 'restock') {
      const low = lowStock(data)
      setAnswer({
        q: label,
        lines: low.length
          ? low
              .slice(0, 6)
              .map((p) => t(`${p.name}: ${num(p.stock)} em estoque (mínimo ${num(p.minStock)})`, `${p.name}: ${num(p.stock)} in stock (minimum ${num(p.minStock)})`))
          : [t('Nenhum produto abaixo do estoque mínimo.', 'No product is below its minimum stock.')],
      })
    } else if (id === 'suppliers') {
      const due = dueSoon(data, 'payable', 7).filter((a) => a.category === CAT_PURCHASE)
      const total = due.reduce((s, a) => s + a.amount, 0)
      const cash = cashBalance(data)
      setAnswer({
        q: label,
        lines: due.length
          ? [
              t(
                `${due.length} pagamento(s) a fornecedores vencem em até 7 dias, somando ${money(total)}.`,
                `${due.length} supplier payment(s) fall due within 7 days, totaling ${money(total)}.`,
              ),
              t(`Saldo de caixa registrado: ${money(cash)}.`, `Recorded cash balance: ${money(cash)}.`),
              cash >= total
                ? t('O caixa cobre esses pagamentos.', 'Cash covers these payments.')
                : t(`Faltam ${money(total - cash)} para cobrir tudo.`, `${money(total - cash)} short of covering everything.`),
            ]
          : [t('Não há pagamentos a fornecedores vencendo nos próximos 7 dias.', 'No supplier payments fall due in the next 7 days.')],
      })
    } else {
      const next = data.accounts.filter((a) => a.kind === 'payable' && a.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
      if (next) {
        requestPay(next.id)
      } else {
        setAnswer({ q: label, lines: [t('Não há contas a pagar em aberto para preparar.', 'There are no open payables to prepare.')] })
        go('treasury')
      }
    }
  }

  const totals = accountTotals(data)

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="display flex items-center gap-2 text-base font-semibold">
          <Sparkles size={18} className="text-accent" /> {t('Assistente financeiro', 'Finance assistant')}
        </h3>
      </div>
      <p className="text-sm text-muted text-pretty">
        {t('Escolha uma pergunta. As respostas são calculadas com os dados do seu negócio.', 'Pick a question. Answers are calculated from your business data.')}
      </p>
      <div className="flex flex-col gap-2">
        {questions().map((q) => (
          <button
            key={q.id}
            onClick={() => ask(q.id, q.label)}
            className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-fill/5 px-3 text-left text-sm text-ink transition hover:bg-surface-strong"
          >
            <span className="text-accent">{q.icon}</span>
            <span className="flex-1">{q.label}</span>
            <Send size={14} className="text-subtle" />
          </button>
        ))}
      </div>
      {answer ? (
        <div className="rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm" aria-live="polite">
          <div className="label mb-2">{answer.q}</div>
          <ul className="space-y-1 text-ink">
            {answer.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl bg-fill/5 p-3 text-xs text-subtle">
          {t(`Em aberto: ${money(totals.receivable)} a receber e ${money(totals.payable)} a pagar.`, `Open: ${money(totals.receivable)} receivable and ${money(totals.payable)} payable.`)}
        </div>
      )}
    </Card>
  )
}
