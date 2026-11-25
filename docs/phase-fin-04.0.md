# FIN-04.0 — Auditoria obrigatória e baseline

**HEAD inicial:** `fd6e1e7` (INV-1.0) · **HEAD final:** `71e3894`

Resultado: **558 testes passando** (eram 552) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

---

## 1. Baseline
- HEAD: `fd6e1e7` · working tree limpo · origin/main sincronizado.
- 552 testes → **558** após esta etapa (6 novos).

## 2. Mapeamento de fluxos (auditado)
- **Venda:** `recordSale` (Store) → consolida itens, baixa estoque, reconhece receita+CMV no razão via adaptador `sales`; `prazo` cria conta a receber; demais criam entrada no Livro-Caixa.
- **Compra:** `recordPurchase` → consolida itens, soma estoque (custo médio), cria obrigação (a prazo) ou saída (à vista); adaptador `purchases`.
- **Liquidação:** `settle`/`settleAccount`/`settleAccountPartial` → cria entrada no Livro-Caixa + `payable.settled`/`receivable.settled` no razão via adaptador `payables`.
- **Treasury:** `addTreasuryOp` → `verifyAndSettle` → `applyConfirmedAccounting` (alocação bigint, sem reenvio).

## 3. Causas-raiz identificadas (por que operações novas aparecem na Conciliação)
- Os adaptadores `sales`/`purchases`/`payables`/`payroll`/`treasury` ficam **desligados por padrão** (`engine.emptyLedger` liga apenas `cashBook`).
- `autoPost` só processa registros **criados DEPOIS** de ligar o adaptador (nada retroativo).
- Logo, vendas/compras/obrigações criadas com o adaptador desligado ficam sem evento no razão e aparecem na Conciliação como `legacy_unledgered`/`sale_missing`/`purchase_missing`/`obligation_missing`. É comportamento intencional (reconciliação é o caminho de recuperação — `reconcilePurchases`), **não** um bug de duplicação.

## 4. Pendências INV-1.0.1 resolvidas nesta etapa
| Pendência | Correção |
|---|---|
| Sucesso falso em `recordPurchase` | agora retorna `boolean`; `Purchases.submit` só limpa/confirma após `true`. |
| Validações sobre snapshot desatualizado | validação movida para DENTRO do updater (estado autoritativo via `apply`). |
| Vínculos de fornecedores entre ambientes | `addProduct`/`updateProduct` validam `primarySupplierId`/`alternateSupplierIds` (fornecedor do mesmo ambiente). |
| Conversão silenciosa de inválido em zero | `recordPurchase` rejeita qty/custo NaN/negativo/não-finito. |
| Submissões duplicadas | retorno explícito + limpeza só após sucesso. |
| Produtos repetidos (recebimento imediato) | consolidação por produto (quantidade+valor total) já vigente; obrigação considera todas as linhas. |
| Normalização de SKU / GTIN | SKU com `trim()`; GTIN validado pela política de ambiente (`validateProduct`). |

## 5. Pendências residuais (documentadas, fora desta etapa)
- **Recebimento posterior com produtos repetidos a custos diferentes:** `receiving.receiveGoods` resolve o custo por `items.find(productId)` (primeira ocorrência). Impacto apenas em compras com o mesmo produto em múltiplas linhas com custos distintos via Logística. Será tratado em FIN-04.5 (compras/contas a pagar).
- **Lançamento de abertura de estoque inicial** (sem contrapartida patrimonial) — FIN-04.7.
- **Máquina de estados operacional/financeiro/contábil** — FIN-04.1.
- Proteção de troca de ambiente durante formulário no nível de UI (o Store já captura `getNetwork()` no momento da operação) — refinamento em FIN-04.2+.

## 6. Próximas etapas (incrementais, com gate)
FIN-04.1 (estados) → FIN-04.2 (vendas/PDV) → FIN-04.3 (motor financeiro) → FIN-04.4 (Treasury) → FIN-04.5 (compras) → FIN-04.6 (conciliação) → FIN-04.7 (contábil) → FIN-04.8 (indicadores). Cada etapa com auditoria, causa-raiz, testes específicos, regressão completa e commit isolado.

## Arquivos
- **Modificados:** `store.tsx` (recordPurchase/addProduct/updateProduct), `Purchases.tsx` (submit com resultado).
- **Criados:** `tests/fin-04.0-audit.test.ts`.

## Rollback
`git revert <commit desta etapa>`
