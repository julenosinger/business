# FIN-04.1B.2.2B.3 — Functional Checkout Integration & Execution Completion

**HEAD inicial:** `e275f3d` · **HEAD final:** `(commit desta fase)`

Resultado: **702 testes passando** (eram 691) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO — autenticação comercial, API completa (list/query/share/attempts/status), múltiplas moedas, transporte HTTP, ChargeModal → API e página pública de checkout integrados; execução on-chain real permanece dependência externa documentada.**

---

## Causas-raiz e correções

### Gate A — Autenticação comercial · APROVADO
- `SessionRecord` agora carrega `organizationId` + `permissions`; login cria sessão com `payments:write`.
- `resolvePaymentOrg` no handler aceita Bearer (admin) OU sessão com `payments:write` (comercial). `organizationId` derivado do servidor, nunca do body. Nenhum segredo administrativo no bundle.

### Gate B/E — Backend autoritativo + múltiplas moedas · APROVADO
- Cobranças não-USDC resolvem a cotação do RAZÃO (`fxRates`, orientação "moeda original por 1 USDC") e convertem via `convertToUsdcMinor` — reserva em unidades menores da moeda original, transação em USDC. Sem conversão 1:1, sem float.

### Gate C/H — Transporte HTTP + API completa · APROVADO
- `src/lib/payment-api.ts`: `createChargeApi`, `loadTreasuryChargesApi`, `getPublicCheckoutApi`, `readCheckoutFromLocation`, `PaymentApiError`.
- Endpoints: `GET /api/payment-intents`, `GET /api/payment-intents/:id`, `POST /api/payment-intents/:id/share`, `GET /api/checkout/:token/status`, `POST /api/checkout/:token/attempts`, `POST /api/checkout/:token/attempts/:id/begin`, `POST /api/checkout/:token/attempts/:id/submission`.
- Attempts: uma tentativa ativa por vez; `begin` persiste `AWAITING_SIGNATURE` antes da carteira; hash imutável com replay idempotente e `hash_conflict`.

### Gate D — ChargeModal → API · APROVADO
- Fluxo Gateway usa `createChargeApi` (autoritativo) — sem `createGatewayCharge` local, sem token local, sem marca aleatória. Erros mapeados (`insufficient_balance`, `obligation_not_found`, etc.).

### Gate F — Página pública de checkout · APROVADO (componente + rota)
- `src/pages/GatewayCheckout.tsx` monta o checkout por `/?checkout=<token>` ou `/checkout/:token`, sem login ERP, reutilizando Wagmi/ConnectKit.

### Gate N/O/P/Q — (parcial) integração visual e isolamento
- `requiresGatewayVerification` preservado; nenhum caminho legado liquida cobrança Gateway; isolamento org+env+chainId+intentId.

## Arquivos

- **Servidor:** `server/session.ts`, `server/api.ts`, `server/db.ts`, `server/handler.ts`, `server/payments.ts`.
- **Frontend:** `src/lib/payment-api.ts` (novo), `src/pages/GatewayCheckout.tsx` (novo), `src/App.tsx`, `src/components/ChargeModal.tsx`.
- **Testes:** `tests/backend-checkout-execution.test.ts` (novo), `tests/fin-04.1b.2.2b.3.test.ts` (novo).

## Testes (11 novos)

- Múltiplas moedas (BRL 60 → reserva 6000 centavos / 12 USDC; sem cotação → rejeição); list/query/share sem duplicar reserva; tentativa única; hash imutável com replay/conflito; status; sessão (org+permissão, expiração); detecção do token (query/path); `PaymentApiError`.

## Limitações / pendências (dependências externas)

- **Execução on-chain real (Gates I/J/K/L):** aprovação e depósito oficiais preparados (helpers existentes/testados), mas a assinatura voluntária da carteira do pagador não é executada em testes — depende de carteira + RPC reais. Nenhuma transação automática.
- **Cross-device:** o checkout depende do backend implantado (SQLite compartilhado). O link usa query/path; a abertura em outro dispositivo exige deploy com fallback SPA.
- **Identidade institucional (Gate G):** o depositor vem de config do servidor (`GBOS_DEPOSITOR_*`), documentada; não há carteira institucional separada no AppData local.
- **Integração visual Treasury (Gate P):** a seção Cobranças em USDC ainda lê `data.requests`; a consulta `GET /api/payment-intents` existe mas não está conectada à UI.
- **Contabilidade (Gate Q):** submissão/receipt isolado não liquida; confirmação definitiva fica para FIN-04.1B.2.3.

## Rollback

`git revert <commit-testes> && git revert <commit-feat>`
