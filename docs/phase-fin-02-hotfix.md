# HOTFIX FIN-02 — Accounting Engine, Inventory Valuation & Financial Reconciliation

**HEAD inicial:** `266429b` (FIN-03.2.1) · **HEAD final:** `(commit desta fase)`

Resultado: **532 testes passando** (eram 519) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

---

## Causas-raiz comprovadas

1. **Valorização pelo último custo (P3).** `recordPurchase` e `receiving.receiveGoods` faziam `cost: it.cost` — o custo da última compra passava a valorizar TODO o estoque antigo. No cenário, o arroz (150.000×5) + entrada (30.000×6) passava a valer 180.000×6 = 1.080.000 (em vez de 930.000), gerando a diferença de **150.000** que elevava o estoque de 2.370.000 para 2.520.000.
2. **Recuperação de compra já paga incompleta (P2).** `planPurchaseReconciliation` só recuperava o reconhecimento (`purchase.recorded`), deixando a obrigação a pagar com saldo residual no razão quando a compra a prazo já estava paga.

## Correções implementadas

### Valorização do estoque (P3) — custo médio ponderado móvel
- Novo `src/lib/costing.ts`: `weightedAverageCost(prevStock, prevCost, addedQty, addedCost)`.
- `recordPurchase` e `receiveGoods` recalculam o custo médio ponderado (nunca o último custo), mantendo custo com precisão de float e arredondando apenas na agregação (valor de estoque / CMV).
- O CMV de cada venda continua capturado no momento da venda (`sale.items[].cost`), preservando o custo histórico.
- Cenário: arroz 150.000×5 + 30.000×6 → 180.000 unidades @ ~5,1667 = **930.000**; estoque total **2.370.000** (confirmado por teste).

### Recuperação histórica (P2)
- `planPurchaseReconciliation` agora propõe também a **liquidação** (`payable.settled`, débito contas a pagar / crédito caixa) quando a obrigação da compra já está paga (`status === 'paid'` ou liquidações somando o valor).
- Idempotente (`purchase:<id>:recorded` + `account:<id>:settle:1`); recuperação repetida não duplica.
- Só toca o razão: estoque, Livro-Caixa, compras e contas permanecem intactos.

### Receitas sem CMV (P5)
- `Reports` agora sinaliza resultado **provisório** (lucro bruto/líquido/margem) quando `cogsIncomplete` — alinhado a Dashboard e DRE.

## Comparativo financeiro do cenário (antes → depois)
| Indicador | Antes (bug) | Depois |
|---|---|---|
| Entradas | 1.080.000 | **1.080.000** |
| Saídas | 685.000 | **685.000** |
| Fluxo de caixa líquido | 395.000 | **395.000** |
| CMV da venda | 60.000 | **60.000** |
| Valor do estoque (custo médio) | 2.520.000 | **2.370.000** |

Fluxo de caixa **não muda** (395.000) — a correção é contábil/patrimonial, não de caixa.

## Arquivos
- **Modificados:** `accounting/purchase-reconcile.ts`, `receiving.ts`, `store.tsx`, `Reports.tsx`, `tests/fulfillment.test.ts` (assertion corrigida para custo médio).
- **Criados:** `costing.ts`, `tests/{costing,store-inventory,purchase-reconcile,fin-scenario}.test.ts`.

## Testes
- **Novos (13):** custo médio (5), valorização no Store/CMV histórico/fornecedor não reestoca (3), recuperação histórica (4), cenário integral (1).
- **Anteriores:** 519 preservados (1 assertion corrigida — o teste de recebimento agora espera o custo médio, não o último custo).

## Limitações e riscos residuais
- **P4 (saldos iniciais):** o lançamento de abertura do estoque inicial (débito estoque / crédito contrapartida patrimonial) ainda **não** é gerado; o estoque inicial existe nos produtos/movimentações, mas não há partida de abertura no razão. Fica pendente (nova funcionalidade — não implementada nesta fase, conforme P12).
- **P5 completo:** vínculo de recebimento a venda existente e CMV manual comprovável seguem pendentes; `cogsIncomplete` cobre a sinalização provisória e a reclassificação de categoria já existia.
- **Testes de navegador/on-chain não executados** — não declarados como concluídos.
- Backups anteriores permanecem compatíveis (nenhuma migração destrutiva; a mudança de custo afeta apenas compras novas, nunca reescreve histórico).

## Roteiro para testes manuais do proprietário (Arc Testnet)
1. Criar arroz com estoque 150.000 a custo 5.
2. Compra a prazo de 30.000 a 6 → conferir custo médio (~5,17) e valor de estoque 930.000.
3. Vender feijão e conferir CMV/estoque.
4. Ativar "Compras" na Conciliação e recuperar uma compra a prazo já paga → conferir reconhecimento + liquidação no Razão Geral.
5. Lançar receita manual de mercadorias sem venda → conferir aviso "resultado provisório" em Dashboard/DRE/Relatórios.

## Rollback
`git revert 42d8599 && git revert 438e585 && git revert 4faffaa`
