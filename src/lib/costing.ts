/**
 * Política de valorização de estoque: custo médio ponderado móvel.
 *
 * Ao entrar mercadoria, o custo unitário do produto é recalculado como a média ponderada do saldo
 * anterior com a nova entrada — NUNCA o último custo de aquisição (que inflaria todo o estoque
 * antigo). O custo é mantido com precisão de ponto flutuante e arredondado apenas na agregação
 * (valor de estoque / CMV), preservando o custo histórico capturado em cada venda.
 */
export function weightedAverageCost(prevStock: number, prevCost: number, addedQty: number, addedCost: number): number {
  const total = prevStock + addedQty
  if (total <= 0) return prevCost
  return (prevStock * prevCost + addedQty * addedCost) / total
}
