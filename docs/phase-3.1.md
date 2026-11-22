# Fase 3.1: Endurecimento da segurança de liquidação e ativação segura do backend

Baseline: `568a5df` (Fase 3.0). Sem regressões: **276 testes passando** (eram 270), typecheck (app + servidor)
limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz e correções

### P0.1 — Reutilização de evidência on-chain
- **Antes:** unicidade de `settlements` era `(org_id, op_id)`; a mesma transferência podia liquidar duas operações.
- **Agora:** índice UNIQUE na identidade canônica da transferência `(org_id, chain_id, tx_hash, transfer_to,
  amount_minor)`. `settleOperation` rejeita com `evidence_reused` se a mesma evidência for usada em outro `opId`,
  sem bloquear transferências distintas legítimas (destinatário/valor diferentes na mesma transação).

### P0.2 — Vínculo do pagamento à intenção
- Destinatário agora é **obrigatório** (recusa `recipient` ausente com `unverified`); a evidência verificada
  server-side (`expectedTo` + valor) é comparada com a intenção antes de liquidar.

### P0.3 — Migração real do schema da Fase 2.9/3.0
- `repairLegacySettlements()` detecta a versão real do schema e migra incrementalmente (rename → create novo →
  copiar dados → drop do legado), preservando registros históricos, sem `DROP TABLE` destrutivo e com transação.

### P1.1 — Idempotência com detecção de conflito
- Retry idêntico (mesmo `opId` + mesma evidência) → retorna o **resultado original** (`entryId`, `allocatedMinor`,
  `excessMinor`), nunca zeros fictícios.
- Mesmo `opId` com payload diferente → `duplicate_conflict`.
- Mesma evidência com outro `opId` → `evidence_reused`.

### P1.2 — Saldo contábil e estornos
- `obligationOutstandingMinor` e `settlementTypeOf` agora consideram estornos/reversões (`isReversed`), reusando as
  regras do motor (não há segunda implementação divergente). Teste: estornar uma liquidação restaura o saldo.

### P1.3/P1.5/P1.6 — Migração de dados, integração e finalidade
- Migração (`migrate.ts`) preservada e testada (idempotente por organização).
- Integração frontend→backend e autenticação de sessão: **preparadas, não ativadas** (ver status abaixo).
- Finalidade do Gateway: estados mantidos separados; transferência para GatewayWallet não é confirmação automática
  de crédito disponível.

## 2. Testes (novos)

- Replay da mesma evidência com outro `opId` → `evidence_reused`.
- Retry idêntico retorna resultado original; payload divergente → `duplicate_conflict`.
- Destinatário ausente → não liquida.
- Parcial (300) + final (700) completam a obrigação.
- Estorno de liquidação restaura o saldo.
- Migração de banco legado (fase 2.9) preservando dados.

Suíte completa: **276 pass, 0 fail**.

## 3. Status por item (honesto)

| Item | Status |
| --- | --- |
| Reutilização de evidência (P0.1) | IMPLEMENTADO · TESTADO |
| Intenção/validação (P0.2) | IMPLEMENTADO · TESTADO |
| Migração de schema (P0.3) | IMPLEMENTADO · TESTADO |
| Conflito de idempotência (P1.1) | IMPLEMENTADO · TESTADO |
| Estornos/saldos (P1.2) | IMPLEMENTADO · TESTADO |
| Migração segura de dados (P1.3) | IMPLEMENTADO · TESTADO |
| Sessão segura no navegador (P1.4) | **BLOQUEADO (infraestrutura)** |
| Integração frontend→backend (P1.5) | **INTEGRAÇÃO PENDENTE** (transportes prontos; store ainda local) |
| Finalidade Gateway (P1.6) | PARCIAL (estados separados; `transferId` aguarda API oficial) |
| Backend em produção | **BLOQUEADO (provisionamento)** |

## 4. Dependências externas restantes

- Provisionamento do banco/servidor (credenciais de deploy).
- Mecanismo seguro de sessão/proxy (HttpOnly/Secure/SameSite ou proxy autenticado) — não expor o Bearer token.
- API/SDK oficial de status por `transferId` (finalidade de crédito do Gateway).

## 5. Implantação e rollback

- Backend local: `GBOS_API_TOKEN=... GBOS_DB_PATH=/data/gbos.sqlite bun run server`.
- App: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 3.1 (aditivo; dados locais intactos).

## 6. Riscos residuais

- O frontend ainda persiste em `localStorage`; a ativação remota depende de provisionamento + sessão segura.
- A migração de schema usa `ALTER TABLE ... RENAME` + `DROP TABLE` do legado **somente após** copiar os dados
  (procedimento seguro, testado). Backup recomendado antes da ativação em produção.

## Próxima fase recomendada

1. Provisionar backend + sessão segura; ativar o modo remoto e migrar o razão com preview/aprovação.
2. Conectar `verifyAndSettle`/`reconcileAccounting` ao `backend.settle` (sem fallback silencioso para local).
3. Integrar status de crédito do Gateway via `transferId`.
