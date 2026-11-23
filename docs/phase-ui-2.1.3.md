# Fase UI 2.1.3: Authoritative Commit & Save Integrity

**HEAD inicial:** `5db639d` (Fase UI 2.1.2) · **HEAD final:** `(commit desta fase)`

Resultado: **353 testes passando** (eram 351), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma alteração visual.

---

## 1. Causa-raiz

O store executava a transição duas vezes: uma sobre o snapshot (`data`) para produzir o resultado, e outra dentro de `setData(updater)` para gravar. Como `addContactTransition`/`addEmployeeTransition` geravam um `uid()` internamente, as duas execuções produziam **IDs divergentes**; e o resultado retornado (do snapshot) podia não corresponder à gravação efetiva (falso sucesso quando o updater descartava).

## 2. Arquitetura adotada

### Commit autoritativo (`store.tsx`)
- `const dataRef = useRef(data)` — snapshot autoritativo **sincronizado**: toda mutação o atualiza sincronicamente.
- `apply(fn, auto)` avalia `fn` **uma única vez** contra `dataRef.current`, aplica `autoPost` quando necessário, atualiza `dataRef.current` e agenda `setData(final)`.
- `replace(next)` substitui o estado mantendo o snapshot sincronizado (backup/demo/apagar/undo).
- Todas as mutações (`apply`, `runLedger`, `undoable`, `reconcilePurchases`, `verifyAndSettle`, `reconcileAccounting`) passam por `apply`/`replace` — nenhuma mais usa `setData(updater)` diretamente.

### Transições determinísticas (`save-transitions.ts`)
- `addContactTransition(d, c, env, id)` e `addEmployeeTransition(d, e, env, id)` agora recebem o **ID como parâmetro** (gerado uma única vez no store via `uid()`). Mesma entrada → mesma saída.

### Cadastros
- `addContact`/`addEmployee`: gera `id` uma vez, avalia a transição contra `dataRef.current` e grava via `replace(nextState)`; retorna `{ ok: true, id }` com o **mesmo ID presente no estado confirmado**.
- `updateContact`/`updateEmployee`: avalia contra `dataRef.current`, preserva id/ambiente, grava via `replace`.

Isso garante que `SaveResult.ok === true` somente quando a transição aceitou sobre o snapshot autoritativo, e `SaveResult.id` é exatamente o ID do registro gravado — sem dupla execução e sem variáveis externas mutadas em updaters.

## 3. Validações e isolamento preservados
CPF/CNPJ completo/válido, duplicidade exata bloqueante, duplicidade provável informativa, separação cliente/fornecedor, `not_found`, `wrong_environment`, ambiente imutável, exclusão do próprio ID na edição, compatibilidade com registros legados e isolamento Mainnet/Testnet.

## 4. Arquivos

**Modificados:** `src/lib/store.tsx`, `src/lib/save-transitions.ts`, `tests/save-transitions.test.ts`.

## 5. Testes

Novos (2): determinismo das transições e loop de commit (snapshot sincronizado, sem duplicata e IDs consistentes em submissões rápidas). Atualizados os testes existentes para o ID explícito.

Suíte completa: **353 pass, 0 fail** (nenhuma regressão).

## 6. Garantias e limitações

- `SaveResult.ok`/`id` correspondem à mutação aceita no estado local autoritativo.
- Persistência em `localStorage` ocorre no `useEffect` sobre `data`; **não** há confirmação síncrona de durabilidade nem exclusividade entre dispositivos (backend transacional não implantado). Documentado, sem promessa de durabilidade não verificável.
- Testes de integração cobrem o loop de commit real (snapshot sincronizado + transição determinística); o render React do `StoreProvider` não é testado diretamente (sem `@testing-library/react`).

## 7. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
