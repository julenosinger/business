# FIN-04.0.1 — Final Integrity & Deterministic Accounting Linkage

**HEAD inicial:** `0c60f4f` (FIN-04.0) · **HEAD final:** `dd07a3e`

**Status final: APROVADO**

Resultado: **564 testes passando** (eram 558) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

---

## Causas-raiz comprovadas

1. **Associação contábil por coincidência.** `autoPost.claim()` vinculava vendas/compras/liquidações a entradas do Livro-Caixa por `categoria + data + valor` (e, em liquidações, por `descrição`). Operações distintas com mesmo valor/data eram confundidas; a entrada correta é determinada por `sourceKind`/`sourceId` que o Store já grava.
2. **Obrigação de compra sem vínculo com a compra.** `Account` não tinha `sourceId`; o `autoPost` localizava a conta por `amount + contactName` (coincidência).
3. **Recebimento posterior com custo errado.** `receiving.receiveGoods` usava `items.find(productId)` — a primeira ocorrência — selecionando incorretamente o custo quando o mesmo produto aparece em múltiplas linhas com custos diferentes.

## Correções

### Vínculo determinístico (P0)
- `Account.sourceId?` (retrocompatível): `recordSale`/`recordPurchase` gravam `sourceId = saleId/purchaseId` na obrigação.
- `autoPost` passou a vincular por **IDs**: venda → `sourceKind='sale'`+`sourceId`; compra → `sourceKind='purchase'`+`sourceId` e conta → `sourceId=purchaseId`; liquidação → `sourceKind='account'`+`sourceId`.
- Registros legados sem vínculo **não** são mais associados por aproximação — ficam pendentes de conciliação.

### Recebimento e custo médio (P0)
- `receiveGoods` usa **alocação determinística e auditável** por linha de compra (consome as linhas em ordem), usando `weightedAverageFromValue` sobre o valor efetivamente recebido. Suporta produto repetido com custos distintos, recebimentos parciais/totais e excedente.

### Idempotência / isolamento
- Preservadas (já vigentes): chaves de evento por `idempotencyKey`+`environment`; `recordPurchase` com resultado explícito e validação no estado autoritativo; `sourceId` agora também propaga o ambiente implicitamente pelo registro de origem.

## Cenário financeiro de regressão (preservado)
Compra 100@5 + 20@6 (620) · venda 30@8 · liquidações · despesa 10 → custo médio ~5,1667, estoque 90/465, receita 240, CMV 155, lucro bruto 85, lucro líquido 75, margem 31,25%, fluxo −390, obrigações zero, balancete equilibrado. **Sem alteração de saldos.**

## Testes
- **Novos (6):** duas vendas idênticas não colidem; entrada legada sem vínculo fica pendente; alocação de custo (total/parcial/excedente/sem compra).
- **Atualizados:** fixtures de `accounting-ledger.test.ts` passam a carregar `sourceKind`/`sourceId` (refletindo a forma real do Store).
- **Anteriores:** 558 preservados.

## Arquivos
- **Modificados:** `types.ts`, `store.tsx`, `accounting/autopost.ts`, `receiving.ts`, `tests/accounting-ledger.test.ts`.
- **Criados:** `tests/fin-04.0.1-linkage.test.ts`.

## Limitações e riscos residuais
- **Falha contábil persistente/recoverável** (distinguir "comercial registrado × contábil pendente × contabilizado") ainda é superficial — `autoPost` continua devolvendo o estado sem alterar o razão em erro. A modelagem explícita de pendência contábil persistente fica para FIN-04.3/04.7.
- **Abertura de saldo inicial de estoque** (contrapartida patrimonial) permanece pendente (FIN-04.7).
- **Máquina de estados** operacional/financeiro/contábil (FIN-04.1) ainda não implementada.
- Nenhuma mudança na Treasury/contratos; pagamentos USDC continuam pendentes até revisão humana.

## Rollback
`git revert 5725b08 && git revert a6a9624`
