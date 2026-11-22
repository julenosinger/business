# Fase 2.6: Integridade de liquidação do Gateway e reconciliação persistente

Baseline: `af2b7e3` (Fase 2.5). Sem regressões: **249 testes passando** (eram 240), typecheck limpo, lint limpo,
build de produção OK.

**Objetivo: corrigir os defeitos P0/P1 restantes e implementar reconciliação automática controlada.**

---

## 1. Causa-raiz e correção — verificação cross-chain (P0)

**Defeito:** `reconcileTreasuryOp()` verificava o recibo na cadeia de origem usando `op.recipient`, mas para
operações do Gateway forwarder o hash do SDK não é uma transferência direta ao destinatário final.

**Evidência do SDK (auditada em `@circle-fin/unified-balance-kit`):**
- `SpendResult.txHash` é a transação de **MINT na cadeia de destino** (com `destinationChain`,
  `recipientAddress` e `transferId` para status via `GET /v1/transfer/{id}`).
- `DepositResult.txHash` é o **depósito na cadeia de origem** (com `depositedBy`/`depositedTo`).

**Correção (provider-aware):**
- `spend` → verifica o recibo na **cadeia de destino** (`op.destChain`), com `expectedTo = recipient` e valor exato.
- `deposit` → verifica o recibo na **cadeia de origem** (`op.chain`), com `expectedFrom = wallet` e valor exato.
- Um Transfer de USDC na origem nunca estabelece a entrega no destino; sem prova final, permanece
  `pending`/`requires_review` com motivo preciso.

## 2. Causa-raiz e correção — valor contábil exato (P0)

**Defeito:** `verifyAndSettle()` baixava `accountOutstanding(acc)` (saldo inteiro), mesmo quando a transação
verificada pagou apenas parte.

**Correção:** `allocationAmount()` converte o valor USDC verificado (unidades menores) para a moeda da conta:
- Moeda USDC → 1:1 (exato).
- BRL/USD/EUR → exige taxa de câmbio **registrada** no razão (`findFxRate`/`convertForReporting`). Sem ela →
  `fx_required` (a confirmação on-chain é preservada, a alocação contábil fica para revisão).
- A baixa é `min(valorVerificado, saldoEmAberto)`: 300/1.000 USDC → baixa 300, conta permanece aberta em 700.

## 3. Identidade e evidência de pagamento

`TreasuryOp` ganhou `wallet` (carteira de origem), `transferId` (identificador do Gateway) e `reviewReason`.
Estado on-chain separado do estado contábil. Registros históricos sem evidência seguem legado/desconhecido.

## 4. Concorrência e idempotência (P1)

- **Single-flight** por `opId` (conjunto `inflight`): múltiplos cliques/abas/requisições nunca geram duas baixas.
- Transições atômicas: o estado é re-verificado dentro do `setData` (terminal → não re-baixa).
- Reenvio de transação financeira nunca ocorre durante a reconciliação.

## 5. Reconciliação automática

- `ReconciliationCoordinator` (componente): retoma pendentes após reload; reconcilia ao ficar visível/online;
  polling limitado (base 30s, máx. 5min) com backoff exponencial + jitter (`backoffDelay`, testável);
  concorrência máxima de 2; pausa offline; worker único (sem duplicar).
- Só reconcilia `pending` (nunca `requires_review`, que exige humano). Botão **Verificar** manual preservado
  (agora também para depósitos).
- Erros de rede viram `requires_review`, nunca `failed`; operações ambíguas permanecem recuperáveis.

## 6. Depósitos

- Depósitos armazenam `wallet` e são verificáveis (`expectedFrom = wallet`). O botão "Verificar" cobre depósitos
  e pagamentos. Status reais exibidos (Pendente/Confirmada/Falhou/Requer revisão).

## 7. Testes (novos)

- `reconcileTreasuryOp`: spend verifica na cadeia de **destino**; deposit na cadeia de **origem**.
- `allocationAmount`: USDC 1:1; BRL sem taxa → `fx_required`; BRL com taxa registrada → conversão exata (1650);
  valor inválido → `invalid_amount`.
- `backoffDelay`: exponencial com jitter determinístico e limite máximo; `isAutoReconcilable` só `pending`.
- Suíte completa: **249 pass, 0 fail**.

## Dependências externas restantes (honestas)

- **Servidor/banco transacional**: transporte `fetch` pronto (fase 2.4), mas sem infra provisionada. Persistência
  segue `localStorage`. Migração local→servidor (backup + preview + aprovação) fica pendente do provisionamento.
- **Status de transferência do Gateway** (`GET /v1/transfer/{id}` via `transferId`): a verificação usa o recibo
  on-chain do mint/depósito; a consulta de status do provedor é a integração recomendada como camada adicional.
- **Finalidade (confirmações)**: a verificação usa o recibo confirmado; a exigência de N confirmações por rede
  pode ser parametrizada no futuro.

## Implantação e rollback

- Deploy: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 2.6 (rede/tema/dados ficam no `localStorage`, não em código).

## Próxima fase recomendada

1. Provisionar o servidor REST (contrato em `backend.ts`) e migrar o razão com backup/preview/aprovação.
2. Consultar o status de transferência do Gateway (`transferId`) como evidência adicional de destino.
3. Persistir progresso/última-checagem da reconciliação e coordenar jobs duráveis no backend.
