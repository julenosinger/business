# Fase UI 2.4.2: AI Session Security & Runtime Reliability

**HEAD inicial:** `b4841c5` (Fase UI 2.4.1) · **HEAD final:** `(commit desta fase)`

Resultado: **446 testes passando** (eram 433), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma regressão em vendas, compras, folha, contabilidade, tesouraria, gateway ou blockchain.

---

## 1. Causas-raiz

- **Token estático no bundle (P0/P1):** o frontend usava `VITE_AI_SESSION_TOKEN`, uma variável `VITE_` embutida no bundle público — não é segredo. Foi eliminada por completo.
- **Autenticação por token compartilhado:** `GBOS_CHAT_TOKEN`/Bearer não distinguia identidade nem protegia contra reuso indevido.
- **Sem sessão/revogação:** não havia expiração, revogação ou associação da sessão ao usuário autorizado.
- **Status impreciso:** a UI mostrava "Conectado" apenas por existir transporte HTTP.

## 2. Arquitetura de autenticação implementada

- **Sessão por cookie HttpOnly** (`gbos_session`): `SameSite=Lax`, `Secure` em produção (`GBOS_COOKIE_SECURE=1`), `Max-Age` 8h, ID opaco (UUID) — o JavaScript nunca lê o cookie.
- **Login**: `POST /api/auth/login` com `GBOS_LOGIN_SECRET` (servidor; distinto do `GBOS_API_TOKEN`, que permanece exclusivamente no servidor para o ledger). Sucesso → cria sessão no servidor e define o cookie.
- **Logout**: `POST /api/auth/logout` revoga a sessão e limpa o cookie.
- **Validação server-side** a cada requisição (`SessionStore.validate`), com expiração e limpeza automática.
- **CSRF**: POSTs autenticados exigem o cabeçalho `X-GBOS-CSRF` (não definível em requisição cross-site sem preflight CORS).
- **CORS**: `GBOS_ALLOWED_ORIGIN` configura a origem permitida (com `credentials`).
- **Rate limiting por sessão** (janela deslizante por identidade).
- **Isolamento**: o ledger continua autenticado APENAS pelo `GBOS_API_TOKEN` via Bearer — nunca por sessão de navegador.

### Como a sessão é criada, validada, expirada e revogada
- Criada: `login` válido → `SessionStore.create()` (UUID + expiração) → cookie `set-cookie`.
- Validada: `SessionStore.validate(id)` verifica existência e `expiresAt > now`.
- Expirada: TTL de 8h; sessões vencidas são descartadas na validação e na limpeza periódica.
- Revogada: `logout` chama `SessionStore.revoke(id)`.

## 3. Evidência de ausência de segredo no bundle

Inspeção do `dist/` gerado: **zero** ocorrências de `VITE_AI_SESSION_TOKEN`, `GBOS_CHAT_TOKEN`, `GBOS_API_TOKEN`, `GBOS_LOGIN_SECRET` ou `GBOS_AI_API_KEY`. A única variável `VITE_` remanescente é `VITE_AI_BACKEND_URL` (URL de configuração, não segredo).

## 4. Endpoints

- `POST /api/auth/login` — autentica e cria sessão (sem `GBOS_LOGIN_SECRET` → `403 login_disabled`).
- `POST /api/auth/logout` — revoga (exige CSRF).
- `POST /api/chat` — autenticado por sessão + CSRF; valida payload, contexto e aplica rate limit.
- `GET /api/chat/status` — retorna apenas `{ provider, authenticated }`, sem credenciais/detalhes.
- Ledger (`/api/ledger*`) — inalterado, Bearer mestre.

## 5. Arquivos

**Modificados:** `server/chat.ts`, `server/index.ts`, `src/lib/ai-runtime.ts`, `src/lib/chat-client.ts`, `src/pages/Chatbot.tsx`, `tests/chat-server.test.ts`.

**Criados:** `server/session.ts`, `server/handler.ts`, `tests/chat-handler.test.ts`, `tests/session.test.ts`, `docs/phase-ui-2.4.2.md`.

**Não modificados:** Store, `dataRef`, `apply`/`replace`, Undo, `SaveResult`, contabilidade/ledger, tesouraria/gateway, BatchPay, contratos, RPCs, vendas/compras/folha, `ProfileIntent`, AI Agents, sidebar, design system. Arc Mainnet `5042` / Testnet `5042002` e PT/EN/Light/Dark/desktop/mobile preservados.

## 6. Testes

**Novos (13):**
- `tests/session.test.ts` (6): criação/validação/revogação, TTL, cookie HttpOnly/SameSite/Secure, limpeza de logout, `parseCookies`.
- `tests/chat-handler.test.ts` (5): login correto/incorreto, login desabilitado, chat sem sessão (401) / sem CSRF (403) / com sessão (200), status autenticado/anon, logout revoga.
- `tests/chat-server.test.ts` (+2, reescrito p/ sessão): sessão válida/revogada, rate limit por identidade e isolamento entre sessões.

**Suíte completa:** **446 pass, 0 fail** (433 anteriores preservados — nenhum removido ou enfraquecido).

## 7. Evidência de timeout determinístico

`chat.ts` mantém: timeout configurável (`setResponseTimeout`, 45s default), cancelamento explícito (`cancelResponse` → `cancelled`), descarte de respostas tardias (guarda por `conversationId`+`messageId`), limpeza de timers (`clearTimeout`) e proteção contra rejeições não tratadas (`.catch` com AbortError). Testes cobrem cancelamento e timeout com Promise que nunca resolve.

## 8. Limitações e riscos residuais

- **Sessão em memória**: adequada ao deploy de instância única; para múltiplas instâncias seria necessário armazenamento de sessão compartilhado (documentado, sem infraestrutura nova).
- **Provedor não configurado por padrão**: sem `GBOS_AI_*`, o chat declara indisponibilidade (sem simulação). Conversa real de ponta a ponta **não** foi executada (sem credenciais); evidência coberta por mocks do provedor.
- O segredo de login (`GBOS_LOGIN_SECRET`) é digitado pelo dono uma vez no navegador para bootstrap da sessão (mantido em memória, nunca persistido); o cookie de sessão resultante é HttpOnly.

## 9. Implantação e rollback

- App: `bun install && bun run build` (com `VITE_AI_BACKEND_URL`).
- Servidor: `bun run server` (com `GBOS_API_TOKEN`, `GBOS_LOGIN_SECRET`, `GBOS_ALLOWED_ORIGIN`, `GBOS_COOKIE_SECURE=1` em produção e, opcionalmente, `GBOS_AI_*`).
- Rollback: `git revert <commit da fase>`.
