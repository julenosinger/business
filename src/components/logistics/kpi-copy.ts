import { t } from '@/lib/i18n'
import type { KpiKey } from '@/lib/logistics'

export interface KpiCopy {
  title: string
  description: string
  emptyTitle: string
  /** Mostra o botão "Nova remessa" no estado vazio. */
  offerNew: boolean
}

/** Textos de cada cartão de indicador. `period` descreve a janela, ex.: "nos últimos 30 dias". */
export function kpiCopy(key: KpiKey | null, period: string): KpiCopy {
  switch (key) {
    case 'active':
      return {
        title: t('Remessas ativas', 'Active shipments'),
        description: t('Prontas ou em andamento e ainda não concluídas, incluindo atrasadas e com exceção. Não depende do período.', 'Ready or in progress and not yet completed, including delayed and exception shipments. Not affected by the period.'),
        emptyTitle: t('Nenhuma remessa ativa.', 'No active shipments.'),
        offerNew: true,
      }
    case 'moving':
      return {
        title: t('Em trânsito', 'In transit'),
        description: t('Despachadas, em trânsito ou saindo para entrega. Não depende do período.', 'Dispatched, in transit or out for delivery. Not affected by the period.'),
        emptyTitle: t('Nenhuma remessa em trânsito no momento.', 'No shipments currently in transit.'),
        offerNew: true,
      }
    case 'delivered':
      return {
        title: t('Entregues', 'Delivered'),
        description: t(`Entregas confirmadas ${period}, pela data real de entrega.`, `Confirmed deliveries ${period}, by actual delivery date.`),
        emptyTitle: t('Nenhuma entrega confirmada neste período.', 'No confirmed deliveries in this period.'),
        offerNew: false,
      }
    case 'problems':
      return {
        title: t('Atrasos e exceções', 'Delays and exceptions'),
        description: t('Remessas atrasadas, com exceção em aberto ou com a data prevista de entrega já vencida. Não depende do período.', 'Delayed shipments, open exceptions or shipments past their estimated delivery date. Not affected by the period.'),
        emptyTitle: t('Nenhuma remessa atrasada ou exceção em aberto.', 'No delayed shipments or unresolved exceptions.'),
        offerNew: false,
      }
    case 'freight':
      return {
        title: t('Custos de frete', 'Freight costs'),
        description: t(`Remessas criadas ${period} com frete registrado (canceladas ficam de fora). Valores por moeda, sem converter.`, `Shipments created ${period} with freight recorded (cancelled ones excluded). Amounts per currency, not converted.`),
        emptyTitle: t('Nenhum custo de frete registrado.', 'No freight costs recorded.'),
        offerNew: true,
      }
    case 'onTime':
      return {
        title: t('Entregas no prazo', 'On-time deliveries'),
        description: t(`Entregas ${period} que têm data prevista e data real, comparadas para medir a pontualidade.`, `Deliveries ${period} that have both an estimated and an actual date, compared to measure punctuality.`),
        emptyTitle: t('Entregas concluídas insuficientes para calcular a pontualidade.', 'Insufficient completed deliveries to calculate punctuality.'),
        offerNew: false,
      }
    default:
      return {
        title: t('Todas as remessas', 'All shipments'),
        description: t('Todas as remessas registradas. Clique em um indicador para filtrar.', 'All recorded shipments. Click an indicator to filter.'),
        emptyTitle: t('Nenhuma remessa registrada.', 'No shipments recorded.'),
        offerNew: true,
      }
  }
}
