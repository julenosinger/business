# FIN-03.2.1: Financial Integrity, Sales Execution & Dashboard Responsive Hardening

**HEAD inicial:** `be2f4c3` (FIN-03.2) · **HEAD final:** `d33a6a6`

Resultado: **519 testes passando** (eram 508) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

---

## Causas-raiz

1. **Demonstração destrutiva:** `Dashboard` chamava `loadDemo()`, que SUBSTITUÍA todos os dados (incluindo o outro ambiente). P7.
2. **Carrinho descartava edição inválida no blur:** `blurQty` revertia silenciosamente para a última quantidade válida, permitindo concluir uma venda diferente da pretendida. P5.
3. **Venda com snapshot desatualizado e produtos repetidos:** `recordSale` validava `data.products` (snapshot de render) e tratava 60+60 individualmente (passavam) em vez de 120 (rejeitado); `items.find` só via a primeira ocorrência. P6.
4. **Idempotência global:** `postEvent` buscava por `idempotencyKey` sem considerar o ambiente. P9.
5. **`updateAccount` genérico:** sem validação de ambiente, imutabilidade ou categoria. P8.
6. **Cards sem responsividade:** 6 colunas fixas estouravam valores monetários. P1.
7. **Donut confundia resultado mensal com saldo acumulado.** P3.
8. **Razão Geral/Conciliação/Períodos exibiam registros globais.** P10.

## Correções por subfase

### A — Proteções destrutivas e isolamento crítico (P7)
- `loadDemo` **removido** do Store; `Dashboard` usa apenas `loadSandboxDemo` (Testnet, aditivo), com os botões de demonstração visíveis somente na Testnet.
- `resetAll` permanece em Configurações com confirmação + Desfazer.

### B — Ledger, idempotência e mutações (P8/P9)
- `engine.postEvent`: identidade = `idempotencyKey` + `environment` (mesma chave em ambientes diferentes são operações distintas; repetição no mesmo ambiente é duplicata).
- `updateAccount`: rejeita edição de outro ambiente, mantém `environment` imutável, valida categoria suportada e compatível com o tipo (payable=expense / receivable=income), retorna `boolean`; o `AccountModal` só fecha após sucesso.

### C — Carrinho e execução de vendas (P5/P6)
- `Sales.tsx`: blur NÃO descarta valor inválido (valor e mensagem permanecem); `Escape` reverte, `Enter` confirma; finalização bloqueada.
- `recordSale`: validação e mutação DENTRO do updater (estado autoritativo), consolida produtos repetidos (soma por produto), valida total contra estoque, retorna resultado explícito; estoque/caixa/contas/razão intactos em falha.

### D — Indicadores e gráficos (P2/P3/P4)
- Donut do fluxo de caixa: centro agora mostra **Resultado do mês** (entradas − saídas), não o saldo acumulado.
- `AreaChart`: pontos expõem valores exatos via `<title>` (tooltip nativo), preservando séries próximas/sobrepostas.
- Reclassificação segura: `updateEntry` (com estorno+relançamento no razão) continua corrigindo categorias; `cogsIncomplete` sinaliza resultado provisório quando a receita de mercadorias não tem custo apurado.

### E — Responsividade dos cards (P1)
- Grid: 1 col (mobile) → 2 (sm) → 3 (lg) → **6 apenas em ultrawide (3xl=1920px)**.
- `KpiTile`: valor com `min-w-0` + `break-words` (nunca estoura o card; símbolo quebra para linha própria quando necessário).

### F — Isolamento do razão por ambiente (P10)
- `glRows` ganhou filtro `environment`.
- `GeneralLedgerTab`, `PeriodsTab` e `ReconciliationTab` isolam por ambiente (com aviso discreto de registros `unassigned`).
- Novo `environment-scope.ts`: `ledgerForEnvironment` e `appDataForEnvironment` (fora de `selectors.ts` para preservar a fronteira DRE/razão).

## Fórmulas
- `resultado do mês = entradas − saídas` (fluxo de caixa, ≠ saldo acumulado).
- `cogsIncomplete = ∃ entrada de natureza receita com requiresCogs sem vínculo a venda`.
- Venda: `total = Σ qty·price`, `cogs = Σ qty·cost`, `lucro bruto = total − cogs`.

## Evidências de isolamento
- Testes novos: idempotência por ambiente, `glRows` por ambiente, `ledgerForEnvironment`, consolidação de venda sem mutação, `updateAccount` cross-env rejeitado.
- `loadSandboxDemo` já testado (preserva Mainnet, bloqueado na Mainnet, IDs únicos) — preservado.

## Arquivos
- **Modificados:** `store.tsx`, `accounting/engine.ts`, `accounting/gl.ts`, `Finance.tsx`, `Sales.tsx`, `Dashboard.tsx`, `ds/KpiTile.tsx`, `charts.tsx`, `accounting/{GeneralLedgerTab,PeriodsTab,ReconciliationTab}.tsx`, `tailwind.config.js`.
- **Criados:** `environment-scope.ts`, `tests/fin-03.2.1-ledger.test.ts`, `tests/store-sale-integrity.test.ts`.

## Testes
- **Novos (11):** idempotência por ambiente (2), razão por ambiente (2), consolidação de vendas (3), proteção de mutações (4).
- **Anteriores:** 508 preservados (nenhum removido/enfraquecido).

## Limitações e riscos residuais
- **Responsividade:** validada por testes de unidade/lógica (classes de grid e wrapping); **testes de navegador em resoluções reais (360…2560px) não foram executados** — não há infraestrutura de navegador neste ambiente. O proprietário deve validar manualmente.
- **P4 completo:** o vínculo de um recebimento a uma venda existente e o CMV manual comprovável permanecem pendentes (o sinal `cogsIncomplete` e a reclassificação de categoria já cobrem o "provisório" e a "correção").
- **BalanceViews/balancete da Conciliação** ainda usa o razão global (visão de tesouraria USDC); o particionamento lógico do balancete por ambiente segue pendente.
- **Naturezas não suportadas** (reembolsos/empréstimos/investimentos) permanecem `supported:false` (bloqueadas), como em FIN-03.2.

## Pronto para teste manual na Arc Testnet
- Carregar demonstração na Testnet (botões do Dashboard).
- Editar quantidade no carrinho (digitar, colar, valores inválidos, Escape).
- Venda com produto repetido e quantidade acima do estoque.
- Trocar Mainnet/Testnet e conferir Razão Geral/Conciliação/Períodos isolados.

## Rollback
`git revert 2c6a6a7 && git revert 079b5df && git revert aab3f80 && git revert 43ff674`
