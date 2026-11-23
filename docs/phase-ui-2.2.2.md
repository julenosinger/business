# Fase UI 2.2.2: Profile Display Consistency & Final Certification

**HEAD inicial:** `e05f138` (Fase UI 2.2.1) · **HEAD final:** `8ef6f05`

Resultado: **387 testes passando** (eram 381), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Fase exclusivamente corretiva — nenhuma alteração em cálculos, pagamentos, liquidações, contabilidade ou blockchain.

---

## 1. Defeitos reproduzidos e correções

### P1 — Moeda real ignorada em linhas individuais (corrigido)
Algumas linhas ainda chamavam `money(value)` (moeda global do app) sobre valores de contas com moeda própria.
- **Correção:** novo helper puro `formatValue(value, currency?)` em `src/lib/profile-money.ts`, que formata pela moeda real do registro e, para moeda ausente, apresenta o valor como **não especificada** (sem símbolo arbitrário).
- Aplicado à aba Financeiro (clientes/fornecedores), Histórico (liquidações) e Folha/Atividade recente (funcionários).
- Vendas, compras e salário (sem campo de moeda por registro) continuam na moeda do app — marcados com `isAppCurrency` no Histórico para não serem confundidos com liquidações.

### P2 — Pagamento pago apresentado como zero (corrigido)
A "Atividade recente" dos funcionários usava `accountOutstanding(a)`; em conta paga isso era `0`, exibido como se fosse o valor do pagamento.
- **Correção:** "Atividade recente" e "Folha" passaram a exibir o **valor original** `a.amount` via `formatValue`, com selo de status (Paga/Pendente). Nenhum pagamento concluído aparece mais como zero.
- Na `AccountRow` de contatos, o valor exibido é o **original** `a.amount`, e a linha "Saldo pendente" (via `accountOutstanding`) só aparece para contas **parciais** — distinguindo valor original, saldo pendente e status.

### P3 — Status financeiros consistentes (corrigido)
`AccountRow` agora distingue **Em aberto** / **Parcial** (`accountIsPartial`) / **Liquidada** (`status === 'paid'`), usando apenas estados derivados já existentes — nenhum estado novo persistido.

### P4 — Histórico e datas preservados
Mantida a correção da 2.2.1: vendas por `date`, compras por `date`, liquidações por `settlements[].date`, vencimento identificado como "Vencimento", registros cancelados sinalizados. Relacionamentos por ID e isolamento Mainnet/Testnet intactos.

## 2. Arquivos

**Modificados:** `src/components/profiles/ContactProfile.tsx`, `src/components/profiles/EmployeeProfile.tsx`, `src/lib/profile-money.ts`, `tests/profile-money.test.ts`, `tests/profiles.test.ts`.

**Não modificados:** `store.tsx`, `dataRef`, `apply`/`replace`, `SaveResult`, Undo, `runShipmentOp`, `autoPost`, persistência, Tesouraria/Gateway/BatchPay, contratos, RPCs, autenticação. Arc Mainnet `5042` / Testnet `5042002` e PT/EN/Light/Dark/desktop/mobile preservados.

## 3. Testes

**Novos (6):**
- `tests/profile-money.test.ts`: `formatValue` respeita moeda real e trata ausência como não especificada.
- `tests/profiles.test.ts` (montagem real no `StoreProvider`): conta BRL como BRL, conta USDC como USDC, moedas diferentes separadas (não somadas), conta sem moeda sem símbolo arbitrário, folha paga exibe valor original (não zero).

**Suíte completa:** **387 pass, 0 fail** (381 anteriores preservados + 6 novos).

## 4. Evidências

- **Formatação por moeda:** as abas Financeiro/Folha/Histórico usam `formatValue`/`formatMoneyGroup`, nunca `money()` sobre valores de contas.
- **Valores pagos/pendentes/parciais:** "Atividade recente" exibe `a.amount` (original); `AccountRow` mostra original + "Saldo pendente" só para parciais; status Paga/Pendente/Parcial/Liquidada coerentes.
- **Integridade de dados:** nenhum valor armazenado alterado; testes confirmam que liquidação (`settleAccount`) e folha (`runPayroll`) permanecem intocados.

## 5. Limitações

- Registros legados sem moeda continuam exibidos como "não especificada" (sem conversão automática; sem câmbio fictício).

## 6. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.

---

**Ciclo UI 2.2.x encerrado após esta certificação.**
