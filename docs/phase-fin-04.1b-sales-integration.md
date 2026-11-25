# FIN-04.1B — Integrated Sales, Treasury & Financial Settlement

**HEAD inicial:** `bf1716b` (FIN-04.1A) · **HEAD final:** `9e07847`

Resultado: **574 testes passando** (eram 571) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO (Gate 2 core entregue; Gates 3/4 parcialmente)**

---

## Causa-raiz
`recordSale` tratava USDC como pagamento imediato: criava uma entrada de caixa ao clicar em "Finalizar venda", sem comprovar o recebimento pela Treasury. Venda registrada ≠ pagamento recebido.

## Correção implementada (núcleo funcional)

### `recordSale` — USDC cria obrigação a receber
- `recordSale` agora retorna `SaleResult { ok, saleId, accountId }`.
- `method === 'usdc'` e `'prazo'` criam uma **conta a receber** (`source: 'sale'`, `sourceId: saleId`) em vez de entrada de caixa.
- Demais meios (Pix/cartão/dinheiro) seguem como "confirmado no caixa" (confirmação do operador).

### `Sales.tsx` — botão contextual e cobrança
- Botão contextual: **Gerar cobrança USDC** (USDC) / **Registrar venda a prazo** (prazo) / **Registrar e confirmar pagamento** (demais).
- Venda USDC abre o `ChargeModal` reutilizado da Treasury, vinculado à conta a receber da venda (a infraestrutura existente `addRequest` + `PaymentWatcher` liquida automaticamente ao detectar o recebimento).
- `intentId` (idempotência) conectado à interface de vendas.

## Cenário certificado (Café 100×2, venda 10×4 USDC)
| Etapa | Resultado |
|---|---|
| Após registrar a venda | estoque 90 · receita 40 · CMV 20 · lucro bruto 20 · conta a receber 40 · caixa 0 |
| Recebimento de 15 | conta a receber 25 · caixa 15 · parcialmente liquidada |
| Recebimento de 25 | conta a receber 0 · caixa 40 · receita/CMV/estoque inalterados |

Reprocessar evidências não duplica (idempotência por `settlementId` + `intentId`).

## Testes
- **Novos (3):** venda USDC gera obrigação sem caixa; liquidação parcial/integral sem duplicação; prazo vs. dinheiro.
- **Anteriores:** 571 preservados (fixtures de retorno de `recordSale` atualizadas para `SaleResult`).

## Arquivos
- **Modificados:** `store.tsx`, `Sales.tsx`, `tests/{fin-04.0.2,store-sale-integrity}.test.ts`.
- **Criados:** `tests/fin-04.1b-sales.test.ts`.

## Limitações e riscos residuais (Gates 3/4)
- **Painel profissional de recebimento** (QR code, progresso funcional, histórico de recebimentos, filtros por situação financeira) não foi construído — o `ChargeModal` existente é reutilizado, o que já exibe valor, rede, endereço, link e instruções reais.
- **Verificação on-chain** permanece via `PaymentWatcher` + `verifyAndSettle` existentes; nenhuma nova assinatura/contrato.
- **Separação completa método × condição** (parcelamento, pagamento parcial no formulário) ainda não implementada — `PayMethod` mantém a semântica atual; `'prazo'` continua como condição embutida.
- **Máquina de estados formal** (comercial/patrimonial/financeiro/contábil) não foi materializada como entidade persistente; a transição USDC→recebimento→liquidação é coberta pelos estados existentes de `Account`/`PaymentRequest`.
- **`'transferencia'`** (meio de pagamento) não adicionado ao `PayMethod`.
- Testes de navegador e operações on-chain reais não executados.

## Rollback
`git revert 99813e2 && git revert b54f112`
