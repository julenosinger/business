# Fase UI 2.2.1: Financial Integrity & Business Profile UX Refinement

**HEAD inicial:** `68c2e76` (Fase UI 2.2) · **HEAD final:** `(commit desta fase)`

Resultado: **381 testes passando** (eram 377), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma alteração em fluxos financeiros, contábeis, logísticos ou blockchain.

---

## 1. Defeitos comprovados e correções

### P1 — Soma de moedas diferentes (corrigido)
- Os perfis somavam `Account.amount` sem separar `Account.currency`, podendo misturar BRL/USD/USDC.
- **Correção:** novo helper puro `groupMoneyByCurrency(items)` em `src/lib/profile-money.ts`, que agrupa por moeda real e classifica registros sem moeda como `unspecified` (nunca assumindo a moeda atual). `formatMoneyGroup` formata por moeda (`formatCurrency`) e, para `unspecified`, exibe o número sem símbolo arbitrário.
- Aplicado a contas a receber/a pagar e aos totais de folha. `totalSold`/`totalPurchased`/salário (sem campo de moeda por registro) continuam na moeda do app e não são exibidos como soma com contas de outra moeda.

### P2 — Datas do Histórico com significado correto (corrigido)
- Antes, `dueDate` era apresentado como data cronológica de atividade.
- **Correção:** o Histórico agora usa a data real de cada evento — vendas por `date`, compras por `date` e liquidações por `settlements[].date` (quando disponível). O vencimento das contas aparece explicitamente na aba Financeiro, com rótulo "Vencimento".

### P3/P4/P5/P6 — Refinamento de UX
- **Cabeçalho compacto** (avatar + nome/razão social + status + identificação + Voltar/Editar), sem espaços excessivos nem repetição.
- **Resumo em indicadores** compactos (total vendido/comprado, em aberto por moeda, quantidade, nº de contas) com cores discretas e layout responsivo; múltiplas moedas aparecem separadas, sem total consolidado fictício.
- **Dados cadastrais** sem duplicação "Nome/Cliente" quando idênticos; CPF/CNPJ, endereço, telefone e email preservados.
- **Carteira de pagamento** com título, endereço abreviado e botão Copiar (copia o endereço integral, com feedback de sucesso/erro).
- **Atividade recente** na Visão geral (até 5 registros reais por ID e ambiente), com tipo, data e valor por moeda.

### P7 — Fornecedores e Funcionários
Mesma qualidade visual aplicada, respeitando particularidades (fornecedores: compras/obrigações; funcionários: dados profissionais/remuneração/folha). Sem misturar recebíveis com obrigações e sem alterar cálculos de folha.

## 2. Arquivos

**Criados:** `src/lib/profile-money.ts`, `tests/profile-money.test.ts`, `docs/phase-ui-2.2.1.md`.
**Modificados:** `src/components/profiles/ContactProfile.tsx`, `src/components/profiles/EmployeeProfile.tsx`.

## 3. Proteção do sistema (P8)
Nenhuma alteração em `dataRef`, `apply`/`replace`, `SaveResult`, transições, Undo, `runShipmentOp`, `autoPost`, persistência, Tesouraria/Gateway/BatchPay, contratos, RPCs ou autenticação.

## 4. Testes

Novos 4, em `tests/profile-money.test.ts`: separação por moeda, `unspecified` para moeda ausente, formatação sem símbolo arbitrário, lista vazia.

Suíte completa: **381 pass, 0 fail** (nenhuma regressão).

## 5. Limitações

- Registros sem moeda continuam preservados e exibidos como "não especificada" (sem conversão).
- Não há cotação/câmbio automático: valores não são convertidos sem taxa válida e comprovada.

## 6. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
