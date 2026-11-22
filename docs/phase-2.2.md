# Fase 2.2: integridade contábil automática, períodos, liquidações parciais e verificação

Baseline: `4cad087` (Fase 2.1). Nenhuma regressão: 219 testes passando (eram 198), build de produção OK.

Esta fase adiciona, de forma **cirúrgica e retrocompatível**, sem reescrever o motor nem o Livro-Caixa:

1. **Períodos contábeis** (aberto / revisão / fechado / reabertura autorizada).
2. **Liquidações parciais** de contas a pagar/receber.
3. **Ciclo de compras + reconciliação histórica guiada** (dry-run + aprovação).
4. **Modelo de autorização (papéis/permissões)** e **contrato de backend transacional** (desligado por padrão).
5. **Verificação on-chain** de liquidação USDC (recibo real, sem confiar em nota humana).

---

## 1. Períodos contábeis (`engine.ts`, `PeriodsTab.tsx`)

- `LedgerState.periods` guarda fechamentos explícitos por mês (`YYYY-MM`). Período ausente = aberto.
- `postEvent` e `reverseEntry` recusam lançamentos/estornos cuja data contábil cai em período **fechado**
  (erro `period_closed`, registrado na auditoria). Isso vale também para o caminho de aprovação (`prepareEntry`).
- `closePeriod` (idempotente), `setPeriodReview` (marco, não bloqueia) e `reopenPeriod` (exige motivo e
  usuário humano; registra reabertura na auditoria). Fechamento **nunca** é automático.
- O store bloqueia (com toast) adicionar/editar/remover lançamentos manuais do Livro-Caixa em período fechado,
  espelhando a checagem do motor. Vendas/compras/baixas de um mês fechado continuam registrando o fato
  (caixa/estoque/obrigação), mas o lançamento contábil é rejeitado e aparece na Conciliação — nada é lançado
  silenciosamente em período fechado.
- UI: nova aba **Períodos** na Contabilidade (listar, revisar, fechar, reabrir com motivo).

## 2. Liquidações parciais (`types.ts`, `store.tsx`, `autopost.ts`, `Finance.tsx`)

- `Account.settlements` guarda cada liquidação (`id`, `sequence`, `amount`, `date`, `treasuryTx?`).
- `settleAccountPartial(id, amount)` recusa valor acima do saldo em aberto (sem pagamento a maior) e valor
  não positivo. `settleAccount` continua sendo a baixa total (liquida o saldo restante).
- Seletors `accountPaidAmount` / `accountOutstanding` / `accountIsPartial`. Os KPIs "a pagar/a receber"
  passam a somar o **saldo em aberto** (contas parcialmente pagas não são contadas pelo total).
- `autopost` detecta cada **nova** liquidação (diff de `settlements`) e lança um evento `payable.settled`/
  `receivable.settled` com sequência única e idempotente. Liquidação legada (sem lista, só `status: 'paid'`)
  continua funcionando (baixa total na sequência 1).
- Cada liquidação cria seu movimento no Livro-Caixa (o valor parcial), evitando duplicidade de caixa.
- UI: badge "Parcial", botão "Parcial" (modal com saldo em aberto), e exibição `pago / total`.
- Conciliação: conta parcial aparece como `partial_payment` com o saldo em aberto.

## 3. Compras: ciclo e reconciliação histórica (`purchase-reconcile.ts`, `PurchaseReconciliationPanel.tsx`)

- `planPurchaseReconciliation(data)` (dry-run, somente leitura) classifica cada compra:
  `posted` (já lançada), `awaiting_receipt` (aguarda recebimento), `ready` (pronta, com evidência) e
  `requires_review` (sem evidência de pagamento ou evento rejeitado).
- Evidência exigida: conta a pagar `source: 'purchase'` correspondente, ou saída no Livro-Caixa
  (`Compra de mercadorias`) com mesmo valor/data. Sem evidência → **Requer revisão**, nunca lançada.
- `applyPurchaseReconciliation` só lança itens `ready`, com idempotência (`purchase:<id>:recorded`).
  O store **recalcula** o plano (não confia em drafts enviados pelo cliente) e aplica no estado mais recente.
- A data original da compra é preservada; a moeda é a vigente no app (registros antigos não guardam moeda —
  limitação herdada e documentada).
- `purchaseEvent` ganhou `forceEnabled`/`imported` para a importação explícita, sem afetar o adaptador normal.
- UI: painel **Contabilidade das compras** na página Compras (situação, lançamento proposto, "Ver no razão").
- Conciliação: compras sem lançamento agora aparecem como `purchase_missing` **independentemente da flag**
  (antes ficavam ocultas quando o adaptador estava desligado).

## 4. Autorização e backend (`auth.ts`, `backend.ts`)

- `auth.ts`: papéis `owner`, `accountant`, `financial_manager`, `operator`, `auditor` e permissões por papel
  (postar, estornar, aprovar, plano de contas, regras, fechar/reabrir período, revisar conciliação, taxas,
  câmbio, reconciliar compras, baixar conta, ler). `can()`/`authorize()` são puras e testáveis.
  `Actor.role?` foi adicionado (opcional, retrocompatível; ausente = `owner`).
- `backend.ts`: contrato de backend transacional (postar evento com idempotência/atomicidade/isolamento por
  organização; consultar razão). `resolveBackend` devolve backend **local** (comportamento atual) quando não
  há credenciais; com credenciais, devolve um backend remoto **disponível** cujo transporte deve ser
  implementado contra a API do servidor. **Nunca** simula persistência remota bem-sucedida.

> Limite de segurança mantido: a persistência continua `localStorage`, o "usuário" é o proprietário das
> Configurações e **não** é uma identidade autenticada. As checagens de permissão do cliente são informativas,
> não uma fronteira de segurança. A imposição real exige o backend (ver abaixo).

## 5. Verificação on-chain (`verify.ts`)

- `verifyUsdcReceipt({ chainId, txHash, expectedTo?, expectedAmountMinor? })` valida chain/hash, lê o recibo
  por RPC registrada em `onchain-facts`, confirma `success` e decodifica transferências de USDC (`Transfer`)
  para conferir token, endereço e valor. Estados: `confirmed` / `failed` / `pending` / `ambiguous`.
- `pending` e `ambiguous` **nunca** são tratados como liquidado. Não importa a SDK da Circle nem o Gateway.
- O fluxo de tesouraria continua o mesmo: baixa via USDC nasce **pendente** e só é lançada com a confirmação
  humana na Conciliação. Este módulo é a primitiva para automatizar essa confirmação na próxima fase (atrás
  da flag `treasury`), lendo o recibo em vez de confiar só na nota.

---

## Backend necessário para produção (setup)

Ainda não provisionado (sem infraestrutura). Para migrar o razão do `localStorage`:

1. Serviço HTTP com banco transacional e restrição `UNIQUE (org_id, idempotency_key)`.
2. Endpoint `POST /events` que, em **uma** transação, valida o draft, lança evento+journal+auditoria e retorna
   o `PostResult`; idempotente por chave.
3. Autenticação (sessão/JWT) com mapeamento do principal → `Role` e imposição de `ROLE_PERMISSIONS` no
   servidor para cada escrita (postar, estornar, aprovar, plano de contas, fechar/reabrir período, taxas, câmbio).
4. Isolamento por `orgId` em todas as consultas/escritas; trilha de auditoria append-only.
5. Configurar `resolveBackend({ url, token, orgId })` e implementar `postEvent`/`fetch` contra essa API.

Enquanto isso, o app segue funcional e **honesto**: nada finge ter sido gravado no servidor.

---

## Riscos conhecidos e itens adiados

- Persistência em `localStorage` (sem multiusuário/transações entre abas) — inalterada por design.
- Moeda de registros históricos: compras/vendas/contas não guardam moeda; a importação histórica usa a moeda
  vigente. A reconciliação sinaliza ambiguidade como "requer revisão".
- Verificação on-chain ainda não é acionada automaticamente na confirmação da tesouraria (primitiva pronta).
- `typecheck`/`lint` falham por motivos **pré-existentes**: falta do módulo `@circlefin/compass-chains` (script
  de deploy) e o script `lint` usa sintaxe bash incompatível com o PowerShell do Windows.

## Próxima fase recomendada

1. Provisionar o backend (seção acima) e migrar o razão.
2. Auto-confirmar liquidações de tesouraria com `verifyUsdcReceipt` (pendente → confirmado) e lançar taxas.
3. Baixa parcial de vendas a prazo já recebidas e canceladas (hoje vai para revisão manual).
4. Relatórios do razão por período (razão por conta, balancete comparativo) e importação histórica guiada
   para vendas/contas, no padrão da reconciliação de compras.
