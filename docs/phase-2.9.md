# Fase 2.9: Núcleo financeiro transacional e finalidade do Gateway

Baseline: `b45bc3c` (Fase 2.8). Sem regressões: **265 testes passando** (eram 256), typecheck (app + servidor) limpo,
lint limpo, build de produção OK.

**Objetivo: backend transacional real, eliminar a liquidação contábil falsa e usar aritmética monetária exata.**

---

## 1. P0 — Correção da liquidação contábil falsa

`applyConfirmedAccounting()` marcava `accountingStatus: 'settled'` quando a conta não existia ou já estava paga.
Corrigido:

- **Obrigação ausente** → `requires_review` + `obligation_missing` (nunca fabrica liquidação).
- **Obrigação já paga** → `requires_review` + `already_settled` + valor total preservado como `unallocatedAmount`
  (não baixa de novo).
- **Período fechado** → segue as regras existentes do motor (estorno/ajuste autorizado; nunca bypass).
- Só vira `settled` após uma posta válida e auditável.

## 2. P0 — Tratamento de excesso de pagamento

Excesso (pagamento > saldo em aberto) agora é tratado de forma controlada:

- Aloca `min(verificado, saldo)` e preserva o **excesso** como `unallocatedAmount` + `accountingStatus: requires_review`
  + `reviewReason: excess_unallocated` (saldo financeiro distinto e auditável; nunca descartado silenciosamente).
- Nenhum tratamento (crédito ao cliente, adiantamento ao fornecedor, reembolso, realocação) é escolhido sem evidência;
  a resolução é do dono, via fluxos existentes. Excesso nunca é alocado duas vezes.

## 3. P1 — Aritmética monetária exata (unidades menores)

- `allocationMinor` e `planAllocationMinor` operam em `bigint` (unidades menores), sem float.
- `accountOutstandingMinor` calcula o saldo em aberto em unidades menores (moeda da conta).
- O plano de alocação usa bigint; a conversão para `number` ocorre apenas na fronteira de armazenamento/exibição
  (`toDisplayNumber`), preservando os campos históricos (`Account.amount`).

## 4. Backend transacional real (entrega central)

**STATUS: IMPLEMENTADO LOCALMENTE · TESTADO · DEPLOYED/VERIFIED = BLOQUEADO (provisionamento externo).**

- `server/db.ts` — SQLite (`bun:sqlite`, embutido no Bun, sem custo de infra): tabelas `orgs`, `events` (UNIQUE
  org+idempotency_key), `settlements` (UNIQUE org+settlement_id), `audit` (append-only).
- `server/api.ts` — autenticação de dono único (Bearer token), validação server-side reusando o motor (`postEvent`),
  posta atômica em transação SQLite (tudo ou nada; falha deixa o estado anterior intacto).
- `server/index.ts` — servidor HTTP (`Bun.serve`): `GET /api/ledger`, `POST /api/ledger/events`,
  `POST /api/ledger/settlements`. Configuração por env (`GBOS_API_TOKEN`, `GBOS_ORG_ID`, `GBOS_DB_PATH`, `PORT`).
- O cliente NUNCA é confiado para `actor`, `orgId`, valores ou status; o servidor impõe ator do dono e `orgId`.
- Testes de integração contra SQLite real (em memória): auth, persistência atômica, idempotência (mesma chave não
  duplica), constraint UNIQUE de liquidação, rollback, isolamento por organização.
- Scripts: `bun run server`, `bun run typecheck:server`; types via `@types/bun` + `tsconfig.server.json`.

**Não declarado como produção:** não há banco/credenciais provisionados. A persistência do app segue `localStorage`
(a migração — seção 8 — fica pendente do provisionamento).

## 5. Idempotência durável

- Constraint UNIQUE (org+idempotency_key, org+settlement_id) no banco; transações SQLite atômicas com rollback.
- Reprocessamento de evento usa UPSERT (mesmo evento, mesmo status atual).
- Frontend `inflight` permanece como otimização — não é a fonte da correção financeira.

## 6. Finalidade do Gateway

- Depósito: `expectedFrom = carteira` + `expectedTo = GatewayWallet` + valor exato (a transferência sozinha não prova
  crédito spendable).
- Pagamento: verificação na cadeia de **destino** (`expectedTo = destinatário`).
- Sem evidência de crédito/finalidade do provedor, permanece `pending`/`requires_review`. Um recibo com sucesso não é
  tratado como finalidade irreversível sem política de confirmações.

## 7. Testes (novos)

- Backend (6): auth, persistência atômica, idempotência, constraint de liquidação, rollback, isolamento por org.
- Aritmética exata (4): `planAllocationMinor` bigint, `allocationMinor` 6 casas, precisão de grandes valores.
- Suíte completa: **265 pass, 0 fail**.

## Status por item (honesto)

| Item | Status |
| --- | --- |
| Correção de liquidação falsa | IMPLEMENTADO · TESTADO |
| Excesso de pagamento | IMPLEMENTADO · TESTADO |
| Aritmética exata | IMPLEMENTADO · TESTADO |
| Backend transacional | IMPLEMENTADO LOCALMENTE · TESTADO (SQLite real) |
| Deploy/verificação em produção do backend | **BLOQUEADO (provisionamento externo)** |
| Migração localStorage → backend | PENDENTE (depende do provisionamento) |

## Dependências externas restantes

- Provisionamento do banco/servidor (credenciais de deploy) para ativar o backend em produção.
- Credenciais/contratos Mainnet da Circle no ambiente de deploy (validação externa).

## Implantação e rollback

- App: `bun install && bun run build`.
- Backend (local): `GBOS_API_TOKEN=... GBOS_DB_PATH=/data/gbos.sqlite bun run server`.
- Rollback: `git revert` dos commits da fase 2.9 (dados seguem no `localStorage`; backend é aditivo).

## Próxima fase recomendada

1. Provisionar o banco e ativar o backend; migrar o razão com backup/preview/aprovação (seção 8).
2. Conectar `verifyAndSettle`/`reconcileAccounting` à persistência durável (postar eventos/liquidações via API).
3. Persistir/consultar `transferId` como evidência adicional de crédito/finalidade no Gateway.
