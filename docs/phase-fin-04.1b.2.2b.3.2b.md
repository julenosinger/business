# FIN-04.1B.2.2B.3.2B — Authoritative Obligation Sync & Functional Gateway Checkout

**HEAD inicial:** `ffcffb7` · **HEAD final:** `(commit desta fase)`

Resultado: **724 testes passando** (eram 718) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO — sincronização autoritativa das obrigações e correções P0 do núcleo implementadas e testadas; execução on-chain e UI de checkout permanecem pendentes.**

---

## Gate P0 — Correções residuais do núcleo · APROVADO

- **P0.1** `sweepExhausted` não interrompe mais worker com lease ativo (só migra `processing` com lease expirado). Teste corrigido e documentado como correção de comportamento incorreto.
- **P0.2** `AutomationEffects.record` distingue repetição legítima (mesmo `resultReference`) de `effect_conflict` (resultReference diferente).
- **P0.3** `get(scope, jobId)` agora é vinculada ao escopo (organização + ambiente).

## Gate A/B — Sincronização autoritativa de obrigações · APROVADO

- Migration v7: `payment_obligations` (projeção versionada, PK `(org, env, obligation_id)`).
- `server/obligations.ts`: `syncObligation` (idempotente, versionada — stale → `version_conflict`) e `getObligation`.
- `createGatewayCharge` resolve a obrigação da projeção sincronizada (com fallback para o razão), eliminando o `obligation_not_found` causado pela obrigação existir somente no Store local.
- `POST /api/obligations/sync` (autenticada, sessão comercial ou Bearer).

## Gate C/D — Criação funcional de cobrança · APROVADO (caminho)

- `src/lib/payment-api.ts`: `syncObligationApi`.
- `ChargeModal` sincroniza a obrigação selecionada (`obligationOutstandingMinor` + `fromNumber`) antes de `createChargeApi`, com `version = settlements.length`. A cobrança de 15 USDC sobre obrigação de 40 agora encontra a obrigação no backend.

## Arquivos

- **Servidor:** `server/db.ts` (v7), `server/obligations.ts` (novo), `server/payments.ts`, `server/api.ts`, `server/handler.ts`, `server/automation.ts`.
- **Frontend:** `src/lib/payment-api.ts`, `src/lib/gateway-charge.ts`, `src/components/ChargeModal.tsx`.
- **Testes:** `tests/backend-obligations.test.ts` (novo), `tests/backend-automation.test.ts`.

## Testes (6 novos)

- `syncObligation` idempotente/versionada; isolamento org/ambiente; `createGatewayCharge` usa obrigação sincronizada (15 de 40); `obligation_not_found` sem sincronização; saldo parcial impede cobrança acima do disponível; P0.1/P0.2/P0.3.

## Pendências (fases seguintes)

- **Execução on-chain real (Gate G):** aprovação/depósito preparados (helpers existentes), mas a assinatura voluntária do pagador não é executada em testes.
- **UI da Treasury (Gate I):** `GET /api/payment-intents` existe, mas a seção Cobranças em USDC ainda não consome a lista autoritativa.
- **UI do checkout (Gate E):** `GatewayCheckout` exibe o valor/destino; o botão de pagamento (aprovation+deposit) permanece pendente de integração de carteira.
- **Confirmação financeira (Gate H):** `awaiting_verification` até verificador independente (3.2D/3.2G).

## Rollback

`git revert <commit-testes> && git revert <commit-feat>` (migration v7 é aditiva e não destrutiva)
