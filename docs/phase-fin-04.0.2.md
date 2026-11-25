# FIN-04.0.2 — Financial Linkage & Inventory Integrity Certification

**HEAD inicial:** `6f6e95d` (FIN-04.0.1) · **HEAD final:** `7c3f225`

**Status final: PARCIALMENTE APROVADO**

Resultado: **568 testes passando** (eram 564) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

---

## Causas-raiz comprovadas e correções

### 1. Recebimentos parciais acumulativos (P0)
`receiveGoods` marcava `stockPosted: true` após o **primeiro** recebimento (mesmo parcial) e rejeitava um segundo recebimento (`purchase_already_received`) ou o tratava como `already_counted`. Corrigido:
- `PurchaseRef.receivedQty?` acumula a quantidade aceita.
- `stockMode` passa a distinguir: compra imediata (`already_counted`), primeira entrada (`posted`), recebimento parcial (`posted` enquanto `receivedQty < totalQty`), integralmente recebida (`already_counted`).
- Múltiplos recebimentos legítimos são permitidos; a mesma remessa não é conferida duas vezes (guarda `shipment.receiptId`).

### 2. Persistência da alocação de custos (P0)
`allocatePurchaseValue` reconstruía a fila original a cada recebimento. Corrigido com `remainingPurchaseAllocation`, que deriva a fila **restante** do histórico imutável de recebimentos (`receipts` ordenados por `receivedAt`), consumindo em FIFO. Cenário: 100@5 + 20@6 → 1º recebimento 60 (300) → 2º recebimento 40@5 + 20@6 (320) → total 620, custo médio ~5,1667.

### 3. Custo médio em aquisições de valor zero (P0)
Removida a condição `value > 0` que impedia a diluição do custo médio. Cenário: 10@5 + 10 grátis → 20 unidades a 2,50.

### 4. Associação individual por settlementId (P0)
`Entry.settlementId?` foi adicionado; `settle()` grava o id da liquidação; `autoPost` vincula a entrada de caixa por `settlementId` (com fallback legado pela conta). Três liquidações da mesma conta geram vínculos distintos.

### 5. Submissão duplicada (P1)
`Purchases.submit` ganhou guarda `useRef` contra duplo clique; o formulário só é limpo após sucesso.

## Testes
- **Novos (4):** custo zero via Store, `allocatePurchaseValue` com zero, `remainingPurchaseAllocation` persistente, três liquidações com `settlementId` distintos.
- **Anteriores:** 564 preservados.

## Cenário financeiro de regressão (preservado)
620 / custo médio ~5,1667 / estoque 90·465 / receita 240 / CMV 155 / lucro bruto 85 / despesas 10 / lucro líquido 75 / margem 31,25% / fluxo −390 / obrigações zero / balancete equilibrado — **sem alteração de saldos**.

## Arquivos
- **Modificados:** `types.ts`, `store.tsx`, `receiving.ts`, `accounting/autopost.ts`, `Purchases.tsx`.
- **Criados:** `tests/fin-04.0.2.test.ts`.

## Limitações residuais (bloqueios documentados → PARCIALMENTE APROVADO)
1. **Falhas contábeis explícitas e recuperáveis (P0)** — `autoPost` ainda faz `catch { return next }`, ocultando falhas de lançamento. Exige o mecanismo persistente de pendências da FIN-04.1 (máquina de estados), deliberadamente não antecipado.
2. **Idempotência de compras entre abas/dispositivos (P0)** — a arquitetura atual (localStorage, sem backend multiusuário) não oferece atomicidade distribuída. A proteção implementada é contra duplo clique na mesma sessão; reenvios cross-session permanecem limitados e documentados.
3. **Validação do dígito verificador GTIN** (P1) — pendente (validação de formato já existe; check digit não).
4. **Troca de ambiente durante formulário** (UI) — o Store captura `getNetwork()` no momento da operação; invalidação explícita da sessão de edição ao trocar de rede permanece pendente.

## Rollback
`git revert 2e6a0f6 && git revert be4512c && git revert 5e47ed9`
