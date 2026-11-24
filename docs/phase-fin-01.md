# Fase HOTFIX FIN-01: Financial Environment Isolation & Accounting Integrity

**HEAD inicial:** `c6fb3da` (Fase UI 2.4.2) · **HEAD final:** `adca94f`

Resultado: **454 testes passando** (eram 446), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma perda de dados, nenhuma alteração indevida de valores contábeis, nenhuma transação real executada.

---

## 1. Causas-raiz

- **`Entry` não registrava ambiente**: o tipo `Entry` não tinha campo `environment`, e nenhum ponto de criação (venda, compra, liquidação, lançamento manual, estorno, recebimento) gravava a rede de origem.
- **Seletores financeiros globais**: `cashBalance`, `kpis`, `expensesByCategory` e `monthlySeries` usavam `data.entries` global; `kpisForEnvironment`/`monthlySeriesForEnvironment` filtravam apenas vendas, mantendo lançamentos globais.
- **Consumidores não isolados**: Dashboard (`cashBalance(data)`), Contabilidade (`kpis`/`expensesByCategory`/`data.sales`/`data.entries`), Assistente (`cashBalance`), Relatórios (`expensesByCategory` + exports) e Compras (`data.entries`).

## 2. Correção estrutural

### Tipo
- `Entry.environment?: Environment` (retrocompatível; `unassigned`/ausente = legado).

### Criação de lançamentos (todos preservam o ambiente de origem)
- Liquidação → `acc.environment ?? 'unassigned'`.
- Lançamento manual → `getNetwork()`.
- Venda (dinheiro) → `getNetwork()`.
- Compra (paga agora) → `getNetwork()`.
- Estorno de venda → `sale.environment ?? 'unassigned'`.
- Recebimento de cobrança sem conta → `getNetwork()`.
- Demo (`loadDemo`) → ambiente selecionado.

### Seletores centralizados
- `entriesForEnvironment`, `cashBalanceForEnvironment`, `kpisForEnvironment` (agora filtra lançamentos), `monthlySeriesForEnvironment` (idem) e `expensesByCategoryForEnvironment`.

### Consumidores corrigidos
- `Dashboard.tsx` → `cashBalanceForEnvironment` + `hasData` isolado.
- `Accounting.tsx` → `useNetwork` + `kpisForEnvironment`/`expensesByCategoryForEnvironment`/`salesForEnvironment`/`entriesForEnvironment`.
- `AssistantPanel.tsx` → `cashBalanceForEnvironment`.
- `Reports.tsx` → `expensesByCategoryForEnvironment` + exports isolados por ambiente.
- `Purchases.tsx` → `entriesForEnvironment` no histórico de compras pagas.

## 3. Tratamento de dados legados

`migrateErpEnvironments` agora classifica lançamentos sem `environment` como `unassigned` (idempotente, não destrutiva). Registros `unassigned` ficam **fora** dos totais isolados (nunca atribuídos a Mainnet/Testnet por padrão, nunca duplicados, nunca excluídos).

## 4. Arquivos

**Modificados:** `src/lib/types.ts`, `src/lib/selectors.ts`, `src/lib/store.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Accounting.tsx`, `src/pages/Reports.tsx`, `src/pages/Purchases.tsx`, `src/components/AssistantPanel.tsx`, `tests/environment-isolation.test.ts`.

**Criados:** `tests/accounting-environment.test.ts`, `docs/phase-fin-01.md`.

**Não modificados:** Store/persistência (fora da criação de lançamentos), `dataRef`, `apply`/`replace`, Undo, `SaveResult`, `autoPost`, Ledger (permanece global), Tesouraria, Circle Gateway, BatchPay, contratos, RPCs, `ProfileIntent`, Chatbot, AI Agents. Arc Mainnet `5042` / Testnet `5042002` preservados.

## 5. Evidência de isolamento (antes/depois)

- **Antes**: Dashboard "Fluxo de caixa do mês" e Contabilidade exibiam 2.400 USDC (Mainnet) também na Testnet.
- **Depois**: Mainnet mostra seus próprios indicadores; Testnet mostra zero quando não há operações próprias, e apenas seus valores quando há (validado por testes de componente e de seletores).

## 6. Testes

**Novos (8):**
- `tests/environment-isolation.test.ts` (+7): `entriesForEnvironment`, `cashBalanceForEnvironment`, `kpisForEnvironment` (Cenário A: Testnet zero; Cenário B: cada rede só os próprios dados), `expensesByCategoryForEnvironment`, migração de entries legadas (unassigned + idempotência).
- `tests/accounting-environment.test.ts` (1): componente React real da Contabilidade — Receita bruta/fluxo refletem apenas o ambiente ativo (Mainnet 1.234 vs Testnet 9.876).

**Suíte completa:** **454 pass, 0 fail** (446 anteriores preservados — nenhum removido ou enfraquecido).

## 7. Limitações e riscos residuais

- Lançamentos legados sem vínculo confiável permanecem `unassigned` (fora dos totais isolados), identificáveis para revisão; nenhuma inferência automática de rede.
- O Ledger contábil continua global por contrato (a correção foca no Livro-Caixa/DRE/indicadores, que são por ambiente).

## 8. Rollback

`git revert <commit da fase>`
