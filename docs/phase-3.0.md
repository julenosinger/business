# Fase 3.0: Integração do backend, atomicidade financeira e integridade de dados

Baseline: `b6c6458` (Fase 2.9). Sem regressões: **270 testes passando** (eram 265), typecheck (app + servidor)
limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz e correções

### P0.2/P0.3/P0.4 — Liquidação financeira atômica e autoritativa no servidor
- **Antes:** `recordSettlement()` gravava a liquidação isoladamente, sem atualizar razão/obrigação na mesma
  transação; a idempotência dependia de um `settlementId` enviado pelo cliente.
- **Agora (`server/settle.ts`):** `settleOperation` roda em UMA transação SQLite:
  1. Verifica a evidência on-chain server-side (`verifyUsdcReceipt`: rede, contrato, token, destinatário, valor).
  2. Deriva a obrigação (valor + moeda) e o saldo em aberto **DO RAZÃO** (nunca do cliente).
  3. Calcula a alocação em unidades menores (bigint), respeitando FX registrado e moeda da obrigação.
  4. Posta o evento de liquidação (`payable.settled`/`receivable.settled`/`payroll.paid`) via motor.
  5. Registra a liquidação (UNIQUE `org+op_id`), a auditoria e o razão — tudo atômico.
- Depósitos não liquidam obrigações (só `spend` ligado a `accountId`).
- `period_closed` é respeitado (regra do motor); ausência de FX/moeda/obrigação gera revisão, nunca liquidação fabricada.

### P0.3 — Idempotência durável por identidade da operação
- Tabela `settlements` com UNIQUE `(org_id, op_id)`: uma operação = uma liquidação (parciais legítimas de
  obrigações diferentes são operações diferentes). Retry retorna `duplicate: true`; payload divergente vira
  conflito, nunca duplicação. Constraints SQL + transações (não `Set` em memória).

### P1.2 — SQLite persistente e resiliente
- `busy_timeout = 5000` (contenção entre processos), `journal_mode = WAL` (durabilidade), migrações versionadas e
  repetíveis (`schema_migrations`).
- `server/index.ts` exige `GBOS_DB_PATH` persistente (recusa `:memory:` salvo com `GBOS_ALLOW_MEMORY=1` para dev).
- Credenciais só no servidor (env), nunca em `VITE_*`/bundle/armazenamento do navegador.

### P1.3 — Migração segura do localStorage
- `server/migrate.ts`: `previewLedger` (contagens) e `importLedger` (idempotente por organização; recusa sobrescrever
  sem `force`). Nunca apaga a origem; nunca adivinha moedas/redes.

### P0.1 — Camada de acesso a dados
- `src/lib/accounting/backend.ts` ganhou o método `settle` (transporte `fetch` para `POST /api/ledger/settle`) com
  `SettleRequest`/`SettleResponse` tipados, além de `postEvent`/`fetch` já existentes.

---

## 2. Fluxo financeiro (antes → depois)

**Antes:** wallet → SDK (spend) → `addTreasuryOp` (localStorage) → verificação no cliente (`verifyAndSettle`) →
alocação + `settle` no `localStorage` (razão local).

**Depois (com backend provisionado):** wallet → SDK (spend) → `addTreasuryOp` (local, pendente) → verificação on-chain
→ `POST /api/ledger/settle` → servidor verifica/deriva/aloca/posa/liquida **atomicamente** em SQLite → frontend
reconcilia o razão do servidor.

---

## 3. Status por item (honesto)

| Item | Status |
| --- | --- |
| Liquidação atômica server-side | IMPLEMENTADO · TESTADO (SQLite real) |
| Idempotência durável por `op_id` | IMPLEMENTADO · TESTADO |
| Validação server-side (sem confiança no cliente) | IMPLEMENTADO · TESTADO |
| SQLite resiliente (WAL/busy_timeout/migrations) | IMPLEMENTADO · TESTADO |
| Migração segura (preview + idempotente) | IMPLEMENTADO · TESTADO |
| Camada de acesso a dados (settle no cliente) | IMPLEMENTADO (transporte) · TESTADO |
| **Frontend usando o backend de fato** | **INTEGRAÇÃO PENDENTE** (o store ainda usa `localStorage`; o transporte está pronto) |
| **Backend em produção** | **BLOQUEADO (provisionamento/credenciais externas)** |

## 4. Testes

- Backend (11): auth, persistência atômica, idempotência de evento, rollback, isolamento por org, liquidação parcial
  (300/1000), idempotência de liquidação, evidência não confirmada, obrigação inexistente, excesso (1300/1000),
  migração idempotente.
- Suíte completa: **270 pass, 0 fail**. Typecheck (app+server), lint, build aprovados.

## 5. Dependências externas restantes

- Provisionamento do banco/servidor (credenciais de deploy) para ativar o backend em produção.
- Mecanismo seguro de sessão/proxy para o navegador (não expor o Bearer token do servidor ao cliente) — a definir
  conforme a infraestrutura disponível.
- Integração da confirmação de crédito do Gateway via `transferId` (camada adicional).

## 6. Implantação e rollback

- Backend (local): `GBOS_API_TOKEN=... GBOS_DB_PATH=/data/gbos.sqlite bun run server`.
- App: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 3.0 (backend é aditivo; dados locais intactos).

## 7. Riscos residuais

- O frontend ainda persiste em `localStorage` (a integração frontend→backend é a próxima etapa, gated em
  provisionamento). Sem fallback silencioso após falha remota.
- Sem implantação verificada, o backend permanece "local/testado", não "produção".

## Próxima fase recomendada

1. Provisionar o backend e ativar o modo remoto; migrar o razão com preview/aprovação (seção P1.3).
2. Conectar o store (`verifyAndSettle`/`reconcileAccounting`) ao `backend.settle`, reconciliando o razão local.
3. Mecanismo de sessão/proxy seguro para o navegador.
