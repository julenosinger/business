# Fase 3.2.3.1: Isolamento real da fila de pagamentos e gerenciamento em lote seguro

Baseline: `4247623` (Fase 3.2.3). Sem regressões: **289 testes passando** (eram 288), typecheck (app + servidor)
limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz e correções

### P0.1 — Isolamento real da fila (causa-raiz: `env === null`)
- **Causa:** o filtro `env === null || env === wantedEnv` deixava qualquer obrigação SEM intenção em processamento
  aparecer nos DOIS ambientes.
- **Correção (modelo de preparação explícita):**
  - `Account.paymentNetwork` (opcional) registra o ambiente escolhido EXPLICITAMENTE para pagar.
  - Novo `paymentQueueState(account, network)`: `prepared` (executável no ambiente atual) / `unprepared` (sem rede)
    / `other_env` (preparada para o outro ambiente).
  - A fila executável mostra **somente** `prepared` do ambiente atual; `unprepared` aparece em uma seção separada
    "Não preparadas para pagamento" (sem seleção em lote, apenas botão **Preparar**); `other_env` fica oculta.
  - `preparePayment(id, network)` persiste a escolha; o `TreasuryModal` também a persiste ao enviar um pagamento.
  - Obrigações não preparadas permanecem em Contas a pagar e receber (não são executáveis automaticamente).

### P0.2 — Elegibilidade centralizada na fila
- "Selecionar todas" inclui apenas contas elegíveis (não `busy`); o botão **Pagar** fica desabilitado para contas em
  processamento; seleções incompatíveis são revalidadas.

### P0.3/P0.4 — Exclusão individual e em lote (cancelamento lógico)
- `cancelAccount(id)` faz **cancelamento lógico** (`canceledAt`, auditável e reversível com Desfazer), com validação:
  só obrigações **manuais**, sem liquidações, sem intenção ativa. Obrigações de compra/folha e pagamentos
  pendentes/confirmados são bloqueados (com mensagem clara).
- UI: botão de cancelar por item (com confirmação de descrição/valor) e **Excluir N** em lote (com confirmação).
- `Finance.tsx` filtra `canceledAt` (obrigações canceladas saem das listas em aberto, preservadas no armazenamento).

## 2. Testes (novos)

- `paymentQueueState`: preparada/outro ambiente/não preparada.
- (preservados) `inFlightIntentEnv`, isolamento de operações e cobranças.

Suíte completa: **289 pass, 0 fail**.

## 3. Status (honesto)

| Item | Status |
| --- | --- |
| Isolamento real da fila (P0.1) | IMPLEMENTADO · TESTADO |
| Elegibilidade (P0.2) | IMPLEMENTADO |
| Exclusão individual (P0.3) | IMPLEMENTADO (cancelamento lógico) |
| Exclusão em lote (P0.4) | IMPLEMENTADO (com validação por item) |
| Exclusividade entre dispositivos | **BLOCKED** (backend transacional) |

## 4. Riscos residuais / dependências

- Exclusão/cancelamento é lógico (localStorage); exclusividade durável entre dispositivos exige o backend.
- Obrigações `unknown`/`invalid_environment` seguem preservadas e fora da fila executável (revisão manual).

## 5. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 3.2.3.1 (dados não são afetados de forma destrutiva; `canceledAt` é
  reversível via Desfazer).
