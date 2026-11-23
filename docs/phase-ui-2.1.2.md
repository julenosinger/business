# Fase UI 2.1.2: Save Result Consistency & Regression Hardening

**HEAD inicial:** `795bc06` (Fase UI 2.1.1) · **HEAD final:** `(commit desta fase)`

Resultado: **351 testes passando** (eram 341), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma alteração visual.

---

## 1. Causa-raiz

Em `addContact`, `updateContact`, `addEmployee` e `updateEmployee`, a validação era feita sobre um snapshot (`data`) para produzir o resultado, enquanto a revalidação e a gravação ocorriam dentro de `setData(updater)`. Como o updater do React não devolve o resultado de forma síncrona, o método retornava `{ ok: true, id }` mesmo quando o updater podia descartar a gravação (rejeição interna) — sucesso falso.

## 2. Solução adotada

Criado `src/lib/save-transitions.ts` com **transições puras e determinísticas**:

`addContactTransition(d, c, env)`, `updateContactTransition(d, id, patch, env)`, `addEmployeeTransition(d, e, env)`, `updateEmployeeTransition(d, id, patch, env)` — cada uma recebe o estado autoritativo + comando e retorna `{ nextState, result }`, onde `result` é `{ ok: true, id } | { ok: false, code }` (`invalid_document` | `duplicate` | `not_found` | `wrong_environment`).

O store passou a:

1. Executar a transição sobre o snapshot autoritativo e obter `result`.
2. Rejeitar com `{ ok: false, code, message }` quando `result.ok === false`.
3. Gravar via `setData((d) => { const t = transition(d, ...); return t.result.ok ? t.nextState : d })` — **reutilizando a mesma função pura** sobre o estado mais recente (sem efeitos colaterais no updater).
4. Retornar `{ ok: true, id }` somente quando a transição aceitou sobre o mesmo snapshot usado na mutação.

Isso garante que `SaveResult.ok === true` corresponda a uma operação aceita e aplicada (mesma transição, mesmo snapshot). O store continua retornando apenas o resultado (sem toast); os modais exibem o feedback e a Tesouraria ignora o resultado.

## 3. Feedback de CEP (P4)

Em `Contacts.tsx`, `searchCep` agora usa `formRef` para conferir o CEP atual **antes** de aplicar e exibir sucesso. Respostas obsoletas (CEP trocado, registro/ambiente trocado ou modal fechado) são descartadas sem falso sucesso e sem erro em cancelamentos (`AbortError`).

## 4. Arquivos

**Criados:** `src/lib/save-transitions.ts`, `tests/save-transitions.test.ts`.
**Modificados:** `src/lib/store.tsx`, `src/pages/Contacts.tsx`.

## 5. Testes

Novos (10, em `tests/save-transitions.test.ts`): sucesso e mutação real; duplicidade exata; documento inválido; `not_found`; `wrong_environment`; edição preservando id/ambiente; dupla submissão sem duplicata; transições de funcionário.

Suíte completa: **351 pass, 0 fail** (nenhuma regressão).

## 6. Garantias e limitações de persistência

- `SaveResult.ok` reflete a aceitação da operação no estado local (autoritativo).
- Persistência em `localStorage` ocorre no `useEffect` existente; **não** há confirmação síncrona de durabilidade nem exclusividade entre dispositivos (backend transacional não implantado). Documentado, sem promessa de durabilidade não verificável.

## 7. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
