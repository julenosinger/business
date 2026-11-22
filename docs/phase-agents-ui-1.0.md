# Fase AGENTS UI 1.0: Abas Agents e Chatbot

**HEAD inicial:** `df358f4` (Fase 3.2.5) · **HEAD final:** `54c5877`

Resultado: **312 testes passando** (eram 307), typecheck (app + servidor) limpo, lint limpo, build de produção OK.

---

## 1. Objetivo

Duas novas páginas (Agents e Chatbot), exclusivamente de **interface, navegação e componentes visuais**, com preparação estrutural para integrações futuras. Sem execução autônoma, sem transações financeiras por IA e sem serviços externos novos.

## 2. Arquivos criados / modificados

**Criados**
- `src/pages/Agents.tsx` — página Agents.
- `src/pages/Chatbot.tsx` — página Chatbot.
- `src/lib/agents.ts` — tipos, catálogo de especialidades e estado local (`useAgents`, `addAgent`, `removeAgent`, persistência `gbos:agents`).
- `src/lib/chat.ts` — tipos e estado local do chat (`useChat`, `chatStore`, persistência `gbos:chat`).
- `src/components/agents/catalog.tsx` — templates de agentes + ícones/tonalidades por especialidade.
- `src/components/agents/AgentCard.tsx`, `CreateAgentModal.tsx`, `AgentDetailsModal.tsx`.
- `src/components/chat/ConversationSidebar.tsx`, `ChatMessage.tsx`, `ChatComposer.tsx`, `ChatEmptyState.tsx`.
- `tests/agents-ui.test.ts` — testes de regressão.

**Modificados**
- `src/lib/nav.tsx` — novos `PageId`: `agents` e `chatbot`.
- `src/components/sidebar/nav-config.tsx` — nova seção "Inteligência artificial" com Agents (ícone `Bot`) e Chatbot (`MessageSquareText`).
- `src/App.tsx` — rotas `agents` e `chatbot`.

## 3. Descrição das duas páginas

### Agents
- Header com título "AI Agents", subtítulo, selo "Preview" e botão "Create Agent".
- Resumo (KPIs) com dados reais do estado local: Total de agentes, Ativos, Pausados e Atividade recente (último criado).
- Catálogo com 6 templates (Finance, Accounting, Treasury, Sales, Inventory, Logistics) identificados como `Template` — não operacionais.
- Cards com ícone, nome, descrição, categoria e ação "Ver detalhes".
- Filtros: Todos, Ativos, Pausados, Templates.
- Modal "Create Agent" (nome, descrição, especialidade) que deixa claro que é configuração preliminar, sem execução de IA; agentes criados nascem como `paused`.

### Chatbot
- Layout conversacional: histórico de conversas em painel recolhível (desktop) / drawer (mobile), área central de mensagens e campo de composição fixado na parte inferior.
- Indicador de agente selecionado ("Assistente geral — nenhum agente conectado").
- Estado inicial com boas-vindas e sugestões de perguntas empresariais (preenchem o campo).
- **Sem respostas fictícias:** ao enviar, apenas a mensagem do usuário é persistida; um aviso claro informa que a IA ainda não está conectada.
- Nenhuma chave de API é solicitada ou armazenada no navegador.

## 4. Funcionalidades visuais concluídas vs. ainda não conectadas

**Concluídas:** navegação, cards, filtros, modal de criação, detalhes, chat (mensagens, composição, histórico, drawer mobile, estados vazios), PT/EN, Light/Dark, responsividade.

**Não conectadas (preparação estrutural):** execução de IA, streaming, chamada de ferramentas, seleção/execução real de agentes, qualquer integração com provedor de IA.

## 5. Limites respeitados

Não foram implementados: execução de pagamentos, agentes autônomos, chamadas on-chain, lançamentos contábeis por IA, integração obrigatória com provedores, novos bancos de dados, backend de execução de ferramentas, nem dados financeiros simulados apresentados como reais.

## 6. Testes

Novos (5, em `tests/agents-ui.test.ts`):
- Catálogo expõe exatamente 6 templates (um por especialidade).
- Cada template tem nome, descrição e ícone.
- `specialtyLabel` cobre todas as especialidades.
- `addAgent` persiste agente `paused`; `removeAgent` o exclui.
- `chatStore.send` armazena apenas mensagens do usuário — **nenhuma resposta fictícia**.

Suíte completa: **312 pass, 0 fail** (nenhuma regressão).

## 7. Verificações

- typecheck (app + servidor): limpo.
- lint: limpo (exit 0).
- build de produção: OK.
- Desktop/mobile: histórico como painel (desktop) e drawer (mobile); menu lateral expandido/recolhido intacto.
- Light/Dark e PT/EN: componentes usam tokens de tema e `t()` em todos os textos.

## 8. Riscos residuais

- Nenhuma integração de IA real; o Chatbot é estritamente uma interface de preview.
- Estado de agentes e conversas é local (`localStorage`), sem sincronização entre dispositivos.

## 9. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>` (mudanças são aditivas; sem impacto em dados financeiros).
