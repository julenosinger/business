# Fase UI 2.2: Business Profiles & Management

**HEAD inicial:** `f55ef14` (Fase UI 2.1.5) · **HEAD final:** `(commit desta fase)`

Resultado: **377 testes passando** (eram 372), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma alteração em fluxos financeiros, contábeis ou blockchain.

---

## 1. Funcionalidades implementadas

### P1/P2 — Perfil de Cliente e Fornecedor
`src/components/profiles/ContactProfile.tsx` — perfil unificado para cliente/fornecedor, com cabeçalho (nome/razão social, tipo de pessoa, CPF/CNPJ, código interno, status, contatos, botões Editar/Voltar) e abas internas:
- **Visão geral** — dados cadastrais, endereço, telefone, email, pessoa de contato, condições de pagamento, carteira USDC e resumo.
- **Financeiro** — contas a receber (cliente) ou a pagar (fornecedor) vinculadas por `contactId`.
- **Histórico** — vendas (cliente) ou compras (fornecedor) + contas, ordenadas cronologicamente, sem eventos fictícios.
- **Informações** — campos adicionais já suportados (código interno, telefone secundário, observações, etc.).

### P3 — Perfil de Funcionário
`src/components/profiles/EmployeeProfile.tsx` — cabeçalho (nome, cargo, matrícula, admissão, situação) e abas:
- **Visão geral** — dados profissionais e remuneração.
- **Informações** — observações administrativas.
- **Folha** — registros de folha vinculados por `employeeId` (sem alterar cálculos ou geração de folha).

### P4/P6 — Interface e navegação
- Reutiliza `TCard`, `PanelTitle`, `PillTabs`, `Badge`, `Empty` — design aprovado preservado.
- Listagem → perfil via botão "Ver perfil" (ícone `Eye`) e nome clicável; perfil → listagem via "Voltar"; edição abre o modal existente (preservando ID/ambiente/draft).

## 2. Integração com dados reais (P5)
- Fonte de verdade: `useStore` + seletores por ambiente (`contactsForEnvironment`, `salesForEnvironment`, `purchasesForEnvironment`, `accountsForEnvironment`, `employeesForEnvironment`).
- Relacionamentos **por ID estável** (`contactId`, `customerId`, `supplierId`, `employeeId`) — nunca por associação de nomes.
- Registros inexistentes/removidos exibem estado vazio; isolamento Mainnet/Testnet preservado (perfil de outro ambiente → "não encontrado").

## 3. Proteção do store (P7)
Nenhuma alteração em `dataRef`, `apply`/`replace`, transições, `SaveResult`, Undo, `runShipmentOp`, `autoPost` ou persistência. Apenas componentes de apresentação e navegação.

## 4. Arquivos

**Criados:** `src/components/profiles/ContactProfile.tsx`, `src/components/profiles/EmployeeProfile.tsx`, `tests/profiles.test.ts`, `docs/phase-ui-2.2.md`.
**Modificados:** `src/pages/Contacts.tsx`, `src/pages/Employees.tsx`, `package.json`.

> `package.json`: o script `test` passou a `bun test tests --isolate` — necessário para isolar o `happy-dom` (usado nos testes de integração do provider) por arquivo de teste, sem afetar os demais arquivos de teste que usam mocks manuais.

## 5. Testes

Novos 5, em `tests/profiles.test.ts` (montando `StoreProvider` real com `happy-dom` + `react-dom/client` + `act`):
- Perfil de cliente exibe dados por ID (nome, documento, email).
- Perfil de fornecedor exibe razão social.
- Perfil de funcionário exibe cargo e matrícula.
- Registro inexistente exibe estado vazio.
- Isolamento Mainnet/Testnet (perfil não encontra cadastro de outro ambiente).

Suíte completa: **377 pass, 0 fail** (nenhuma regressão).

## 6. Limitações

- Relacionamentos exibidos são apenas os que existem no modelo atual (por ID). Métricas por associação frágil de nomes não são exibidas.
- Nenhuma métrica financeira é inventada; nenhuma soma entre moedas diferentes.

## 7. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
