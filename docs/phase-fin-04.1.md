# FIN-04.1 — Unified Operational, Financial & Accounting State Engine

**HEAD inicial:** `70382dd` (FIN-04.0.2) · **HEAD final:** `(commit desta fase)`

Resultado: **571 testes passando** (eram 568) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

---

## Gate A — Foundation Integrity · APROVADO

### A1. Isolamento determinístico
`autoPost` passou a validar **ID + ambiente** conjuntamente em todos os vínculos: venda (`sourceKind='sale'`+`sourceId`+`environment`), compra (`sourceKind='purchase'`+`sourceId`+`environment`), liquidação (`sourceKind='account'`+`sourceId`+`settlementId`+`environment`). Não há mais associação exclusiva por valor/nome/descrição/data.

### A4. Excedentes e custo médio
`allocatePurchaseValue` agora retorna `{ value, excess }` e **não** valoriza o excedente pelo último custo conhecido. O excedente é sinalizado no evento do recebimento (`fields: ['excess']`) para tratamento explícito.

### A5. Idempotência persistente
`Sale`/`PurchaseRef`/`SaleInput`/`PurchaseInput` ganharam `intentId`. `recordSale`/`recordPurchase` rejeitam uma intenção já registrada (mesma chave não duplica), enquanto intenções legítimas distintas com conteúdo idêntico continuam permitidas. Protege contra duplo clique/reprocessamento; a guarda visual (`submitting`) permanece como defesa de UI.

### A6. Validações residuais
- **Dígito verificador GTIN (GS1)** na Mainnet (`gtinCheckDigitValid`), distinguindo `barcode_invalid` (formato) de `barcode_check` (dígito).
- Conversão silenciosa de inválidos em zero já eliminada em `recordPurchase` (FIN-04.0) e mantida.

## Testes
- **Novos (3):** GTIN check digit; idempotência de compra; idempotência de venda.
- **Atualizados:** fixtures de código de barras para um GTIN válido (`4006381333931`) e assinatura de `allocatePurchaseValue`.
- **Anteriores:** 568 preservados.

## Arquivos
- **Modificados:** `types.ts`, `store.tsx`, `product.ts`, `receiving.ts`, `accounting/autopost.ts`, `tests/{fin-04.0.1-linkage,fin-04.0.2,product-integrity,product-validation}.test.ts`.

## Gates B, C, D — PENDENTES (execução incremental)
- **B — Unified State Engine:** máquina de estados comercial/patrimonial/financeiro/contábil e transições (não iniciada).
- **C — Persistent Accounting Recovery:** eliminar `catch { return next }` e registro persistente de pendências contábeis (não iniciado).
- **D — Certificação integrada:** testes comportamentais de integração e cenário de venda integrada (não iniciado).

## Limitações residuais (documentadas, fora do gate A)
- **A2/A3 (recebimento individual por linha de compra + contabilização proporcional):** o controle permanece agregado por `receivedQty` e a contabilização do recebimento parcial segue pendente — exige encadear identidade de linha da compra pela Logística (ShipmentItem) e eventos patrimoniais por `receiptId`. Bloqueio técnico para o gate A; será tratado junto ao gate B/C.
- **Falha contábil explícita:** `autoPost` ainda devolve o estado sem alterar o razão em erro (sem pendência persistente) — gate C.
- **Atomicidade distribuída** entre abas/dispositivos não é garantida pela persistência atual (localStorage) — documentado.

## Rollback
`git revert ee55ca2 && git revert 2979f74`
