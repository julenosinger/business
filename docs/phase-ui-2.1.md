# Fase UI 2.1: Smart Business Forms — Cadastros Inteligentes

**HEAD inicial:** `e32ccca` (Fase UI 2.0) · **HEAD final:** `(commit desta fase)`

Resultado: **340 testes passando** (eram 323), typecheck (app + servidor) limpo, lint limpo, build de produção OK.

---

## 1. Funcionalidades implementadas

### P1 — Validação definitiva de CPF/CNPJ
- Novas funções puras em `src/lib/documents.ts`: `docValidForSubmit` (vazio é opcional; preenchido deve ser completo e com dígitos verificadores) e `docInvalidError` (só sinaliza quando completo e inválido — não incomoda durante a digitação).
- Usadas no formulário (mensagem próxima ao campo + bloqueio do Salvar) e no store (`addContact`/`updateContact` revalidam antes de persistir).

### P2 — Preenchimento automático por CEP
- `src/lib/lookup.ts` com `lookupCep` (ViaCEP, sem chave de API), timeout de 8s, `AbortController` e descarte de respostas obsoletas.
- Botão "Buscar" no campo CEP; preenche apenas campos vazios (logradouro/bairro/cidade/estado); número/complemento continuam manuais. Falha nunca impede o cadastro.

### P3 — Consulta assistida de CNPJ
- `lookupCnpj` (BrasilAPI, sem chave de API) com timeout/abort.
- Botão "Consultar" quando o CNPJ está completo e válido; painel de revisão com "Aplicar sugestões" (só preenche campos vazios) e "Descartar"; origem da informação indicada (BrasilAPI).

### P4 — Prevenção de cadastros duplicados
- `src/lib/duplicates.ts` com `findContactDuplicates` (exata por CPF/CNPJ ou código interno; possível por nome/email) e `findEmployeeDuplicates` (exata por matrícula; possível por email/nome).
- Aviso discreto no formulário; revalidação no store (bloqueia duplicidade exata; nunca bloqueia por nome semelhante). Não mistura cliente com fornecedor nem Mainnet com Testnet; exclui o próprio registro na edição.

### P5 — Busca inteligente de contatos
- No `AccountModal`, pesquisa por nome/documento/código interno com lista filtrada pelo ambiente ativo; payload preserva o ID original do contato.

### P6 — Rascunhos seguros
- `src/lib/draft.ts` (`useDraft`) + `DraftPrompt` (componente em `form.tsx`): rascunho em localStorage separado por tipo de formulário, ambiente e registro (ou 'new'), gravado com debounce apenas quando difere do estado inicial, com restaurar/descartar e limpeza após salvar.
- Limitação documentada: aplicação de usuário/empresa única (sem isolamento multi-inquilino); não são armazenados segredos de carteira.

### P7 — Feedback
- Estados de carregamento (`Loader2`), sucesso e falha nas consultas; mensagens contextualizadas.

### P8 — Integridade e isolamento
- Preservado integralmente; consultas de duplicidade e seletores usam o ambiente ativo.

## 2. Serviços externos

- ViaCEP (`viacep.com.br/ws/{cep}/json/`) — gratuito, sem chave.
- BrasilAPI (`brasilapi.com.br/api/cnpj/v1/{cnpj}`) — gratuito, sem chave.
- Nenhuma chave de API no frontend; respostas não são armazenadas integralmente; falhas/timeouts não impedem o cadastro.

## 3. Arquivos criados / modificados

**Criados:** `src/lib/draft.ts`, `src/lib/duplicates.ts`, `src/lib/lookup.ts`, `tests/duplicates.test.ts`, `tests/lookup.test.ts`, `docs/phase-ui-2.1.md`.

**Modificados:** `src/lib/documents.ts`, `src/lib/store.tsx`, `src/components/form.tsx`, `src/pages/Contacts.tsx`, `src/pages/Employees.tsx`, `src/pages/Finance.tsx`, `tests/documents.test.ts`.

## 4. Testes

Novos (17): validação final de CPF/CNPJ (2), duplicidades (8), consultas com fetch mockado (7).

Suíte completa: **340 pass, 0 fail** (nenhuma regressão).

## 5. Riscos residuais

- Consultas externas dependem de disponibilidade dos provedores públicos (ViaCEP/BrasilAPI); falhas são degradadas graciosamente (cadastro manual continua).
- Rascunhos são locais (navegador), de usuário/empresa única; não há sincronização entre dispositivos nem isolamento multi-inquilino.
- O rascunho de "novo" é separado por tipo de formulário e ambiente; o de edição, por registro.

## 6. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
