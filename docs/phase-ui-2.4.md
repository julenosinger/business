# Fase UI 2.4: Operational Intelligence & Integrated AI Chatbot

**HEAD inicial:** `2488ccb` (Fase UI 2.3.1) · **HEAD final:** `2b234dd`

Resultado: **426 testes passando** (eram 407), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma regressão em vendas, compras, folha, contabilidade, tesouraria, gateway ou blockchain.

---

## 1. Objetivo e arquitetura

O app persiste os dados empresariais (contatos, vendas, compras, folha, estoque) **apenas no navegador** (localStorage); o servidor (`server/`) possui somente o razão contábil em SQLite. Portanto:

- A **inteligência operacional** e as **ferramentas de consulta** rodam no **navegador**, sobre o Store local (somente leitura).
- O navegador envia ao servidor apenas um **contexto minimizado** (`businessContext`) — nunca o Store inteiro.
- O **servidor** autentica, valida, limita e chama o **provedor de IA** (chaves só em variáveis de ambiente), tratando o contexto como **dados opacos** (nunca como instrução).

## 2. Entregas por etapa (P11)

### 2.4-A — Intelligence Engine (P1/P4)
- `src/lib/intelligence.ts`: `businessContext`, `salesSummary`, `purchasesSummary`, `receivablesSummary`, `payablesSummary`, `stockSummary` e o objeto `businessTools` (ferramentas de leitura).
- Reusa seletores existentes (`salesForEnvironment`, `accountsForEnvironment`, `accountOutstanding`, `accountIsPartial`, `lowStockForEnvironment`, …) e o agrupamento monetário (`groupMoneyByCurrency`). **Nunca soma moedas diferentes**; registros sem moeda ficam como "unspecified"; isola Mainnet/Testnet; respeita cancelamentos e liquidações.

### 2.4-B — AI Runtime (P3)
- `server/ai.ts`: adaptador de provedor (`resolveProvider`) com `openai` e `anthropic` (endpoints públicos documentados, substituíveis por `GBOS_AI_BASE_URL`). Sem `GBOS_AI_PROVIDER` + `GBOS_AI_API_KEY` → `null` (indisponível, sem simulação).
- `server/chat.ts`: `createChatApi` com autenticação de dono único (`Bearer GBOS_API_TOKEN`), validação de payload (mensagem ≤ 4000, contexto ≤ 64 KB), rate limiting (janela deslizante) e estados de resposta tipados (`ok` / `unavailable` / `error`).
- `server/index.ts`: rota `POST /api/chat`.

### 2.4-C — Business Tools (P4)
- `businessTools` + `businessContext` fornecem as consultas autorizadas de leitura; o servidor não acessa o Store nem o banco de dados empresarial.

### 2.4-D — Integrated Experience (P2/P5/P7)
- `src/lib/chat-client.ts`: transporte HTTP real (`fetch`).
- `src/lib/chat.ts`: `send(texto, contexto)` agora anexa o usuário + placeholder do assistente e resolve a resposta assíncrona com estados `responding`/`done`/`error`/`unavailable`; proteção contra envio duplicado (`inFlight`), respostas obsoletas (`conversationId`+`messageId`) e cancelamento (abort ao remover a conversa).
- `Chatbot.tsx`: envia o contexto real, indicador Conectado/Não conectado, composer desabilitado durante a resposta.
- `ChatMessage.tsx`: spinner "Pensando…" e estilos de erro/indisponibilidade.

## 3. Arquivos

**Modificados:** `server/index.ts`, `src/components/chat/ChatComposer.tsx`, `src/components/chat/ChatMessage.tsx`, `src/lib/chat.ts`, `src/pages/Chatbot.tsx`, `tests/agents-ui.test.ts`.

**Criados:** `server/ai.ts`, `server/chat.ts`, `src/lib/chat-client.ts`, `src/lib/intelligence.ts`, `tests/chat-flow.test.ts`, `tests/chat-server.test.ts`, `tests/intelligence.test.ts`, `docs/phase-ui-2.4.md`.

**Não modificados:** Store/persistência, `dataRef`, `apply`/`replace`, `SaveResult`, Undo, contabilidade/ledger, tesouraria/gateway, BatchPay, contratos, RPCs, autenticação, vendas/compras/folha. Arc Mainnet `5042` / Testnet `5042002` e PT/EN/Light/Dark/desktop/mobile preservados.

## 4. Provedor e configuração

- Estado por padrão: **indisponível** (sem provedor/chave → o endpoint responde `unavailable` com instrução; o chat exibe "Não conectado" e orienta a configuração — nunca simula respostas).
- Configuração no servidor: `GBOS_AI_PROVIDER` (`openai`|`anthropic`), `GBOS_AI_API_KEY`, `GBOS_AI_MODEL`, `GBOS_AI_BASE_URL` (opcional).
- Configuração no cliente (runtime, em memória, nunca persistida): `configureChatTransport(createChatTransport({ url, token }))`.

## 5. Testes

**Novos (19):**
- `tests/intelligence.test.ts` (6): indicadores por moeda, cancelamentos, liquidação parcial, isolamento Mainnet/Testnet, estoque baixo, ausência de dados.
- `tests/chat-server.test.ts` (7): autenticação, indisponibilidade, resposta real (mock), validação, erro recuperável, rate limiting, `resolveProvider`.
- `tests/chat-flow.test.ts` (6): envio real, indisponível, erro, sem transporte, envio duplicado, troca de conversa.

**Suíte completa:** **426 pass, 0 fail** (407 anteriores preservados; 1 teste de chat atualizado para o novo comportamento de indisponibilidade — não removido).

## 6. Limitações

- **Provedor não configurado por padrão**: as respostas dependem de configuração do servidor; sem ela, o chat declara indisponibilidade (honesto, sem simulação).
- **Navegação contextual (P6) não ativada**: o chatbot ainda não interpreta pedidos de navegação ("Abra Vendas", "Abra o perfil deste cliente"). Os contratos existem (`ProfileIntent`/`openProfileIntent`), mas a extração segura de intenções a partir de texto livre do modelo exigiria um formato de resposta estruturado e validação de IDs — fora do escopo desta entrega, que priorizou o ciclo seguro de consulta.
- **Agentes (P8)**: preservados como configuração preliminar (pausados, sem execução); compartilham a mesma infraestrutura de consulta (`businessTools`) quando forem ativados.

## 7. Riscos residuais

- O contexto enviado ao provedor é minimizado, mas pode conter nomes/valores de clientes; o prompt de sistema orienta o modelo a tratar tudo como dado. A chave do provedor permanece exclusivamente no servidor.

## 8. Implantação e rollback

- App: `bun install && bun run build`.
- Servidor: `bun run server` (com `GBOS_API_TOKEN` e, opcionalmente, as variáveis de IA).
- Rollback: `git revert <commit da fase>`.
