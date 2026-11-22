# Fase 3.2.1: Isolamento do histórico da Tesouraria e integridade da reconciliação

Baseline: `83cc219` (Fase 3.2). Sem regressões: **284 testes passando** (eram 280), typecheck (app + servidor)
limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz e correções

### P0.1 — Histórico isolado por ambiente
- **Causa:** `Treasury.tsx` passava `data.treasuryOps` (sem filtro) para `ActivityTable`, `Analytics` e o contador,
  misturando operações Mainnet e Testnet no histórico.
- **Correção:** novo módulo puro `src/lib/treasury-selectors.ts`:
  - `treasuryOpEnv(op)` classifica pela rede **persistida** (`chain`, depois `destChain`) — nunca pelo estado visual.
  - `treasuryOpsForNetwork(ops, network)` e `requestsForNetwork(requests, network)` filtram por ambiente.
  - `Treasury.tsx` agora usa `visibleOps`/`visibleRequests` no contador, no gráfico e na tabela de atividades.

### P0.2 — Preservação de registros históricos
- Nenhuma transação é apagada/reescrita. Registros legados sem rede identificável → `unknown` (excluídos de ambos os
  históricos, preservados para revisão). Normalização compatível, sem migração destrutiva.

### P0.3 — Reconciliação independente do ambiente visual
- A verificação (`reconcileTreasuryOp`) já usa a rede **persistida** da operação (`op.destChain ?? op.chain`), nunca o
  ambiente do cabeçalho. O depósito Testnet de 1,00 USDC permanece verificado na Testnet, independentemente da rede
  selecionada. Coberto pelos testes de roteamento cross-chain existentes (spend → destino, deposit → origem).

### P1.1/P1.2 — Gráfico e contador
- O gráfico e o contador agora recebem dados filtrados por ambiente.
- O "Sem movimentações no período" é o comportamento **correto** do gráfico: depósitos e transferências para a
  própria carteira são movimentos internos (excluídos por design, conforme o `Hint` do próprio gráfico). Não há
  dupla contagem de transferências internas.

### P1.3 — Isolamento de saldos e redes
- `NetworkBalances` já usa `gatewayChainsFor(network)` (Fase 3.2) e os saldos vêm de `useGatewayBalances`, cuja
  consulta é escopada por `networkType`. Nenhuma rede de ambiente oposto é adicionada.

## 2. Testes (novos)

- `treasuryOpEnv`: classifica pela rede persistida (origem → destino).
- Mainnet mostra só `live`; Testnet só `test`.
- Registro legado (rede desconhecida) não vaza para nenhum ambiente.
- `requestsForNetwork`/`requestEnv` filtram cobranças por `chainKey`.

Suíte completa: **284 pass, 0 fail**.

## 3. Status (honesto)

| Item | Status |
| --- | --- |
| Histórico isolado por ambiente (P0.1) | IMPLEMENTADO · TESTADO |
| Preservação de registros (P0.2) | IMPLEMENTADO (sem migração destrutiva) |
| Reconciliação na rede original (P0.3) | JÁ CORRETO · TESTADO (roteamento cross-chain) |
| Gráfico/contador consistentes (P1.1/P1.2) | IMPLEMENTADO |
| Isolamento de saldos (P1.3) | JÁ CORRETO (Fase 3.2) |

## 4. Riscos residuais

- Registros legados com `chain` desconhecida ficam ocultos do histórico (não exibidos em Mainnet nem Testnet) até
  revisão manual; não há UI dedicada para reclassificá-los nesta fase.
- O `RequestsCard` (lista de cobranças) continua exibindo todas as cobranças (não é "histórico de operações");
  apenas o gráfico e o histórico de operações são isolados por ambiente.

## 5. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 3.2.1 (dados não são afetados de forma destrutiva).
