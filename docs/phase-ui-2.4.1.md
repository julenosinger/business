# Fase UI 2.4.1: AI Runtime Activation & Security Hardening

**HEAD inicial:** `44d99d0` (Fase UI 2.4) · **HEAD final:** `4900d30`

Resultado: **433 testes passando** (eram 426), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma regressão em vendas, compras, folha, contabilidade, tesouraria, gateway ou blockchain.

---

## 1. Causas-raiz corrigidas

- **Transporte nunca inicializado (P1):** `createChatTransport()` existia, mas `configureChatTransport()` nunca era chamado. Criado `src/lib/ai-runtime.ts` com `initChatRuntime()` (idempotente), chamado no bootstrap (`main.tsx`). O chat agora conecta automaticamente, sem chamada manual.
- **Segredo mestre no navegador (P2):** o transporte exigia `GBOS_API_TOKEN`. Agora o servidor aceita um token de SESSÃO escopado (`GBOS_CHAT_TOKEN`) — o mestre permanece exclusivamente no servidor; o frontend usa `VITE_AI_SESSION_TOKEN` (build-time, nunca o mestre, nunca em localStorage/URLs).
- **Contagem de produtos errada (P6):** `stockSummary.totalItems` usava `data.products.length` (todos os ambientes). Corrigido para `productsForEnvironment(data, network).length`.
- **Mensagens presas em "processando" (P7):** sem timeout/cancelamento. Adicionado timeout (45s, configurável), estado `cancelled`, e `cancelResponse()`.
- **Status fictício (P4):** a UI mostrava "Conectado" com base em `transport !== null`. Agora usa verificação real via `GET /api/chat/status`.
- **Contexto não validado (P5):** o backend aceitava qualquer contexto. Agora valida estrutura (objeto não-circular) e tamanho, e trata o contexto como dado opaco não confiável.

## 2. Arquitetura final de autenticação

- **Servidor:** `GBOS_API_TOKEN` (mestre, nunca no navegador) para o ledger; `GBOS_CHAT_TOKEN` (opcional, escopado) para o chat. `authorize` aceita mestre OU sessão.
- **Frontend:** `VITE_AI_BACKEND_URL` + `VITE_AI_SESSION_TOKEN` (build-time). Sem chave → chat indisponível (honesto, sem simulação).
- **Estado real:** `GET /api/chat/status` → `{ provider }` (sem credenciais/detalhes internos).

## 3. Estratégia de inicialização do transporte

`initChatRuntime()` em `main.tsx` (idempotente) lê as variáveis de build e chama `configureChatTransport(createChatTransport({ url, token }))`. O token é mantido em memória, nunca persistido.

## 4. Estado real do provedor

- Por padrão: **indisponível** (sem `GBOS_AI_PROVIDER` + `GBOS_AI_API_KEY` → endpoint responde `unavailable` com instrução; a UI mostra "Não configurado"/"Sem provedor").
- Configurado (`openai`|`anthropic`): respostas reais; timeout (30s no servidor), limite de tokens (`max_tokens: 1000`) e de tamanho da resposta (8.000 chars).

## 5. Arquivos

**Modificados:** `server/ai.ts`, `server/chat.ts`, `server/index.ts`, `src/components/chat/ChatMessage.tsx`, `src/lib/chat.ts`, `src/lib/intelligence.ts`, `src/main.tsx`, `src/pages/Chatbot.tsx`, `tests/chat-flow.test.ts`, `tests/chat-server.test.ts`, `tests/intelligence.test.ts`.

**Criados:** `src/lib/ai-runtime.ts`, `tests/ai-runtime.test.ts`, `docs/phase-ui-2.4.1.md`.

**Não modificados:** Store/persistência, `dataRef`, `apply`/`replace`, `SaveResult`, Undo, ledger/contabilidade, tesouraria/gateway, BatchPay, contratos, RPCs, autenticação, vendas/compras/folha, navegação `ProfileIntent`, AI Agents. Arc Mainnet `5042` / Testnet `5042002` e PT/EN/Light/Dark/desktop/mobile preservados.

## 6. Testes

**Novos (7):**
- `tests/intelligence.test.ts`: contagem de itens por ambiente.
- `tests/chat-server.test.ts` (3): token de sessão escopado, rejeição de contexto inválido/circular, `status()` sem credenciais.
- `tests/chat-flow.test.ts` (2): cancelamento (`cancelled`) e timeout (`error`), sem mensagem presa.
- `tests/ai-runtime.test.ts`: `initChatRuntime` idempotente + indisponível sem configuração.

**Suíte completa:** **433 pass, 0 fail** (426 anteriores preservados).

## 7. Evidência de conversa ponta a ponta

Não há credenciais de provedor neste ambiente; a conversa real de ponta a ponta **não** foi executada contra um provedor externo. A evidência é composta por:
- Teste de integração real do transporte HTTP (`chat-client.ts` → contrato `POST /api/chat`) com `fetch` mockado do provedor.
- Testes do endpoint (`createChatApi`) com provedor injetado (resposta real, indisponível, erro, rate limit, auth escopada, contexto inválido).
- Testes do ciclo de vida do chat (envio, resposta, duplicado, troca de conversa, cancelamento, timeout).

**Pendência operacional:** validar uma conversa real contra um provedor configurado antes de declarar o chat "funcional em produção".

## 8. Limitações e riscos residuais

- Rate limiting é em memória (instância única), adequado ao deploy atual; para múltiplas instâncias seria necessário um limitador compartilhado.
- O token de sessão escopado fica no bundle de build (não é o mestre); em cenários multiusuário, recomenda-se migrar para sessão/cookie autenticado.
- Navegação por linguagem natural e execução autônoma de agentes permanecem fora do escopo (fase seguinte).

## 9. Implantação e rollback

- App: `bun install && bun run build` (com `VITE_AI_BACKEND_URL` e `VITE_AI_SESSION_TOKEN`).
- Servidor: `bun run server` (com `GBOS_API_TOKEN`, `GBOS_CHAT_TOKEN` e, opcionalmente, `GBOS_AI_PROVIDER`/`GBOS_AI_API_KEY`/`GBOS_AI_MODEL`).
- Rollback: `git revert <commit da fase>`.
