# HOTFIX FIN-01.1: Legacy Recovery, Accounting Integrity & Form Reliability

**HEAD inicial:** `b20675b` (HOTFIX FIN-01) · **HEAD final:** `a99d922`

Resultado: **464 testes passando** (eram 454), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma regressão, nenhuma perda de dados, nenhuma duplicação contábil.

---

## 1. Causas-raiz corrigidas

### Botão Salvar bloqueado sem explicação (P5)
`docInvalidError()` retornava `false` para documento **incompleto**, enquanto `docValidForSubmit()` impedia o salvamento. Resultado: o botão ficava desabilitado sem qualquer mensagem (ex.: fornecedor PJ com CNPJ de 13 dígitos).

### Lançamentos legados sem recuperação (P1/P2)
O HOTFIX FIN-01 marcou lançamentos antigos como `unassigned`, sem caminho de recuperação do ambiente original nem classificação manual.

### Edição/exclusão sem proteção entre ambientes (P4)
`updateEntry`/`removeEntry` não impediam alterar lançamentos de outro ambiente.

## 2. Correções

### P5 — Validação de documento unificada
- Novo `docErrorStatus(raw, personType)` que distingue `none`/`incomplete`/`invalid` (com contagem de dígitos).
- `Contacts.tsx` exibe mensagem específica: "CPF/CNPJ incompleto: X de Y dígitos" (tom de aviso) e "CPF/CNPJ inválido" (erro).
- Resumo compacto de pendências próximo ao botão Salvar ("Para salvar, revise: …").
- Validação final (`docValidForSubmit`) preservada — dígitos verificadores não foram enfraquecidos.

### P1 — Recuperação de lançamentos legados
- `Entry` ganhou `sourceKind`/`sourceId` (vínculo inequívoco com a operação de origem: venda/conta/compra).
- Todos os pontos de criação gravam o vínculo (liquidação→conta, venda→saleId, compra→purchaseId, estorno→venda).
- `migrateEntryEnvironments` recupera o ambiente pelo vínculo; sem vínculo confiável ou origem `unassigned`, permanece sem ambiente (idempotente, não destrutiva). Integrada à cadeia de migração (antes da classificação `unassigned`).

### P2 — Classificação manual
- `setEntryEnvironment(id, environment)` (auditado, recusa reclassificar registros já classificados).
- Seção compacta na Contabilidade listando lançamentos `unassigned`, com botões Mainnet/Testnet e confirmação explícita.

### P4 — Proteção de edição/exclusão
- `updateEntry`/`removeEntry` bloqueiam operações sobre lançamentos de outro ambiente, e impedem alterar `environment` por patch comum.

## 3. Arquivos

**Modificados:** `src/lib/documents.ts`, `src/lib/types.ts`, `src/lib/store.tsx`, `src/pages/Contacts.tsx`, `src/pages/Accounting.tsx`, `tests/documents.test.ts`, `tests/environment-isolation.test.ts`, `tests/accounting-environment.test.ts`.

**Criados:** `docs/phase-fin-01.1.md`.

**Não modificados:** Store/persistência (fora dos pontos listados), `dataRef`, `apply`/`replace`, Undo, `SaveResult`, `autoPost`, Ledger, Tesouraria, Circle Gateway, BatchPay, RPCs, contratos, `ProfileIntent`, Chatbot, AI Agents, Design System. Arc Mainnet `5042` / Testnet `5042002` preservados.

## 4. Registros ainda pendentes

Lançamentos legados **sem vínculo confiável** (sem `sourceId`, ou origem inexistente/`unassigned`) permanecem `unassigned` e são exibidos na seção de classificação da Contabilidade para revisão manual — nunca inferidos por valor, descrição, data ou rede ativa.

## 5. Testes

**Novos (10):**
- `documents.test.ts` (2): `docErrorStatus` (vazio/incompleto/inválido/válido) e CNPJ de 13 dígitos reporta contagem.
- `environment-isolation.test.ts` (4): recuperação por vínculo (venda/conta), sem vínculo/origem `unassigned` permanece, idempotência.
- `accounting-environment.test.ts` (4): edição/exclusão entre ambientes bloqueadas, classificação `unassigned` com auditoria, recusa de reclassificação.

**Suíte completa:** **464 pass, 0 fail** (454 anteriores preservados).

## 6. Limitações e riscos residuais

- Lançamentos legados ambíguos continuam `unassigned` até classificação manual (por design — sem inferência).
- A seção de classificação mostra até 6 itens; os demais permanecem `unassigned` e fora dos indicadores até revisão.

## 7. Rollback

`git revert <commit da fase>`
