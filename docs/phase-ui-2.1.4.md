# Fase UI 2.1.4: Store Integration & Regression Certification

**HEAD inicial:** `55d8759` (Fase UI 2.1.3) · **HEAD final:** `(commit desta fase)`

Resultado: **366 testes passando** (eram 353), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma alteração visual.

---

## 1. Auditoria e defeito comprovado

### P1 — Commit autoritativo certificado
- Confirmado que **nenhuma** mutação contorna `dataRef.current`: `setData` é chamado apenas dentro de `apply`/`replace`, que atualizam o snapshot sincronizado e o React juntos.
- As operações de cadastro avaliam a transição **uma vez** contra `dataRef.current` e gravam via `replace(nextState)` — `SaveResult.ok`/`id` correspondem à mutação aceita.

### P2 — Undo sem perda de alterações posteriores (corrigido)
- **Defeito:** `undoable` capturava um snapshot completo e `replace(snapshot)` no Desfazer restaurava tudo indiscriminadamente — uma alteração posterior (independente) desaparecia silenciosamente.
- **Correção:** o Desfazer agora verifica se houve alteração posterior (`dataRef.current !== after`). Se houve, **bloqueia** o Undo e informa o motivo, preservando as alterações posteriores. Sem alterações posteriores, restaura o snapshot normalmente (comportamento original preservado).

### P3/P4 — Logística e contabilidade auditadas
- `runShipmentOp` pré-valida e reaplica via `apply` (já sobre `dataRef.current`); resultados consistentes, sem duplicação de recebimentos/estoque.
- Livro-Caixa, razão, contas, vendas, compras, folha e tesouraria passam por `apply`/`replace`/`runLedger`, todos sincronizando `dataRef.current`. Sem lançamentos duplicados nem perda de atualizações intercaladas.

### P5 — Persistência
- `localStorage` gravado no `useEffect` sobre `data`; substituições (`importData`/`loadDemo`/`resetAll`) usam `replace`, mantendo snapshot e React sincronizados.

## 2. Testes reais de integração React (P6)

Adicionado `happy-dom` + `@happy-dom/global-registrator` (devDependencies) e dois novos arquivos de teste que **montam o `StoreProvider` real** com `react-dom/client` + `act`:

- `tests/store-integration.test.ts` (11 testes): montagem, IDs corretos de contato/funcionário, submissões rápidas no mesmo tick, rejeição de duplicidade, `wrong_environment`, `not_found`, `invalid_document`, preservação de id/ambiente, atualizações intercaladas entre módulos, isolamento Mainnet/Testnet e persistência em `localStorage`.
- `tests/store-undo.test.ts` (2 testes, com mock de `sonner`): Undo funciona sem alteração posterior; Undo é bloqueado após alteração posterior (preserva os dados novos).

## 3. Arquivos

**Modificados:** `src/lib/store.tsx`, `package.json`, `bun.lock`.
**Criados:** `tests/store-integration.test.ts`, `tests/store-undo.test.ts`, `docs/phase-ui-2.1.4.md`.

## 4. Resultados

- Suíte completa: **366 pass, 0 fail** (353 anteriores + 13 novos; nenhuma regressão).
- typecheck app/servidor, lint e build: limpos.

## 5. Garantias e limitações

- `SaveResult.ok`/`id` refletem a aceitação no estado local autoritativo.
- Persistência é `localStorage` (via `useEffect`); **sem** confirmação síncrona de durabilidade nem exclusividade entre dispositivos (backend transacional não implantado).
- Undo bloqueia (com motivo) quando há alterações posteriores; **merge** que preserva alterações independentes ainda não é implementado (documentado como limitação, não como perda de dados).

## 6. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
