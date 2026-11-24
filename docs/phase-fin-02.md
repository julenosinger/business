# FIN-02: Accounting Environment Partition & Sandbox Independence

**HEAD inicial:** `24fb30e` (HOTFIX FIN-01.3) · **HEAD final:** `(commit desta fase)`

Resultado: **478 testes passando** (eram 475), typecheck (app + servidor) limpo, lint limpo, build de produção OK.

---

## Subfases concluídas

### FIN-02.1 — Proteção de operações destrutivas (P1)
- Removido o botão "Carregar demonstração" (destrutivo, `loadDemo`) de Configurações — a demo agora é exclusiva do Sandbox via `loadSandboxDemo()`.
- "Apagar tudo" (`resetAll`) exige **backup automático + confirmação reforçada em duas etapas**.
- Ferramentas Sandbox nunca chamam `loadDemo`/`resetAll`.

### FIN-02.2 — Fundação do ambiente no Ledger (P2/P3)
- `environment?: Environment` adicionado a `EventDraft`, `FinancialEvent` (via herança), `JournalEntry` e `AccountingPeriod`.
- Propagação: `buildEntry` copia `event.environment` para a partida; `reverseEntry` preserva o ambiente da partida original; `cashBookEvent`/`saleEvent`/`purchaseEvent`/obrigações/liquidações/tesouraria propagam o ambiente da origem.
- `migrateLedgerEnvironments`: classifica eventos/partidas legados por vínculo inequívoco (`accountId`/`saleId`/`purchaseId`/`cashEntryId` no payload e `chain` comprovada — `Arc`→Mainnet, `Arc_Testnet`→Testnet). Ambíguos permanecem sem ambiente. Idempotente e não destrutiva. Integrada à cadeia de migração (última etapa).

### FIN-02.3 — Períodos contábeis independentes (P4)
- `isDateClosed(ledger, date, environment?)`: Testnet verifica apenas períodos Testnet; Mainnet/legado verificam períodos Mainnet **e** legados (conservador).
- `closePeriod`/`reopenPeriod`/`setPeriodReview` passam a receber `environment`; o Store usa `getNetwork()`.
- Fechar um período Mainnet não bloqueia Testnet e vice-versa (testado).

### FIN-02.4 — Integridade das mutações (P6, parcial)
- `addEntry`/`updateEntry`/`removeEntry` usam `dataRef.current` e passam o ambiente ao `isDateClosed`.

## Arquivos

**Modificados:** `src/lib/accounting/types.ts`, `src/lib/accounting/engine.ts`, `src/lib/accounting/adapters.ts`, `src/lib/accounting/autopost.ts`, `src/lib/store.tsx`, `src/pages/SettingsPage.tsx`, `tests/accounting-periods.test.ts`.

**Criados:** `tests/ledger-environment.test.ts`, `docs/phase-fin-02.md`.

**Não modificados:** Store/persistência (fora dos pontos listados), `dataRef` (reutilizado), `apply`/`replace`, Undo, `EntryResult`/`SaveResult`, Tesouraria, Circle Gateway, BatchPay, RPCs, contratos, `ProfileIntent`, Chatbot, AI Agents, Design System. Arc Mainnet `5042` / Testnet `5042002` preservados. Nenhuma transação real executada.

## Testes

**Novos (3):** migração do ambiente contábil (classificação por vínculo + ambíguo permanece + idempotência) e independência dos períodos.

**Suíte completa:** **478 pass, 0 fail** (475 anteriores preservados; `accounting-periods.test.ts` atualizado para a nova assinatura com ambiente, sem redução de cobertura).

## Pendências (subfases seguintes)

- **FIN-02.5 (P5/P11):** isolar as visualizações `GeneralLedgerTab`, `ReconciliationTab`, `PeriodsTab`, balancetes e exportações — ainda apresentam o razão global; devem filtrar por ambiente (eventos/partidas/períodos).
- **FIN-02.6 (P7/P8/P9/P10):** expansão final do policy engine, gerenciamento de cenários demonstrativos, reset com integridade referencial total e ciclo de vida de formulários por ambiente.

## Limitações e riscos residuais

- O razão físico continua compartilhado, mas agora **logicamente particionado** por `environment` (eventos, partidas e períodos). A aplicação dos filtros nas abas de visualização é a próxima etapa.
- A migração classifica apenas eventos com evidência inequívoca; eventos ambíguos permanecem sem ambiente (revisão).

## Rollback

`git revert <commit da fase>`
