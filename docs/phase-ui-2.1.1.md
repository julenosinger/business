# Fase UI 2.1.1: Smart Forms Execution Integrity

**HEAD inicial:** `982b0f4` (Fase UI 2.1) · **HEAD final:** `(commit desta fase)`

Resultado: **341 testes passando** (eram 340), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma alteração visual.

---

## 1. Correções

### P1 — Salvamento atômico e validação atualizada (`store.tsx`)
- `addContact`, `updateContact`, `addEmployee`, `updateEmployee` agora:
  - Validam duplicidade/documento sobre o snapshot para produzir o resultado e **revalidam sobre o estado mais recente dentro do `setData`** (gravação atômica; submissões rápidas não duplicam).
  - Bloqueiam edição de registro inexistente (`not_found`) ou de outro ambiente (`wrong_environment`).
  - **Preservam o ambiente original** no merge (`environment: cur.environment`), impedindo que o payload altere o ambiente.
  - Mantêm a distinção exata × provável (exata bloqueia; provável não bloqueia).

### P2 — Resultados explícitos do store
- Novo tipo `SaveResult = { ok: true; id } | { ok: false; code; message }` (`invalid_document` | `duplicate` | `not_found` | `wrong_environment`).
- O store **não emite toast**; retorna o resultado. Quem decide o feedback é o chamador:
  - Modais (Clientes/Fornecedores/Funcionários) exibem erro/sucesso.
  - Tesouraria/BatchPay (atualização de carteira pós-pagamento) ignora o resultado — sem toasts espúrios no fluxo de pagamento.

### P3 — Proteção contra perda de rascunhos
- Os modais só executam `draft.clear()` + `onClose()` quando `res.ok`.
- Em falha: modal permanece aberto, campos preservados, rascunho preservado, motivo exibido (toast único).

### P4 — Consultas assíncronas seguras (`Contacts.tsx`, `lookup.ts`)
- CEP: descarta resposta se o CEP atual mudou (checagem dentro do updater do estado).
- CNPJ: descarta resposta se o documento mudou (`docRef` com `useEffect`); `setDoc`/`setPersonType` abortam consulta e invalidam sugestões.
- `fetchJson` agora aborta quando o sinal já está abortado; cancelamentos (`AbortError`) não exibem toast de erro.
- Falhas externas continuam degradando para preenchimento manual.

### P5 — Isolamento
- Duplicidade verificada apenas no ambiente correto; edição de outro ambiente bloqueada; ambiente imutável após criação.

## 2. Arquivos

**Modificados:** `src/lib/store.tsx`, `src/lib/lookup.ts`, `src/pages/Contacts.tsx`, `src/pages/Employees.tsx`, `tests/lookup.test.ts`.

## 3. Testes

- Novo: 1 (`lookup.test.ts` — cancelamento via AbortSignal).
- Suíte completa: **341 pass, 0 fail** (nenhuma regressão).

## 4. Limitação documentada

- Sem backend transacional: a proteção contra concorrência entre dispositivos é local (revalidação no estado mais recente), **não** oferece exclusividade global. Durabilidade é a do `localStorage` existente.

## 5. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
