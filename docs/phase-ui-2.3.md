# Fase UI 2.3: Business Operations & Customer 360°

**HEAD inicial:** `ab6c548` (Fase UI 2.2.2) · **HEAD final:** `(commit desta fase)`

Resultado: **398 testes passando** (eram 387), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma alteração em contabilidade, estoque, pagamentos, tesouraria ou blockchain.

---

## 1. Objetivo

Transformar os perfis de Clientes, Fornecedores e Funcionários em pontos de entrada para as operações já existentes, transportando apenas **IDs estáveis** (nunca nomes) e reutilizando os fluxos dos módulos — sem formulários paralelos e sem executar operações automaticamente.

## 2. Ações rápidas implementadas

**Cliente (360°):**
- **Nova venda** → abre Vendas com o cliente pré-selecionado (`customerId`).
- **Nova conta a receber** → abre o modal de conta no Financeiro com tipo `receivable` e contato pré-selecionado.
- **Ver vendas** → abre Vendas com a lista "Vendas recentes" filtrada por `customerId`.
- **Ver contas** → abre Financeiro filtrado por `contactId`.

**Fornecedor (360°):**
- **Nova compra** → abre Compras com o fornecedor pré-selecionado (`supplierId`).
- **Nova conta a pagar** → modal de conta com tipo `payable` e contato pré-selecionado.
- **Ver compras** → Compras filtrado por `supplierId` (compras a prazo atribuíveis por ID).
- **Ver contas** → Financeiro filtrado por `contactId`.

**Funcionário (360°):**
- **Ver contas** → Financeiro filtrado por `employeeId` (obrigações de folha).
- Consulta de folha e edição de dados profissionais já existiam (abas "Folha"/"Informações" e botão Editar).

## 3. Contrato de navegação

Novo tipo `ProfileIntent` em `src/lib/nav.tsx` + estado em `src/App.tsx`:

- `openProfileIntent(intent)` navega para o módulo correto (`sales`/`purchases`/`finance`) e entrega a intenção.
- `clearProfileIntent()` é chamado pela página destino ao consumir.
- Consumo "uma única vez" por navegação (padrão `seenIntent`, igual ao já usado na Tesouraria).

A página destino apenas pré-seleciona/filtra e **nunca grava** antes da confirmação do usuário. Nenhuma operação é executada ao navegar.

## 4. Arquivos

**Modificados:** `src/lib/nav.tsx`, `src/App.tsx`, `src/components/profiles/ContactProfile.tsx`, `src/components/profiles/EmployeeProfile.tsx`, `src/pages/Sales.tsx`, `src/pages/Finance.tsx`, `src/pages/Purchases.tsx`, `tests/profiles.test.ts`.

**Criados:** `tests/profile-navigation.test.ts`, `docs/phase-ui-2.3.md`.

**Não modificados:** `store.tsx`, `dataRef`, `apply`/`replace`, `SaveResult`, transições, Undo, `runShipmentOp`, `autoPost`, persistência, ledger/contabilidade, tesouraria/Gateway/BatchPay, contratos, RPCs, autenticação. Arc Mainnet `5042` / Testnet `5042002` e PT/EN/Light/Dark/desktop/mobile preservados.

## 5. Evidências

- **Pré-preenchimento por ID:** todos os botões transportam `id` (ou `employeeId`) + nome apenas como rótulo; as páginas validam que o ID ainda existe no ambiente antes de pré-selecionar (registros removidos degradam sem erro).
- **Isolamento de ambiente:** os seletores `*ForEnvironment` e a validação `customers/suppliers.some(...)` garantem que um registro de outro ambiente nunca é pré-selecionado.
- **Sem associação por nome:** o filtro de compras só associa contas por `contactId`; entradas pagas em dinheiro (sem `supplierId`) ficam fora do filtro (limitação documentada).
- **Nenhuma gravação automática:** pré-seleção e filtros são apenas estado local; a gravação continua exigindo o submit do formulário original.

## 6. Testes

**Novos (11):**
- `tests/profiles.test.ts` (5): perfil → intenção (Nova venda / Nova conta a receber / Ver vendas+contas / fornecedor / funcionário), verificando `kind`, IDs e tipos exatos.
- `tests/profile-navigation.test.ts` (6): integração real (DOM) — Vendas pré-seleciona cliente, Vendas filtra por ID, Compras pré-seleciona fornecedor, Financeiro abre conta com tipo/contato corretos, Financeiro filtra por `contactId` e por `employeeId`.

**Suíte completa:** **398 pass, 0 fail** (387 anteriores preservados).

## 7. Limitações e riscos residuais

- **Compras pagas em dinheiro** não possuem `supplierId` no lançamento contábil; o filtro "Ver compras" mostra apenas as compras a prazo atribuíveis por ID (sem associação por nome).
- **Retorno ao perfil:** navegar para um módulo sai do perfil; ao voltar, a listagem é exibida (o estado de "perfil aberto" não é persistido). Comportamento previsível e aceito para esta fase.
- O mock de `framer-motion` nos testes é restrito ao ambiente de teste (happy-dom não suporta a API de animação nativa); a lógica de negócio testada é real.

## 8. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
