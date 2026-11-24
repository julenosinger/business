# FIN-03.2: Financial Integrity, Dashboard Accuracy & Sales Quantity UX

**HEAD inicial:** `43685f5` (FIN-03.1) · **HEAD final:** `(commit desta fase)`

Resultado: **508 testes passando** (eram 483) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

---

## Causas-raiz identificadas

1. **Classificação binária de caixa.** `kpis` tratava TODA entrada como receita (`otherIncome`) e TODA saída como despesa (`opex`), exceto `CAT_SALES`/`CAT_PURCHASE`. Isso fazia compras de matéria-prima/insumos/embalagens virarem despesa e reembolsos/empréstimos virarem receita.
2. **Sem distinção entre resultado econômico e fluxo de caixa.** O CMV só existia via vendas do PDV; não havia sinalização de resultado incompleto quando a receita de mercadorias não tinha custo apurado.
3. **`categoryMap` não migrava.** Ledgers existentes não recebiam os novos mapeamentos (`normalizeLedger` substituía em vez de mesclar).
4. **Categorias `supported: false` não eram rejeitadas no motor.** Podiam ser contabilizadas silenciosamente com fallback genérico (ex.: empréstimo virava despesa).
5. **Carrinho de vendas sem edição direta de quantidade.** Apenas botões `+`/`-`.

## Correções por subfase

### B — Category Engine & mapeamento contábil (P4)
- `financial-categories.ts`: categoria interna `Vendas` (CAT_SALES), flags `selectable`/`requiresCogs`, helpers `natureOfCategory`, `isUnsupportedCategory`, `categoryRequiresCogs`.
- `engine.normalizeLedger`: migração **aditiva e idempotente** do `categoryMap` (preserva personalizações).
- `adapters.cashBookEvent` e `rules` (`cashbookIncome/Expense`, `payableCreated`, `receivableCreated`): rejeitam `supported: false` com novo erro `unsupported_category`.
- `store.addEntry`/`addAccount`: rejeitam `supported: false` (defesa em profundidade).

### C — Integração financeira e seletores (P1/P2/P3)
- `selectors.kpis`/`expensesByCategory` classificam por **natureza contábil**:
  - Receita = vendas + entradas de natureza `revenue` (reembolsos/empréstimos não são receita).
  - CMV = apenas das vendas (nunca inferido de pagamento a fornecedor).
  - Opex = saídas de natureza `expense` (estoque/ativos/principal não são despesa).
  - `inflow`/`outflow` = todo o caixa (fluxo), independente da natureza.
- Novo campo `Kpis.cogsIncomplete`: `true` quando há receita de mercadorias (categoria com `requiresCogs`) sem vínculo a uma venda do PDV.

### D — Dashboard Accuracy (P5/P6)
- Indicadores adicionados: **CMV**, **Lucro bruto** e **Margem líquida** (como sub do lucro líquido).
- Mantidos: faturamento, lucro líquido, despesas operacionais, estoque, fluxo de caixa, tesouraria, contas a pagar/receber.
- Banner de aviso quando `cogsIncomplete` (Dashboard e DRE): resultado não é definitivo.
- Tooltips explicando os cálculos (via `KpiTile.hint`).

### E — Sales Quantity Input (P7/P8)
- `quantity.ts`: validador puro (rejeita vazio/zero/negativo/científico/não-finito/acima do estoque/acima do limite seguro).
- Campo central do carrinho virou `<input>` numérico: digitação direta, selecionar tudo no foco, colar, `inputMode="numeric"`.
- Subtotal por item (`preço × quantidade`), total e badge do produto sincronizam só com valores válidos.
- Quantidade inválida mantém a última válida, bloqueia a finalização e mostra mensagem; sem perda de foco a cada tecla.
- `recordSale` agora **revalida** quantidade/estoque na camada de execução e retorna `boolean` (sem falso sucesso; carrinho só limpa após sucesso).

## Fórmulas utilizadas
- `revenue = Σ vendas.total + Σ entradas(natureza=revenue, categoria≠Vendas)`
- `cogs = Σ vendas.cogs`
- `opex = Σ saídas(natureza=expense, categoria≠Vendas)`
- `grossProfit = revenue - cogs`
- `profit = revenue - cogs - opex`
- `inflow = Σ entradas` · `outflow = Σ saídas` (fluxo de caixa)
- `margem líquida = profit / revenue`

## Cenário financeiro reproduzido (P13/P16)
Venda 500.000 com CMV 300.000; compra de estoque 300.000; despesa 3.000:
- Receita 500.000 · CMV 300.000 · Lucro bruto 200.000 · Despesas 3.000 · **Lucro líquido 197.000**.
- Entradas 500.000 · Saídas 303.000 · **Resultado de caixa 197.000** · Margem líquida **39,4%**.
- A compra de estoque (300.000) **não** reduz o lucro nem vira CMV.
- Recebimento de "Venda de mercadorias" sem vínculo ao PDV sinaliza `cogsIncomplete`.

## Evidências de isolamento Mainnet/Testnet
- Nenhuma mudança no isolamento já existente (FIN-02/FIN-03.1). Os seletores novos (`kpisForEnvironment`, `expensesByCategoryForEnvironment`) continuam filtrando por `environment` e não leem o razão (teste `selectors não leem o razão` preservado).
- `recordSale`/`addEntry`/`addAccount` seguem validando ambiente de produtos/contatos/categorias.

## Arquivos
- **Modificados:** `financial-categories.ts`, `accounting/{adapters,engine,rules,types}.ts`, `selectors.ts`, `store.tsx`, `Dashboard.tsx`, `Accounting.tsx`, `Sales.tsx`.
- **Criados:** `quantity.ts`, `tests/financial-integrity.test.ts`, `tests/cart-quantity.test.ts`, `tests/store-category-rejection.test.ts`.

## Testes
- **Novos (25):** classificação por natureza, cenário financeiro completo, CMV incompleto, liquidação sem duplicação, migração do mapeamento, rejeição no motor e no Store, validação de quantidade.
- **Anteriores:** 483 preservados (nenhum removido ou enfraquecido).

## Limitações e riscos residuais
- **Vendas externas ao PDV com CMV manual comprovável (P3 completo):** a distinção de categorias e o sinal `cogsIncomplete` foram entregues; o vínculo de uma entrada a uma venda existente ou o registro de CMV manual rastreável continua pendente (fase futura).
- **Naturezas não suportadas (P1/P2):** categorias de ativo/passivo (reembolsos, empréstimos, investimentos) permanecem `supported: false` — fora dos seletores e rejeitadas no motor — até o suporte contábil ser certificado.
- **Pendências FIN-02 (2.5/2.6):** `GeneralLedgerTab`/`ReconciliationTab`/`PeriodsTab` ainda renderizam o razão global (sem filtro por ambiente); isolamento completo de visualização do razão segue pendente. Não foi declarado isolamento total.
- **Desagregação de resultado financeiro (P5):** "Juros recebidos/pagos" seguem em `revenue_other`/`expense_operating` (não há subtipos financeiros próprios); não foram criados subtipos novos para evitar risco no motor.

## Rollback
`git revert 05366eb && git revert b72496a && git revert 539ee1b`
