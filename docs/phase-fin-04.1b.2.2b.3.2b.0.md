# HOTFIX FIN-04.1B.2.2B.3.2B.0 — Runtime Charge Creation Failure

**HEAD inicial:** `fbb88ad` · **HEAD final:** `d85dd3e`

Resultado: **727 testes passando** (eram 724) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: CORRIGIDO — causa-raiz comprovada e diagnosticada; fluxo HTTP completo (login → sync → cobrança → checkout) verificado por teste de integração.**

---

## Causa-raiz comprovada (Gate A/B)

O fluxo funciona ao nível de código (comprovado por teste HTTP end-to-end). A falha em runtime era:

1. **Contrato de payload divergente:** o backend exigia `companyName` (obrigatório) no DTO, mas o frontend (`CreateChargeRequest`) não o enviava — `input.companyName` era `undefined` e persistido como `NULL`.
2. **Erro mascarado:** a mensagem genérica "Não foi possível criar a cobrança…" escondia o código real. Respostas não-JSON (ex.: fallback SPA, 404 sem proxy) eram tratadas como `{}` e viraram `charge_creation_failed`/`sync_failed`, sem distinguir `endpoint_not_found`, `invalid_response` ou `backend_unavailable`.
3. **Deploy/proxy:** o `vite.config.ts` não tinha proxy para `/api` (desenvolvimento), então `fetch('/api/…')` não alcançava o backend Bun (porta 8787).

## Correções (Gate B/C)

- **`server/payments.ts`:** `companyName` agora é opcional (`companyName?: string`) e persistido com `?? null` — sem erro de contrato.
- **`src/lib/payment-api.ts`:** `CreateChargeRequest` inclui `companyName`/`publicDescription`; novo `errorCodeFor()` distingue `endpoint_not_found` (404), `invalid_response` (não-JSON) e `backend_unavailable` (rede).
- **`src/components/ChargeModal.tsx`:** envia `companyName` + `publicDescription`; `explainPaymentError` mapeia TODOS os códigos (`invalid_input`, `invalid_obligation`, `invalid_environment`, `endpoint_not_found`, `invalid_response`, `sync_failed`, `permission_denied`, …) com mensagens PT/EN específicas e acionáveis.
- **`vite.config.ts`:** proxy `/api` → `http://localhost:8787` (desenvolvimento), mantendo a sessão same-origin.

## Evidência (Gate E) — teste HTTP real

`tests/backend-checkout-http.test.ts` (3 testes):
- Login → sincronização da obrigação (3 USDC) → criação da cobrança → checkout público (sem sessão) com `usdcMinor = '3000000'` e `company = 'Acme'`.
- Sem sessão → `401 { error: 'unauthorized' }`.
- Obrigação não sincronizada → `409 { reason: 'obligation_not_found' }`.

## Arquivos

- **Servidor:** `server/payments.ts`.
- **Frontend:** `src/lib/payment-api.ts`, `src/components/ChargeModal.tsx`.
- **Config:** `vite.config.ts`.
- **Testes:** `tests/backend-checkout-http.test.ts` (novo).

## Pendências

- **Deploy de produção:** requer reverse proxy ou o backend Bun servindo o frontend estático no mesmo domínio (fora do escopo de código desta fase; o proxy de dev foi adicionado).
- **Execução on-chain:** permanece pendente (3.2C/3.2D), sem liquidação fictícia.

## Rollback

`git revert 767c1ae && git revert 9a1e3a8`
