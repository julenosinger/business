# Fase 3.3: Isolamento completo Mainnet/Testnet — ERP

**HEAD inicial:** `06545c7` (referência) · **HEAD final:** `9fa646a`

Resultado: **317 testes passando** (eram 312), typecheck (app + servidor) limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz

- O campo `environment` (introduzido na Fase 3.2.4) existia apenas em `Account`.
- Produtos, movimentações, vendas, compras, contatos, funcionários, remessas, transportadoras, devoluções e recebimentos não tinham ambiente: apareciam iguais em Mainnet e Testnet.
- As páginas operacionais (Estoque, Vendas/PDV, Compras, Logística, Clientes, Fornecedores, Funcionários) e os indicadores (Dashboard/Relatórios) usavam seletores globais.

## 2. Correções aplicadas

### Modelo de dados (`types.ts`)
- Novo tipo `Environment = NetworkId | 'unassigned'`; `AccountEnvironment` virou alias.
- `environment?: Environment` adicionado a `Product`, `StockMove`, `Contact`, `Sale`, `Employee`, `PurchaseRef`, `Shipment`, `Carrier`, `ReturnAuthorization`, `GoodsReceipt`.

### Criação com ambiente (`store.tsx` + módulos de logística)
- `addProduct`, `moveStock`, `addContact`, `recordSale`, `recordPurchase`, `addEmployee` gravam `environment: getNetwork()`.
- Logística (`logistics.createShipment`, `carriers.createCarrier`, `returns.requestReturn`, `returns.createReturnShipment`, `receiving.receiveGoods`) recebem um parâmetro `env` (o store passa `getNetwork()`; `unassigned`/evidência é herdada quando aplicável).
- `runPayroll` só gera folha para funcionários do ambiente ativo.
- `loadDemo` marca todas as entidades de demonstração com o ambiente selecionado.

### Migração segura e idempotente (`store.tsx`)
- `migrateErpEnvironments(data)`: vendas herdam o ambiente da conta vinculada (evidência confiável); demais entidades ficam `unassigned`. Nunca infere pela rede selecionada; nunca duplica/apaga.
- Encadeada em `load()` após `migrateAccountEnvironments`.

### Seletores centralizados (`selectors.ts`)
- `scopedByEnvironment(list, network)` + seletores por entidade (`productsForEnvironment`, `salesForEnvironment`, `contactsForEnvironment`, `employeesForEnvironment`, `purchasesForEnvironment`, `shipmentsForEnvironment`, `carriersForEnvironment`, `returnsForEnvironment`, `receiptsForEnvironment`, `movesForEnvironment`).
- Indicadores por ambiente: `kpisForEnvironment`, `stockValueForEnvironment`, `lowStockForEnvironment`, `topProductsForEnvironment`, `monthlySeriesForEnvironment` (receita/custo/estoque por ambiente; lançamentos do razão permanecem globais).

### Páginas isoladas
- Estoque, Vendas/PDV, Compras, Logística (incluindo CarriersPanel/ReturnsPanel), Clientes, Fornecedores, Funcionários, Dashboard, Relatórios e Assistente usam os seletores por ambiente.
- `Dashboard`/`Reports`/`AssistantPanel` passam a usar KPIs por ambiente.

### Integridade das operações (P0.9)
- `recordSale` e `recordPurchase` validam (no store) que produtos/cliente/fornecedor pertencem ao ambiente atual e rejeitam operações entre ambientes.

### Reclassificação manual (P0.2)
- Ação `setRecordEnvironment(kind, id, environment)` (auditada via `record.classified`) e componente `EnvironmentReview` (em Configurações) para revisar registros legados `unassigned`, reutilizando o padrão da Fase 3.2.5. Bloqueia registros já classificados e vendas com evidência conflitante.

## 3. Preservado sem alteração

- Contabilidade (razão, partidas dobradas, auditoria), Finance, Treasury, Circle Gateway, Ledger, Agents, Chatbot, autenticação e configurações.
- Arc Mainnet (`5042`) padrão; Arc Testnet (`5042002`) selecionável.
- PT/EN, Light/Dark, responsividade.

## 4. Testes

Novos (5, em `tests/environment-isolation.test.ts`):
- `scopedByEnvironment` separa por ambiente e exclui `unassigned`.
- Seletores por entidade respeitam o ambiente.
- Migração ERP: venda herda ambiente da conta; demais ficam `unassigned`.
- Migração ERP idempotente e sem perda de registros.
- Registros já classificados preservados.

Suíte completa: **317 pass, 0 fail** (nenhuma regressão).

## 5. Riscos residuais

- **Lançamentos (Livro-Caixa/razão) são globais**: o histórico "pago" de Compras e as despesas operacionais do Dashboard continuam globais (o razão não é filtrado indiscriminadamente, conforme fases anteriores). Os valores a pagar/receber e receita/custo/estoque são por ambiente.
- A revisão manual (`EnvironmentReview`) está em Configurações; registros `unassigned` permanecem preservados mas fora das listas até classificação.
- Backend transacional ainda não implantado (exclusividade entre dispositivos — fases 3.2.3.2/3.2.4/3.2.5).

## 6. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>` (migração é aditiva/idempotente; sem perda de dados).
