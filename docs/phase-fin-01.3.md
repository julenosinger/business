# HOTFIX FIN-01.3: Sandbox Safety, Environment Isolation & Accounting Integrity

**HEAD inicial:** `b331607` (HOTFIX FIN-01.2) · **HEAD final:** `(commit desta fase)`

Resultado: **475 testes passando** (eram 471), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma regressão, nenhuma perda de dados, nenhuma duplicação contábil.

---

## 1. Causas-raiz corrigidas

- **CRÍTICO — `loadDemo()` destrutivo (P1):** o botão Sandbox chamava `loadDemo()`, que faz `{ ...demo, ... }` e substitui TODO o `AppData` — apagando Mainnet, `unassigned`, tesouraria, configurando o nome da empresa e reinicializando o Ledger.
- **Falso sucesso na Contabilidade (P7):** `addEntry()`/`updateEntry()`/`removeEntry()` retornavam `void`; o `EntryModal` fechava independentemente do resultado, sem sinalizar falha.

## 2. Correções

### FIN-01.3-A — `loadSandboxDemo()` seguro
- Novo `buildDemoData(currency, prefix)` — prefixo de IDs por chamada (evita colisões entre cargas consecutivas).
- `loadSandboxDemo()`: verifica `getNetwork() === 'testnet'`, usa `dataRef.current`, e **adiciona** os dados demonstrativos somente à Testnet (com `environment: 'testnet'`), preservando integralmente Mainnet, `unassigned`, configurações compartilhadas (nome da empresa) e o Ledger/tesouraria.
- O botão Sandbox em Configurações agora chama `loadSandboxDemo()` (não mais `loadDemo()`).

### FIN-01.3-D — Resultados explícitos na contabilidade
- `addEntry`/`updateEntry`/`removeEntry` retornam `EntryResult` (`{ ok: true } | { ok: false; reason }`).
- `updateEntry`/`removeEntry` validam contra `dataRef.current`, bloqueiam ambiente diferente (`wrong_environment`), mudança de ambiente por patch (`env_immutable`) e período fechado (`period_closed`), retornando o motivo.
- `EntryModal` fecha **somente após sucesso confirmado**; em falha, preserva os dados digitados (a mensagem já é exibida pelo Store).

## 3. Arquivos

**Modificados:** `src/lib/demo.ts`, `src/lib/store.tsx`, `src/pages/Accounting.tsx`, `src/pages/SettingsPage.tsx`, `tests/accounting-environment.test.ts`.

**Criados:** `docs/phase-fin-01.3.md`.

**Não modificados:** Store/persistência (fora dos pontos listados), `dataRef` (reutilizado), `apply`/`replace`, Undo, `SaveResult`, `autoPost`, Ledger (preservado), Tesouraria, Circle Gateway, BatchPay, RPCs, contratos, `ProfileIntent`, Chatbot, AI Agents, Design System. Arc Mainnet `5042` / Testnet `5042002` preservados. Nenhuma transação real executada.

## 4. Evidência de preservação da Mainnet

Testes confirmam que `loadSandboxDemo()` e `clearSandboxData()`:
- preservam contatos/lançamentos Mainnet e `unassigned`;
- preservam o nome da empresa (configuração compartilhada);
- adicionam/removem somente registros `environment === 'testnet'`.

## 5. Testes

**Novos (4):** `loadSandboxDemo` adiciona só à Testnet preservando Mainnet/configurações; bloqueado na Mainnet; IDs únicos entre chamadas consecutivas; resultados explícitos de `addEntry`/`updateEntry`/`removeEntry`.

**Suíte completa:** **475 pass, 0 fail** (471 anteriores preservados).

## 6. Limitações e riscos residuais

- **Ledger global (P5/P6):** o razão contábil permanece compartilhado por contrato; a limpeza/carga da Testnet não poda nem reconstrói o razão (histórico imutável). Isolamento lógico completo do razão exigiria adicionar `environment` aos eventos contábeis — fora do escopo deste hotfix e documentado como pendência arquitetural.
- `loadSandboxDemo` adiciona lançamentos ao Livro-Caixa (DRE) sem sincronizá-los ao razão (usa `auto: false`), preservando o histórico contábil global.

## 7. Rollback

`git revert <commit da fase>`
