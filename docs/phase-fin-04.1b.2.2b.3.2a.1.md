# FIN-04.1B.2.2B.3.2A.1 — Automation Core Integrity & Recovery Hardening

**HEAD inicial:** `8d6e39f` · **HEAD final:** `aab7b71`

Resultado: **718 testes passando** (eram 710) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: APROVADO — fencing de lease, idempotência concorrente, transições protegidas, backoff, recuperação e proteção contra efeitos duplicados implementados e testados com SQLite real.**

---

## Causas-raiz corrigidas

| # | Vulnerabilidade | Correção |
|---|---|---|
| 1 | `complete`/`fail` sem verificação de proprietário | fencing via `workerId` + `leaseVersion` monotônica + `leaseUntil` |
| 2 | `claim` sem escopo/workerId/maxAttempts/next_retry_at | `claim(scope, jobId, workerId, leaseMs, maxAttempts)` completo |
| 3 | `enqueue` SELECT+INSERT (janela de corrida) | `INSERT ... ON CONFLICT DO NOTHING` |
| 4 | Retry infinito sem backoff | `calculateBackoff` exponencial limitado + `attempt_limit_reached` → `requires_review` |
| 5 | Jobs interrompidos abandonados | `listEligible` + `sweepExhausted` (lease expirado / limite atingido) |
| 6 | Efeitos financeiros sem identidade persistente | `automation_effects` (UNIQUE por org+env+effect_key) |

## Implementação (server/automation.ts)

- **Migration v5** (`worker_id`, `lease_version`, índices `idx_automation_retry`/`idx_automation_lease`) e **v6** (`automation_effects`) — não destrutivas, preservam jobs existentes.
- `claim` atômico em transação (UPDATE + SELECT), com escopo, workerId, `leaseMs`, `maxAttempts`, respeito a `next_retry_at` e lease expirado.
- `complete`/`fail` protegidos por fencing (worker + versão + lease válido). `fail` com `maxAttempts` migra exaustos para `requires_review`.
- `renewLease` com validação de proprietário e versão.
- `listEligible` descobre pending/retryable/hora-chegada/processing-lease-expirado; `sweepExhausted` migra jobs no limite.
- `AutomationEffects.record`/`has` (idempotência dos efeitos via `ON CONFLICT`).

## Arquivos

- **Servidor:** `server/db.ts` (migrations v5/v6), `server/automation.ts`.
- **Testes:** `tests/backend-automation.test.ts` (14 testes).

## Testes (14)

- Chaves estáveis/isoladas; `enqueue` concorrente; efeitos idempotentes; fencing (worker/versão/lease); `complete`/`fail` por worker obsoleto; lease expirado; `renewLease`; backoff; `listEligible`; `sweepExhausted`; `calculateBackoff`; `classifyAutomationFailure`; persistência + reabertura do banco (arquivo).

## Pendências (fases seguintes)

- **Worker funcional em runtime (Gate H):** o núcleo expõe os primitivos duráveis; o consumidor real ligado à liquidação será integrado nas fases 3.2C/3.2D (não há efeitos de estoque/contábil prontos para consumir nesta fase).
- **Integração transacional com liquidação (Gate I):** a gravação atômica de liquidação + enqueue será feita ao conectar o núcleo ao fluxo de pagamento (3.2B/3.2C).
- **Recuperação histórica do cenário real:** a classificação `requires_review` para entradas manuais ambíguas de estoque será aplicada em 3.2C (não executar recuperação em massa agora).

## Rollback

`git revert da6b5ec && git revert 01a13b7` (migrations v5/v6 são aditivas e não destrutivas; dados preservados)
