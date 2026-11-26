# FIN-04.1B.2.2B.3.2A — Financial Integration Audit & Automation Core

**HEAD inicial:** `9d012e0` · **HEAD final:** `18218f5`

Resultado: **710 testes passando** (eram 704) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO — núcleo de automação (jobs duráveis/idempotentes) e diagnóstico de cobrança entregues; sincronização autoritativa da obrigação e automação de estoque/compras permanecem para as fases 3.2B/3.2C.**

---

## Gate A1/A2/A3/A4 — Causas-raiz comprovadas (auditoria)

| # | Sintoma | Causa-raiz | Arquivo/ref | Impacto |
|---|---|---|---|---|
| 1 | "Não foi possível criar a cobrança" (15 USDC) | `createChargeApi` chama `/api/payment-intents` (backend) que deriva a obrigação do RAZÃO; a venda/obrigação existe só no Store local (localStorage), nunca sincronizada ao backend → `obligation_not_found` (ou `backend_unavailable` se o backend não está no mesmo origin). A mensagem genérica mascarava a causa. | `server/payments.ts` (createGatewayCharge), `src/lib/payment-api.ts`, `src/components/ChargeModal.tsx` | Bloqueio da cobrança comercial |
| 2 | Compra paga com `stockPosted=false` | `recordPurchase` com `awaitReceipt` cria a compra com `stockPosted=false` e NÃO soma estoque; o estoque só entra em `receiving.ts` no recebimento. O fluxo "pagar pela Treasury e atualizar estoque após confirmação" não propaga a entrada de estoque automaticamente. | `src/lib/store.tsx` (recordPurchase ~L1368), `src/lib/receiving.ts`, `src/lib/accounting/autopost.ts` | Estoque desatualizado |
| 3 | Eventos/lançamentos ausentes no backup | `autoPost` deriva eventos por DIFERENÇA de estado e captura erros silenciosamente (`catch { return next }`) — uma falha de postagem não é persistida como pendência. | `src/lib/accounting/autopost.ts` (L59-68) | Lançamentos ausentes sem rastro |
| 4 | Conciliação automática não ocorre | Não há núcleo durável que propague liquidação verificada → estoque → contabilização. | (ausência) | Efeitos não coordenados |

**Diagnóstico preciso da falha de cobrança:** o servidor NÃO possui a obrigação (`obligation_not_found`) porque o cadastro financeiro é local-first. Corrigir exige sincronização autoritativa mínima (3.2B) — não criar obrigação fictícia. Nesta fase, o erro agora é mapeado e o transporte distingue `backend_unavailable` de erro de negócio.

## Correções implementadas (Gate A5/A6/A2)

### Núcleo de automação financeira (Gate A5/A6) · APROVADO
- `server/automation.ts`: `automationKey` (escopo org+env+origem+operação) + `AutomationJobs` (jobs duráveis).
- Migration v4 (`automation_jobs`): `pending/processing/completed/retryable/requires_review`, `attempts`, `next_retry_at`, `lease_until`, `last_error_code`, UNIQUE `(organization_id, environment, idempotency_key)`.
- `enqueue` idempotente, `claim` atômico com lease (re-claim após expiração), `complete`, `fail` (retryable/requires_review), `listPending`.
- A liquidação financeira permanece a autoridade; o núcleo apenas coordena efeitos comprovadamente ausentes (estoque/contábil/conciliação).

### Diagnóstico de cobrança (Gate A2) · APROVADO (diagnóstico)
- `createChargeApi` distingue `backend_unavailable` (erro de rede) dos erros de negócio.
- `explainPaymentError` mapeia TODOS os motivos (`insufficient_balance`, `obligation_not_found`, `duplicate_conflict`, `unresolved_depositor`, `invalid_amount`/`invalid_currency`, `unauthorized`, `backend_unavailable`) — nunca mais a mensagem genérica sem causa.

## Arquivos

- **Servidor:** `server/db.ts` (migration v4), `server/automation.ts` (novo).
- **Frontend:** `src/lib/payment-api.ts`, `src/components/ChargeModal.tsx`.
- **Testes:** `tests/backend-automation.test.ts` (novo).

## Testes (6 novos)

- `automationKey` estável e isolada por org/ambiente; `enqueue` idempotente; `claim` atômico (sem double-claim); `complete`/`fail` (retryable/requires_review); `listPending`; lease expirado permite re-claim (recuperação).

## Pendências (fases seguintes)

- **3.2B — cobranças/checkout:** sincronização autoritativa da obrigação (Store local → backend) para que `createGatewayCharge` encontre a obrigação; integração completa do checkout.
- **3.2C — compras/estoque:** propagação automática de `stockPosted` após pagamento verificado, usando o núcleo de automação (job `settlement-propagation` → `inventory-posted`), com proteção contra duplicação de estoque.
- **3.2D — contabilidade automática:** eliminar `catch { return next }` silencioso; persistir pendências de postagem.
- **3.2E — conciliação operacional.**
- **3.2F — recuperação histórica.**

## Rollback

`git revert aea731d && git revert e7a104d`
