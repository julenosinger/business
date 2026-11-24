# FIN-03: Financial Categories & Receivables/Payables UX

**HEAD inicial:** `0d889bc` (FIN-02) · **HEAD final:** `(commit desta fase)`

Resultado: **483 testes passando** (eram 478), typecheck (app + servidor) limpo, lint limpo, build de produção OK.

---

## Subfase concluída: FIN-03.1 — Category Foundation

### Catálogo central (P3)
- Novo `src/lib/financial-categories.ts`: fonte única da taxonomia financeira com `id` (string canônica), `labelEn`, `kind`, `group`, `nature` (receita/CMV/despesa/ativo/passivo), `accounting` (subtipo contábil), `supported` e `system`.
- `supportedCategoryIds(kind)` e `categoriesFor(kind)` derivam a lista selecionável; `categoryById` consulta o catálogo.

### Categorias ampliadas (P1/P2)
- **A receber:** receitas operacionais (venda de mercadorias/produtos, serviços, consultoria, assinaturas, comissões, licenciamento, contratos recorrentes), financeiras (juros, rendimentos, multas, descontos) e outras (aluguéis, indenizações).
- **A pagar:** custos (matéria-prima, insumos, embalagens, fretes, manutenção, terceirizados), administrativas (energia, água, internet, software, material de escritório, marketing/publicidade, consultoria, seguros, viagens), pessoal (benefícios, encargos, treinamento, reembolsos), financeiras/fiscais (impostos/tributos, taxas bancárias, juros, multas, tarifas, taxas de transação) e outras obrigações.

### Integridade contábil (P4)
- Categorias de **natureza não-receita/não-despesa** (reembolsos, restituições, créditos a recuperar, empréstimos concedidos, adiantamentos a recuperar, equipamentos, máquinas, infraestrutura, empréstimos/financiamentos, adiantamentos) estão no **catálogo com `supported: false`** e **fora dos seletores** — nunca classificadas indevidamente como receita/despesa da DRE até o motor contábil suportar a natureza específica (conforme P1/P2).
- `defaultCategoryMap` ampliado com o mapeamento contábil de cada nova categoria.

### Compatibilidade histórica (P11)
- Nenhuma categoria existente foi renomeada ou removida; os índices usados como padrão (`INCOME_CATEGORIES[0]`, `EXPENSE_CATEGORIES[2]`) são preservados.

## Arquivos

**Modificados:** `src/lib/types.ts`, `src/lib/i18n.tsx`, `src/lib/accounting/chart.ts`.

**Criados:** `src/lib/financial-categories.ts`, `tests/financial-categories.test.ts`, `docs/phase-fin-03.md`.

**Não modificados:** Store/persistência, `dataRef`, `apply`/`replace`, Undo, `SaveResult`, `autoPost`, regras contábeis (`rules.ts`), adaptadores, `environment-policy`, `ProfileIntent`, Chatbot, AI Agents, Design System. Arc Mainnet `5042` / Testnet `5042002` preservados.

## Testes

**Novos (5):** coerência entre catálogo e listas selecionáveis, mapeamento contábil completo, presença das categorias ampliadas/agrupadas, naturezas não suportadas fora dos seletores, preservação das categorias históricas.

**Suíte completa:** **483 pass, 0 fail** (478 anteriores preservados).

## Pendências (subfases seguintes)

- **FIN-03.3:** seletor pesquisável e agrupado + otimização do formulário (Finance.tsx).
- **FIN-03.4:** categorias personalizadas (Configurações) com isolamento por ambiente.
- **FIN-03.5:** validação de referências por ambiente no salvamento e políticas Sandbox.
- **FIN-03.2 (parcial):** suporte contábil para naturezas não-receita/não-despesa (subtipos de ativo/passivo e regras) — as categorias correspondentes permanecem `supported: false` até certificação.

## Limitações e riscos residuais

- O catálogo é aditivo e não altera o comportamento contábil existente; categorias de natureza especial permanecem indisponíveis nos seletores (por design, sem classificação incorreta).
- As listas `INCOME_CATEGORIES`/`EXPENSE_CATEGORIES` continuam como fonte selecionável; o catálogo adiciona metadados (grupo/natureza) sem divergência (validado por teste).

## Rollback

`git revert <commit da fase>`
