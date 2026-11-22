# Fase 2.8: Finalização da liquidação financeira e backend durável

Baseline: `6e8273a` (Fase 2.7). Sem regressões: **256 testes passando** (eram 252), typecheck limpo, lint limpo,
build de produção OK.

**Objetivo: separar depósito de pagamento, recuperar confirmações com revisão contábil e modelar a alocação parcial exata.**

---

## 1. P0 — Separação estrutural de depósito e pagamento

`applyConfirmedAccounting` (extraído do antigo `verifyAndSettle`) agora distingue:

- **Depósito (sem `accountId`)**: apenas confirma o crédito on-chain (`status: 'confirmed'` + `settledAt`),
  **sem** qualquer alocação de obrigação. Depósito nunca é tratado como conta a pagar; o movimento de ativo é o
  evento `treasury.deposit` (autopost), não uma baixa de obrigação.
- **Pagamento (com `accountId`)**: verifica a entrega no destino e aloca exatamente o valor verificado à obrigação.

## 2. P0 — Recuperação de confirmação com revisão contábil

Novo `store.reconcileAccounting(opId)`:

- **Nunca** reenvia/re-verifica a transação on-chain (reusa a evidência já verificada).
- Recalcula a alocação exata (moeda da conta + FX registrado) para operações já `confirmed` com
  `accountingStatus: requires_review`.
- Idempotente: `settled`/`partially_settled` não realocam.
- Ação **"Reconciliar contabilidade"** na Atividade da Tesouraria (válida apenas quando `confirmed` + `requires_review`).
- Uma confirmação on-chain permanece confirmada mesmo se a contabilidade falhar.

## 3. Modelo de alocação parcial exata

`planAllocation(allocated, outstanding)` (puro, testado):

- Aloca `min(verificado, saldoEmAberto)`; se o pagamento supera o saldo, o **excesso** é preservado como
  `unallocatedAmount` (nunca descartado silenciosamente).
- `accountingStatus`: `partially_settled` (parcial) ou `settled` (total).
- Persistidos em `TreasuryOp`: `allocatedAmount` e `unallocatedAmount`.
- Exemplo: obrigação 1.000 USDC, já pago 700, pagamento verificado 300 → alocação 300, saldo 0, conta paga;
  cada pagamento é registrado individualmente como liquidação de 300.

## 4. Verificação de crédito no Gateway (reforço da fase 2.7)

- Depósitos: `expectedFrom = carteira` **E** `expectedTo = GatewayWallet` (contrato por rede), valor exato.
- Pagamentos: verificação na cadeia de **destino** (`expectedTo = destinatário`).
- Sem evidência de crédito do provedor, permanece `pending`/`requires_review` com motivo preciso.

## 5. Idempotência e recuperação

- `inflight` single-runtime + transições atômicas dentro do `setData` (terminal → não re-baixa).
- **Limitação honesta:** idempotência durável (constraints únicos no banco, multi-aba real) exige o backend
  (não provisionado). Frontend single-flight é otimização, não a fonte da correção financeira.
- Reenvio de transação nunca ocorre durante a reconciliação.

## 6. Testes (novos)

- `planAllocation`: 300/1.000 parcial; 1.000/1.000 liquidado; 1.300/1.000 preserva excesso 300; pagamento final
  (700+300) completa a obrigação.
- Suíte completa: **256 pass, 0 fail**.

## Dependências externas restantes (honestas)

- **Backend/banco transacional**: transporte `fetch` pronto (fase 2.4), mas sem infra provisionada. Persistência
  segue `localStorage`. **Não** há servidor/banco em operação (idempotência durável e migração completa pendentes).
- **Status de crédito do Gateway** (`GET /v1/transfer/{id}` via `transferId`): camada adicional recomendada; a
  verificação atual usa recibo on-chain + contrato.

## Implantação e rollback

- Deploy: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 2.8 (rede/tema/dados ficam no `localStorage`, não em código).

## Próxima fase recomendada

1. Provisionar o servidor REST (contrato em `backend.ts`) e migrar o razão com backup/preview/aprovação.
2. Persistir/consultar `transferId` como evidência adicional de crédito no Gateway.
3. Coordenação multi-aba via BroadcastChannel como otimização (não substituto do banco).
