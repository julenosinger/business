# Fase 3.2.4: Isolamento do ambiente financeiro e integridade do ciclo de vida das obrigações

**HEAD inicial:** `e1c961d` (Fase 3.2.3.2) · **HEAD final:** `4df2363`

Resultado: **300 testes passando** (eram 291), typecheck (app + servidor) limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz verificadas

- Obrigações não tinham um campo de **ambiente financeiro de origem**; apenas `paymentNetwork` (escolha de pagamento) e `chainId` (rede da operação).
- Dashboard, Contas a pagar/receber e o assistente usavam seletores globais (`accountTotals`, `upcoming`, `dueSoon`) sem classificação por ambiente, então uma obrigação criada na Mainnet aparecia também na Testnet.
- A Tesouraria já isolava a fila por `paymentNetwork`, mas a seção "não preparadas" e o resto do app não respeitavam a origem.
- O cancelamento em Contas a pagar/receber usava `removeAccount()` (exclusão física), permitindo apagar evidências e contornar as validações de cancelamento.

## 2. Modelo de isolamento implementado

- Novo campo independente em `Account`: `environment?: 'mainnet' | 'testnet' | 'unassigned'` (tipo `AccountEnvironment`).
  - `environment` = ambiente de **origem** da obrigação.
  - `paymentNetwork` = ambiente **escolhido para pagar** (não é substituto da origem).
  - `chainId` = rede real da operação blockchain.
- Toda criação de obrigação (`addAccount`, `recordSale`, `recordPurchase`, `runPayroll`) grava `environment: getNetwork()`.
- O ambiente nunca é alterado silenciosamente ao preparar, pagar, editar ou atualizar.

### Seletores centralizados (puros) — `src/lib/selectors.ts`

- `accountsForEnvironment(accounts, network)`.
- `accountTotalsForEnvironment(data, network)`.
- `upcomingForEnvironment(data, network, limit)`.
- `dueSoonForEnvironment(data, network, kind, days)`.

Todos partilham a mesma classificação persistida e excluem obrigações canceladas (`!canceledAt`).

### Migração segura — `migrateAccountEnvironments()` em `src/lib/store.tsx`

- Idempotente e versionada; roda após `migrateAccountCurrencies` no `load()`.
- Infere o ambiente a partir de evidência persistida confiável:
  1. `paymentNetwork` (se já preparada);
  2. rede (`chain`) de uma `TreasuryOp` vinculada (`gatewayChainEnv`: `live` → mainnet, `test` → testnet);
  3. senão `unassigned`.
- Nunca atribui pela rede atualmente selecionada; nunca duplica obrigações; preserva os dados integralmente.

## 3. Fluxos corrigidos

| Módulo | Correção |
| --- | --- |
| `Dashboard.tsx` | Usa `useNetwork` + `accountTotalsForEnvironment`/`upcomingForEnvironment`; menu discreto de cancelamento por obrigação (Trash2 + confirmação) reutilizando `cancelAccount`. |
| `Finance.tsx` | Filtra abas, listas, contadores e totais por `environment === network`; cancelamento (Trash2) agora usa a regra central `cancelAccount` (lógico/auditável) em vez de `removeAccount` (físico). |
| `Treasury.tsx` | Fila executável e seção "não preparadas" restritas a `environment === network`. |
| `AssistantPanel.tsx` | Totais, fornecedores a vencer e preparação de pagamento isolados por ambiente. |
| `ChargeModal.tsx` | Lista de contas a receber (cobrança) isolada por ambiente. |
| `store.preparePayment` | Bloqueia preparação cruzada (origem ≠ ambiente escolhido) e preparação de obrigação `unassigned`. |

## 4. Cancelamento consistente

- Centralizado em `cancelAccount(id)` / `cancelAccounts(ids)` (Fase 3.2.3.2), com regras puras `payEligibility`/`canCancel`.
- O cancelamento é lógico (`canceledAt`), preserva vínculos/evidências e é revalidado no estado mais recente dentro do updater.
- Dashboard, Finance e Tesouraria reagem ao cancelamento (as listas ativas excluem `canceledAt` e os totais recalculam).

## 5. Testes adicionados — `tests/environment-isolation.test.ts`

1. `accountsForEnvironment` separa Mainnet/Testnet e exclui `unassigned`.
2. `accountTotalsForEnvironment`: A pagar/A receber separados e canceladas excluídas.
3. `upcomingForEnvironment`: filtrada por ambiente, sem canceladas, ordenada.
4. `dueSoonForEnvironment` respeita o ambiente.
5. Migração classifica por `paymentNetwork` (sem usar a rede selecionada).
6. Migração classifica pela rede da operação vinculada.
7. Migração sem evidência → `unassigned`.
8. Migração preserva registro já classificado.
9. Migração executada duas vezes é idempotente e não duplica.

Suíte completa: **300 pass, 0 fail** (nenhum teste pré-existente quebrado).

## 6. Compatibilidade com dados anteriores

- Registros legados são preservados e classificados via migração; sem evidência, ficam `unassigned` e são **excluídos** dos totais exclusivos Mainnet/Testnet até classificação válida.
- Dados de demonstração (`loadDemo`) recebem o ambiente atualmente selecionado (não dependem de migração).
- O razão contábil (partida dobrada) e os relatórios globais **não** recebem filtro de ambiente indiscriminado.

## 7. Riscos residuais / limitações

- **Revisão de `unassigned`:** obrigações legadas sem evidência ficam preservadas mas sem ambiente; a interface de revisão explícita (classificação manual pelo dono) é pendência de fase futura — nenhum pagamento é permitido sem ambiente definido.
- **Backend transacional** ainda não implantado: exclusividade durável entre dispositivos segue sem garantia (documentado na Fase 3.2.3.2).
- `removeAccount()` permanece no store como API legada, porém **sem chamadores na UI** (substituído por cancelamento lógico em Finance).

## 8. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase 3.2.4>` (a migração é aditiva e idempotente; não destrói dados — desfazer o commit apenas remove a classificação visual, sem perda).
