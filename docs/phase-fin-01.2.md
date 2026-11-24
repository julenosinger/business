# HOTFIX FIN-01.2: Final Accounting Integrity & Sandbox Policy Engine

**HEAD inicial:** `4ab27f2` (HOTFIX FIN-01.1) · **HEAD final:** `113980b`

Resultado: **471 testes passando** (eram 464), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma regressão, nenhuma perda de dados, nenhuma duplicação contábil.

---

## 1. Causas-raiz corrigidas

- **Recuperação incompleta (P1):** `migrateEntryEnvironments` ignorava registros já marcados `unassigned`, nunca reavaliando vínculos confiáveis.
- **Atomicidade das operações contábeis (P2):** `setEntryEnvironment`/`updateEntry`/`removeEntry` validavam contra `data` (memoizado, potencialmente defasado), podendo produzir falso sucesso.
- **Políticas espalhadas (P4):** não havia fonte única de políticas por ambiente; a Testnet não permitia dados fictícios.

## 2. Correções

### FIN-01.2-A — Recuperação histórica e proteção contábil
- `migrateEntryEnvironments` agora **reavalia registros `unassigned`** (e ausentes), recuperando o ambiente por `sourceKind`/`sourceId`; ambíguos permanecem `unassigned`.
- `updateEntry`/`removeEntry`/`setEntryEnvironment` usam `dataRef.current` (estado mais recente) para validação e mutação atômica; `setEntryEnvironment` detecta **evidência conflitante** e retorna o resultado efetivamente aplicado (sem falso sucesso).

### FIN-01.2-C — Environment Policy Engine
Novo `src/lib/environment-policy.ts` — fonte única das políticas:
- `environmentMode` (testnet → `sandbox`; mainnet/desconhecido → `production` restritivo).
- `documentPolicy`, `docAllowedForSubmit` (unificado entre formulário e Store), `docUiStatus`.

### FIN-01.2-D — Formulários flexíveis na Testnet
- `save-transitions.ts` usa `docAllowedForSubmit` (unificado com o ambiente).
- `Contacts.tsx` usa `docUiStatus` + `docAllowedForSubmit`; na Testnet, CPF/CNPJ fictício/incompleto são permitidos com nota discreta "Documento de teste permitido no ambiente Sandbox."
- `EnvironmentBadge` indica "Sandbox — Ambiente de testes" na Testnet.

### FIN-01.2-E — Sandbox Tools
- `clearSandboxData()` remove apenas registros `environment === 'testnet'`, preservando Mainnet, `unassigned`, configurações compartilhadas, tesouraria e o Ledger.
- Seção "Sandbox — Ferramentas de teste" em Configurações (apenas Testnet): dados demonstrativos e limpeza da Testnet, com re-verificação do ambiente e confirmação explícita.

### FIN-01.2-A (classificação)
- Central de lançamentos `unassigned` na Contabilidade sem limite de 6 itens (com rolagem), exibindo origem/motivo, contagem e confirmação individual.

## 3. Arquivos

**Modificados:** `src/lib/save-transitions.ts`, `src/lib/store.tsx`, `src/pages/Accounting.tsx`, `src/pages/Contacts.tsx`, `src/pages/SettingsPage.tsx`, `src/components/form.tsx`, `tests/accounting-environment.test.ts`, `tests/environment-isolation.test.ts`.

**Criados:** `src/lib/environment-policy.ts`, `tests/environment-policy.test.ts`, `docs/phase-fin-01.2.md`.

**Não modificados:** Store/persistência (fora dos pontos listados), `dataRef` (reutilizado), `apply`/`replace`, Undo, `SaveResult`, `autoPost`, Ledger, Tesouraria, Circle Gateway, BatchPay, RPCs, contratos, `ProfileIntent`, Chatbot, AI Agents, Design System. Arc Mainnet `5042` / Testnet `5042002` preservados. Nenhuma transação real executada.

## 4. Segurança preservada

A flexibilização da Testnet **não** afeta: autenticação, autorização, CSRF/CORS, sessões, credenciais, validação de endereços/chainId para transações, confirmação de pagamentos, proteção contra execução duplicada. Carteiras fictícias permanecem apenas dados demonstrativos (sem transferências). Simulações não geram hashes/confirmações on-chain.

## 5. Testes

**Novos (7):**
- `environment-policy.test.ts` (5): modo por ambiente, política de documentos, `docAllowedForSubmit` (Mainnet rigoroso vs Testnet fictício/incompleto, com limite de tamanho), `docUiStatus`.
- `environment-isolation.test.ts` (1): migração reavalia `unassigned` com vínculo.
- `accounting-environment.test.ts` (1): `clearSandboxData` preserva Mainnet/unassigned.

**Suíte completa:** **471 pass, 0 fail** (464 anteriores preservados).

## 6. Limitações e riscos residuais

- O Ledger contábil permanece global por contrato; a limpeza da Testnet não poda o razão (histórico imutável), documentado.
- A flexibilização aplica-se apenas a documentos cadastrais (CPF/CNPJ); demais validações (tipos, tamanho, referências, moedas, débito/crédito) permanecem íntegras em ambos os ambientes.

## 7. Rollback

`git revert <commit da fase>`
