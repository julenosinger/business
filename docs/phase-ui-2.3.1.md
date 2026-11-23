# Fase UI 2.3.1: Navigation Intent Hardening & Context Integrity

**HEAD inicial:** `ed10569` (Fase UI 2.3) · **HEAD final:** `232e7be`

Resultado: **407 testes passando** (eram 398), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Fase exclusivamente corretiva — nenhuma alteração em contabilidade, estoque, pagamentos, tesouraria ou blockchain.

---

## 1. Defeitos comprovados e correções

### P1 — Validação de contato no Financeiro (corrigido)
`Finance.tsx` aplicava `accountPreset` e abria o formulário sem validar o `contactId`.
- **Correção:** antes de abrir, valida via `contactsForEnvironment` que o contato existe no ambiente atual e tem o tipo correto (cliente para receber, fornecedor para pagar). Em caso de falha: o formulário **não** abre, nada é gravado, nenhuma associação por nome é feita, uma mensagem clara é exibida (`toast.error`) e somente a intenção inválida é descartada.

### P2 — Ciclo de vida das intenções (reforçado)
- `go()` em `App.tsx` agora descarta uma intenção de perfil ainda pendente ao navegar por outra via (sidebar/dashboard), evitando intenções que permanecem pendentes indefinidamente.
- O consumo continua "uma única vez" por referência (`seenIntent`), sem reaplicação de intenção antiga; a rejeição é zerada no fechamento do ciclo para permitir intenções consecutivas.
- Não foram introduzidos loops de renderização nem efeitos duplicados (respeitadas as regras `react/set-state-in-render` e `react/set-state-in-effect` do lint).

### P3 — Filtros contextuais no Financeiro (corrigido)
- O filtro afeta somente a lista (totais globais intactos).
- Quando um filtro está ativo e não há contas na aba atual, o estado vazio agora informa claramente ("Nenhuma conta nesta situação") e orienta a consultar "Liquidadas" ou limpar o filtro — **não** apresenta ausência de contas abertas como ausência de histórico financeiro.

### P4/P5 — Vendas, Compras e Funcionários (validado)
- Pré-seleção de cliente/fornecedor e filtros "Ver vendas"/"Ver compras" agora validam a existência no ambiente atual antes de aplicar, sem associação por nome.
- "Ver contas" de funcionário filtra exclusivamente por `employeeId`, com isolamento por ambiente, sem execução automática de pagamentos.

### P6 — Proteção de contexto
Cobertos: IDs inexistentes, IDs de outro ambiente, tipo de contato incorreto, intenções obsoletas, navegação consecutiva rápida, remoção do registro de origem e filtros residuais. Rascunhos válidos não são descartados silenciosamente (nenhuma gravação é feita sem confirmação do usuário).

## 2. Arquivos

**Modificados:** `src/App.tsx`, `src/pages/Finance.tsx`, `src/pages/Sales.tsx`, `src/pages/Purchases.tsx`, `tests/profile-navigation.test.ts`.

**Não modificados:** `store.tsx`, `dataRef`, `apply`/`replace`, `SaveResult`, transições, Undo, `runShipmentOp`, `autoPost`, persistência, contabilidade, tesouraria/Gateway/BatchPay, contratos, RPCs, autenticação. Arc Mainnet `5042` / Testnet `5042002` e PT/EN/Light/Dark/desktop/mobile preservados.

## 3. Testes

**Novos (9), em `tests/profile-navigation.test.ts` (integração real no DOM):**
- Conta a pagar com fornecedor válido.
- Rejeição de tipo incorreto (receber com fornecedor / pagar com cliente).
- Rejeição de contato inexistente.
- Rejeição de contato de outro ambiente.
- Nenhuma gravação automática ao abrir a conta.
- Filtro + alternância para "Liquidadas".
- Limpeza de filtro restaura a lista.
- Duas intenções consecutivas não reutilizam o ID anterior.

**Suíte completa:** **407 pass, 0 fail** (398 anteriores preservados + 9 novos).

## 4. Evidências

- **Consumo único:** cada intenção é aplicada uma vez por referência e limpa ao ser consumida; a navegação por `go()` descarta pendências.
- **Isolamento Mainnet/Testnet:** validação via `contactsForEnvironment` rejeita IDs de outro ambiente.
- **Preservação de rascunhos:** a validação ocorre antes de abrir o formulário, sem tocar em dados digitados.
- **Zero gravação automática:** teste confirma que abrir a conta pelo perfil não cria registros.

## 5. Limitações

- O aviso de rejeição usa `toast`; não há estado de erro persistente (a intenção inválida é descartada e o usuário pode repetir a ação).
- Filtros continuam temporários (não persistidos como dados financeiros), por design.

## 6. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
