# HOTFIX FIN-02.0.1 — Purchase Independence & First Stock Entry

**HEAD inicial:** `d07cf76` (FIN-02 hotfix) · **HEAD final:** `(commit desta fase)`

Resultado: **537 testes passando** (eram 532) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

---

## Causa-raiz

`src/pages/Purchases.tsx` condicionava o formulário de compra a `products.length === 0`, impedindo iniciar as atividades comerciais com catálogo/estoque vazios. Além disso, o `addProduct` retornava `void`, impossibilitando a seleção automática do produto recém-cadastrado.

## Correções

### Independência da aba Compras
- Removido o `products.length === 0` que bloqueava o formulário (a tela agora exibe sempre "Nova compra").
- Permitido comprar com catálogo vazio, estoque zero ou positivo, à vista ou a prazo, com recebimento imediato ou posterior.

### Cadastro rápido de produto
- Opção **+ Cadastrar novo produto** no seletor de itens.
- Modal compacto (nome, SKU, categoria, unidade, custo de aquisição, preço de venda, estoque mínimo), reutilizando `addProduct` + `Field`/`inputCls` e as mesmas regras de validação do Estoque.
- Produto cadastrado com **quantidade zero** — sem movimentação financeira, receita, despesa ou lançamento patrimonial.
- `addProduct` agora retorna o `id` (backward-compatible; chamadores que ignoram o retorno seguem funcionando).
- Após salvar: seleciona automaticamente o produto na linha de origem e preenche o custo de aquisição, preservando fornecedor e demais itens.

### Integridade do estoque e custo médio (preservado)
- Nenhuma mudança em `costing.ts`/`recordPurchase`/`receiveGoods`: o custo médio ponderado do HOTFIX FIN-02 segue intacto.
- Compra com recebimento imediato soma o estoque uma única vez e recalcula o custo médio; aguardando recebimento não soma estoque antecipadamente; pagamento de fornecedor nunca reestoca.

## Cenário de certificação (reproduzido por teste real do Store)
Começando do zero (catálogo vazio, Testnet, adapters habilitados): cadastrar produto → comprar 100@5 + 20@6 a prazo → vender 30@8 → liquidar obrigações → despesa 10.

| Indicador | Esperado | Resultado |
|---|---|---|
| Total de compras | 620 | ✅ |
| Estoque antes da venda | 120 | ✅ |
| Custo médio | ~5,1667 | ✅ |
| Estoque final / valor | 90 / 465 | ✅ |
| Receita / CMV / lucro bruto | 240 / 155 / 85 | ✅ |
| Despesas / lucro líquido | 10 / 75 | ✅ |
| Margem líquida | 31,25% | ✅ |
| Entradas / saídas / fluxo | 240 / 630 / −390 | ✅ |
| Obrigações em aberto | 0 | ✅ |
| Débitos = créditos | balanceado | ✅ |

## Arquivos
- **Modificados:** `store.tsx` (addProduct retorna id), `Purchases.tsx` (independência + cadastro rápido).
- **Criados:** `tests/fin-02.0.1-scenario.test.ts`, `tests/purchase-independence.test.ts`.

## Testes
- **Novos (5):** formulário disponível com catálogo vazio, modal de cadastro rápido, addProduct sem movimentação, cenário integral, addProduct retorna id.
- **Anteriores:** 532 preservados.

## Limitações e riscos
- A **seleção automática** é coberta pelo cenário do Store e pelo handler `handleQuickCreated`; a simulação de digitação em inputs no happy-dom (para preencher o modal via DOM) não dispara o `onChange` do React nessa infraestrutura, então aquele trecho não é exercitado por teste de DOM — validado por código + Store.
- Nenhuma mudança no motor contábil/estoque; pendências da FIN-02.1 permanecem fora deste escopo.

## Roteiro de validação manual (Arc Testnet)
1. Abrir Compras com ambiente vazio → o formulário aparece.
2. Escolher "+ Cadastrar novo produto", informar custo 5 e preço 8, salvar → produto selecionado com custo preenchido.
3. Comprar 100@5 e 20@6 a prazo → estoque 120, custo médio ~5,17.
4. Vender 30@8 no PDV, liquidar as duas obrigações e pagar despesa de 10 → conferir números do cenário.

## Rollback
`git revert 478c490 && git revert 2e289df`
