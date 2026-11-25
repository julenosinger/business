# INV-1.0 — Professional Product Master Data & Inventory Form Integrity

**HEAD inicial:** `08387d4` (FIN-02.0.1) · **HEAD final:** `5430a91`

Resultado: **552 testes passando** (eram 537) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

---

## Modelo de dados (retrocompatível)
`Product` ganhou campos **opcionais** (sem migração destrutiva; produtos antigos permanecem intactos):
- Geral: `brand`, `manufacturer`, `subcategory`, `barcode`, `description`, `active`.
- Preços: `referenceCost` (custo de referência comercial), `wholesalePrice`.
- Estoque: `maxStock`, `reorderPoint`, `location`, `storageUnit`.
- Fornecedores: `primarySupplierId`, `alternateSupplierIds`, `supplierSku`, `purchasePrice`, `leadTimeDays`, `minOrderQty`.
- Logística: `netWeight`, `grossWeight`, `height`, `width`, `depth`, `unitsPerPackage`, `storageConditions`.
- Fiscal: `originCountry`, `hsCode`, `ncm`, `taxRef`.

`Product.cost` preserva o significado de **custo médio contábil** (imutável via cadastro).

## Política Mainnet/Testnet (centralizada em `product.ts` + `environment-policy`)
- Comum: nome obrigatório; valores monetários/quantidades finitos e não negativos (nunca NaN/Infinity).
- Mainnet: código de barras GTIN/EAN/UPC válido quando informado; SKU único por ambiente.
- Testnet (Sandbox): SKU opcional, código de barras fictício/incompleto permitido — integridade de dados preservada.

## Formulário profissional (aba Estoque)
Modal amplo com abas **Geral / Preços / Estoque / Fornecedores / Logística / Fiscal**, rodapé fixo, aviso discreto de Sandbox. Preços exibe custo de referência, custo médio (somente leitura ao editar), preço de venda, preço de atacado e margem bruta / markup calculados. Estoque mostra o método de valorização (custo médio ponderado móvel) e mantém quantidade disponível somente leitura ao editar.

## Cadastro rápido (aba Compras)
Adiciona **marca** e **custo de referência**; produto entra com quantidade zero (sem movimentação), selecionado automaticamente com o custo preenchido.

## Integridade (Store)
- `addProduct`: validação + resultado explícito (`id` ou vazio).
- `updateProduct`: resultado `boolean`; rejeita alteração de `cost`/`stock`/`environment` e edição cross-env.
- `recordPurchase`: **consolida produtos repetidos** — estoque e custo médio usam o valor total; a obrigação considera todas as linhas (auditoria preservada).

## Listagem de estoque
Pesquisa por nome/marca/SKU/código de barras; filtros por categoria, marca e status (ativos/inativos); exibe marca e status, mantendo produtos sem estoque visíveis e inativos preservados.

## Regressão do cenário FIN-02.0.1
Preservado (teste reexecutado): compras 620, estoque 90/465, receita 240, CMV 155, lucro bruto 85, lucro líquido 75, margem 31,25%, fluxo −390, obrigações zero, balancete equilibrado.

## Arquivos
- **Modificados:** `types.ts`, `costing.ts`, `store.tsx`, `Stock.tsx`, `Purchases.tsx`, `tests/purchase-independence.test.ts`.
- **Criados:** `product.ts`, `tests/product-validation.test.ts`, `tests/product-integrity.test.ts`.

## Testes
- **Novos (15):** validação de código de barras/produto/margem, addProduct/updateProduct com resultado explícito e imutabilidade, SKU duplicado, cross-env, consolidação de compra (produto repetido e novo+existente).
- **Anteriores:** 537 preservados.

## Limitações e riscos
- **Imagem do produto** não foi implementada (armazenamento local `localStorage` ficaria inchado em backups); campo reservado para fase futura com estratégia de armazenamento definida.
- **Moeda por produto** não adicionada — o app permanece single-currency (`Settings.currency`), preservando a política monetária existente.
- Categorias/marcas/unidades permanecem como texto livre (pesquisável pela listagem); seleção com autocomplete e cadastro de novos valores via dropdown é uma melhoria futura.
- Testes de navegador/on-chain não executados (não declarados como concluídos).

## Roteiro de validação manual
1. Abrir Estoque → Novo produto → navegar pelas abas, preencher marca/barcode/fornecedor; conferir margem/markup.
2. Editar um produto existente: custo médio e estoque ficam somente leitura; alterar preço/marca não muda custo/estoque.
3. Abrir Compras (catálogo vazio) → "+ Cadastrar novo produto" com marca/custo de referência.
4. Compra com duas linhas do mesmo produto → estoque/custo consolidados.

## Rollback
`git revert 5f93beb && git revert f7a965c && git revert 89ebd20 && git revert d328ea1`
