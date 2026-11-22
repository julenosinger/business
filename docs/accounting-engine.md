# Motor contábil central (Fase 2.0)

Fundação de razão contábil (partida dobrada) do Global Business OS. Esta fase entrega o motor, o plano de contas,
as regras de lançamento, auditoria, estornos, taxas, conciliação e interfaces para IA, e **integra um único fluxo real**:
os lançamentos manuais do Livro-Caixa. Todo o restante do app continua como era.

## 1. Auditoria do repositório (baseline `9b8ab0e`)

| Tema | O que existe hoje |
| --- | --- |
| Persistência | `AppData` inteiro em `localStorage` (`gbos:v1`), gravado a cada mudança de estado. IDs aleatórios de 12 caracteres (`uid()`). |
| Valores | `number` (float) arredondado a 2 casas (`round2`). Os registros **não guardam moeda**; só `settings.currency`. |
| Livro-Caixa (`entries`) | Criado por: lançamento manual (Contabilidade), venda à vista, baixa de conta (`settleAccount`), compra paga na hora, estorno de venda e recebimento de cobrança USDC. Editar/remover só pela tela de Contabilidade. |
| DRE / indicadores | Calculados em `selectors.ts` a partir de `sales` (competência) e `entries` (caixa). **Não leem o razão.** |
| Vendas | Baixam estoque na hora; à prazo criam conta a receber; baixa da conta cria `entries` (receita já reconhecida na venda). |
| Compras | Somam estoque na hora (ou aguardam recebimento); a prazo criam conta a pagar. |
| Folha | `runPayroll` cria contas a pagar (`source: 'payroll'`); pagamento = baixa de conta. |
| Logística | Frete lançado vira conta a pagar (categoria Logística), uma vez (`freight.postedAccountId`). |
| Tesouraria | `treasuryOps` é gravado depois que o SDK retorna, **sem estado de confirmação on-chain**. |

Riscos de duplicidade mapeados: (1) receita da venda a prazo reconhecida de novo no recebimento; (2) o caixa de vendas,
baixas e compras já nasce no Livro-Caixa por outros fluxos; (3) estoque de compra aguardando recebimento;
(4) operações de tesouraria sem confirmação; (5) registros do Livro-Caixa editáveis/removíveis independentemente da origem.
Por isso **só os lançamentos manuais** foram integrados nesta fase.

## 2. Arquitetura (`src/lib/accounting/`)

- `money.ts`: aritmética em **unidades menores (bigint)**, persistida como string inteira. USDC = 6 casas; BRL/USD/EUR = 2.
  Conversão FX só com taxa, origem e horário (`fxConvert`); nunca implícita. `fromNumber` é a única fronteira com `number` legado.
- `types.ts`, `chart.ts`: plano de contas **configurável e genérico** (sem regras fiscais de país). Regras usam **subtipos** de conta.
- `rules.ts`: regras de lançamento por tipo de evento (venda, recebimento, compra, pagamento, folha, frete, tesouraria, taxa, ajuste).
- `engine.ts`: `postEvent`, `settlePendingEvent`, `reverseEntry`, `registerFee`/`confirmFee`, `computeTax`, `trialBalance`,
  aprovações (`requestApproval`/`decideApproval`) e `setAdapterFlag`. Funcional e imutável: cada função devolve um novo estado.
- `adapters.ts`: converte registros do app em rascunhos de evento. Cada adaptador tem uma flag.
- `cashbook-sync.ts`: ponte do Livro-Caixa (adaptador ATIVO).
- `reconcile.ts`: conciliação Livro-Caixa x razão e importação histórica (dry-run + duplicidade).
- `service.ts`: interfaces de leitura (cópias profundas) e proposta/aprovação para futuros agentes.

Separação conceitual: **evento de negócio** (`FinancialEvent`) -> **lançamento contábil** (`JournalEntry`, partida dobrada)
-> **movimento de caixa** (continua sendo o Livro-Caixa). O motor nunca cria nem altera registros do Livro-Caixa.

## 3. Garantias

- **Partida dobrada:** débitos = créditos por lançamento (BigInt). Conta inexistente/inativa, linha inválida, menos de 2 linhas
  e conta USDC com moeda diferente de USDC são recusados. USD e USDC nunca se misturam.
- **Idempotência:** chave única por evento (`cashbook:<id>:r<rev>`, `sale:<id>:recorded`, `account:<id>:settle:<n>`, `fee:<chave>`...).
  Reenvio retorna o lançamento existente. Evento rejeitado/falho pode ser reprocessado com a mesma chave.
- **Imutabilidade:** lançamentos postados não são alterados. Correção = estorno vinculado (`reversalOf`, motivo, ator, data).
  Estorno duplo, estorno de estorno e motivo vazio são recusados.
- **Pendente/falho/confirmado:** evento `pending` não gera lançamento; `settlePendingEvent` confirma uma única vez.
  A tesouraria exige hash e estado verificado. Transferência entre carteiras próprias nunca é receita ou despesa.
- **Taxas:** `dedupeKey` por origem+tipo+referência impede lançar a mesma taxa duas vezes; estimadas não lançam; confirmar só uma vez.
  Tributos só com regra validada e vigente configurada pelo usuário (não há alíquotas padrão).
- **Moedas:** cada lançamento guarda a moeda original; balancete é separado por moeda; registros antigos sem moeda são
  **sinalizados** (`unknown_currency`) e só entram por importação explícita com moeda informada.
- **Organização:** todo evento carrega `orgId`; evento de outra organização é recusado; o balancete ignora lançamentos de outra organização.
- **IA:** agentes não postam (`agent_cannot_post`); só preparam e pedem aprovação; aprovar exige usuário humano.

### Limite conhecido (transitório)

A persistência é `localStorage`: um navegador, sem transações entre abas nem isolamento multiusuário. A atomicidade vale
**dentro de uma atualização de estado** (evento + lançamento + auditoria juntos) e o Livro-Caixa nunca falha por causa do razão
(`guardLedger`). Isso **não** equivale a consistência de produção. O razão cresce sem limite (a auditoria é limitada a 5000 registros).
Para produção: banco transacional no servidor, chave de idempotência única no banco e autenticação por usuário.

## 4. Fluxo integrado nesta fase: lançamentos manuais do Livro-Caixa

- **Novo lançamento** -> evento `cashbook.income|expense` -> lançamento (Dr Caixa/Cr Receita ou Dr Despesa/Cr Caixa). A moeda é a do app naquele momento.
- **Edição** (tipo, valor, data ou categoria) de um lançamento **que já está no razão** -> estorno + novo lançamento (revisão seguinte). Só descrição: nada muda.
- **Remoção** -> estorno vinculado. O Desfazer restaura Livro-Caixa e razão juntos.
- Registros anteriores ao razão (incluindo os de demonstração) **não** são reclassificados, lançados nem apagados.
- Feature flag: `ledger.flags.adapters.cashBook` (padrão ligado), alternável no painel "Razão contábil (beta)" da página Contabilidade.
- Mapeamento categoria -> conta: `ledger.categoryMap` (ex.: "Compra de mercadorias" -> Estoque).

## 5. Adaptadores preparados e adiados (desligados por padrão)

| Adaptador | Estado | Pré-requisito para ativar |
| --- | --- | --- |
| Vendas (`saleEvent`) | pronto, desligado | Ativar junto de `payables` para não reconhecer receita duas vezes; tratar cancelamento (estorno). |
| Contas a pagar/receber (`settlementEvent`, parcial por `sequence`) | pronto, desligado | Baixa parcial no app (hoje só total); ligar ao `settleAccount`. |
| Compras (`purchaseEvent`) | pronto, desligado | Só lança com estoque efetivado (`stockPosted`); depois do recebimento para compras que aguardam. |
| Folha (`payrollEvent`) | pronto, desligado | Definir tratamento da baixa (pagamento) e contas de encargos configuradas pelo usuário. |
| Logística (`freightEvent`) | pronto, desligado | Evitar duplicar com o lançamento em contas a pagar que já existe. |
| Tesouraria (`treasuryEvent`) | pronto, desligado | O app precisa **verificar a transação on-chain** (estado + hash) antes de lançar; taxas de rede/gateway via `registerFee`. |

Nenhum código do Circle Gateway foi alterado; `adapters.ts` não importa a camada do Gateway (há teste para isso).

## 6. Próxima fase recomendada

1. Backend com banco transacional e autenticação (substituir `localStorage` para o razão).
2. Ativar `sales` + `payables` juntos, com estorno no cancelamento e baixa parcial.
3. Verificação on-chain das operações de tesouraria (status `pending -> confirmed`) e lançamento de taxas de rede/gateway.
4. Relatórios do razão (razão por conta, balancete por período) e importação histórica guiada na interface.

---

# Fase 2.1: Razão Geral, lançamento automático e conciliação

Baseline desta fase: `9b8ab0e` + a Fase 2.0 (ainda sem commit no momento da auditoria): lint e tipos limpos, 164 testes passando.
A Fase 2.0 foi considerada segura: motor funcional/imutável, testes de idempotência, estorno e isolamento, nenhuma dependência do Gateway.

## Interface (página Contabilidade, navegação interna)

Visão geral · Livro-Caixa · Razão Geral · Plano de contas · Conciliação. A Visão geral (KPIs, DRE, categorias) e o Livro-Caixa
(tabela, filtros, edição, exclusão, CSV) são o conteúdo anterior, separado em abas, sem mudar cálculos.

- **Razão Geral:** uma linha por conta de cada lançamento (data, lançamento, origem, descrição, conta, débito, crédito, moeda,
  situação, transação relacionada). Filtros: período, conta, moeda, tipo de transação, origem, situação e busca. Paginação, CSV e
  gaveta de detalhe (linhas, vínculos com a operação de origem, taxas e histórico de auditoria). Moeda de relatório opcional: só
  converte com taxa registrada (fonte + data); sem taxa mostra "indisponível". Lançamentos nunca são alterados por isso.
- **Plano de contas:** hierárquico (grupos não recebem lançamentos). Criar, editar nome/pai, desativar, excluir. Código imutável;
  classe e tipo ficam travados quando há lançamentos ou filhas; conta com lançamentos (mesmo estornados) ou filhas nunca é excluída;
  o último subtipo ativo que as regras usam não pode ser desativado/removido. Só usuários humanos alteram o plano. Modelos por
  país: só o genérico existe (`CHART_TEMPLATES`), sem regras fiscais locais.
- **Conciliação:** painel dos lançamentos automáticos (flags), indicadores Conferido / Pendente / Divergência / Requer revisão,
  três visões de saldo USDC (Gateway lido do Circle, contábil 1020, contábil 1010; **nunca somadas**), lista de itens com filtros,
  revisão com nota e evidência, e registro/confirmação de taxas.

## Lançamento automático (`autopost.ts`)

Todas as mudanças de estado passam por um único ponto no store (`apply`). O razão é atualizado **na mesma transição**, comparando
estado anterior x novo; as ações existentes (vendas, compras, baixas, folha, tesouraria, logística) não foram reescritas.
Substituições totais (backup, demonstração, apagar tudo) não geram lançamentos. O Desfazer restaura o estado completo (inclusive o razão).

| Integração (flag) | Evento -> lançamento | Observações |
| --- | --- | --- |
| Livro-Caixa manual (`cashBook`, ligada) | entrada/saída manual | edição/remoção estornam (Fase 2.0) |
| Vendas (`sales`) | venda: Dr Caixa/AR, Cr Receita (+ Dr CMV, Cr Estoque); cancelamento estorna | venda a prazo já recebida e cancelada vai para revisão |
| Contas (`payables`) | criação manual: Dr despesa/Cr AP ou Dr AR/Cr receita; edição/remoção estornam; baixa: Dr AP/Cr caixa (ou Dr caixa/Cr AR) | inclui frete lançado (categoria Logística -> despesa de frete) |
| Compras (`purchases`) | Dr Estoque, Cr AP/caixa | só quando o estoque entra (compra "aguardando recebimento" lança no recebimento) |
| Folha (`payroll`) | apropriação Dr Folha/Cr Folha a pagar; pagamento Dr Folha a pagar/Cr caixa | |
| Tesouraria (`treasury`) | depósito = transferência interna Dr 1020/Cr 1010 | **sempre pendente** até confirmação humana |

Regras de segurança: todas as flags (exceto `cashBook`) vêm **desligadas**; cada integração só trata registros criados **depois**
de ligada; a baixa só é lançada se a obrigação estiver no razão (senão fica para revisão); a receita da venda a prazo é reconhecida
uma única vez (a baixa só movimenta ativo); a data contábil é a data do evento (não há fechamento de períodos nesta fase).
Pagamento de conta via Gateway/USDC (link de tesouraria) nasce como baixa **pendente**: o app marca a conta como paga ao retornar do SDK,
mas isso não prova liquidação on-chain. O lançamento só nasce quando um usuário confirma com hash/nota; "falha" encerra sem lançar.

## Conciliação (`reconcile-center.ts`, somente leitura)

Compara Livro-Caixa x razão (conferido, divergência de valor, duplicidade de lançamento, registro removido, candidatos a duplicata,
histórico sem moeda registrada), vendas, compras, contas, tesouraria e taxas. Nada altera saldos nem gera pagamentos: as decisões
humanas ficam em `ledger.reviews` (confirmar, falhar ou dispensar, com ator, nota e evidência) e na auditoria. O app **não verifica**
transações on-chain; a evidência é declarada por quem revisa.

## Taxas, impostos e moedas

Taxas (`registerFee`/`confirmFee`): estimadas só ficam registradas; confirmadas lançam uma vez (`dedupeKey`). Impostos: somente com regra
validada e vigente. Câmbio: `recordFxRate` guarda taxa + fonte + data; a conversão só ocorre para exibição na moeda de relatório.
USD e USDC permanecem moedas distintas; cada lançamento guarda a moeda do momento.

## Limitações e riscos remanescentes

- Persistência em `localStorage`: sem transações entre abas, sem multiusuário, sem autenticação real ("usuário" é o proprietário cadastrado).
  O razão cresce sem limite. Não é consistência de produção.
- O app não registra liquidação parcial de contas (o motor e o adaptador suportam; a interface ainda não).
- Casos deixados para revisão manual: venda a prazo já recebida e depois cancelada; envios de tesouraria sem conta vinculada;
  edição/remoção de contas de compra, venda ou folha; registros anteriores à ativação (sem moeda registrada).
- Saldo on-chain da carteira não é lido (só o saldo unificado do Gateway, quando a carteira está conectada).
- Datas contábeis seguem a data do evento; não há fechamento de período.

## Backend necessário para produção

Banco transacional com restrição única na chave de idempotência, autenticação e autorização por usuário/organização, trilha de auditoria
append-only no servidor, verificação on-chain das transações (confirmações/finalidade) e fila de eventos para os adaptadores.

## Fase 2.2 recomendada

1. Backend e autenticação (migrar o razão); 2. liquidação parcial na interface; 3. verificação on-chain automática de tesouraria
(pendente -> confirmado) e lançamento de taxas de rede/Gateway; 4. fechamento de períodos; 5. importação histórica guiada pela interface.
