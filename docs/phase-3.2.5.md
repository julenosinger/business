# Fase 3.2.5: Endurecimento da integridade financeira e consistência de ambiente

**HEAD inicial:** `c06e07a` (Fase 3.2.4) · **HEAD final:** `3f84a3f`

Resultado: **307 testes passando** (eram 300), typecheck (app + servidor) limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz verificadas

- O isolamento da Fase 3.2.4 estava correto, mas **não havia mecanismo de revisão manual** para obrigações legadas classificadas como `unassigned` — elas ficavam preservadas, porém invisíveis e impagáveis, sem caminho para o usuário autorizado classificá-las.
- Não havia uma ação de store para reclassificar o ambiente de uma obrigação, nem trilha de auditoria para essa decisão.
- As demais áreas (integridade de ambiente, proteção contra operações duplicadas, precisão financeira e persistência) já estavam implementadas nas fases 2.9–3.2.4; foram auditadas e preservadas sem alteração.

## 2. Correções aplicadas

### P0.2 — Recuperação segura de registros legados (`unassigned`)

- Nova ação de store `setAccountEnvironment(id, environment)` em `src/lib/store.tsx`:
  - Valida com a função pura `canClassifyEnvironment` e **revalida no estado mais recente** dentro do updater.
  - Registra a decisão na trilha de auditoria do razão (`withAudit` com a nova ação `account.classified`).
  - Retorna `ClassifyResult` (`{ ok } | { ok: false; reason }`), com mensagem localizada.
- Nova função pura `canClassifyEnvironment(account, ops, target)` em `src/lib/treasury-selectors.ts`:
  - Só reclassifica obrigações ainda `unassigned` (idempotente; bloqueia já classificadas).
  - Bloqueia liquidadas (`paid` ou liquidações parciais), com intenção ativa e com evidência on-chain de ambiente incompatível.
- Novo `AuditAction` `'account.classified'` em `src/lib/accounting/types.ts`.
- Novo componente `src/components/AccountEnvironmentReview.tsx`, integrado em `Finance.tsx`:
  - Banner discreto (só quando há `unassigned`) com contagem e botão "Revisar".
  - Modal lista cada obrigação com descrição, contato, origem, valor, vencimento e evidências on-chain disponíveis.
  - Atribuição explícita a Mainnet/Testnet com confirmação; botões desabilitados e motivo exibido quando bloqueado (liquidada, em processamento, evidência conflitante).
  - Nunca infere ambiente pela rede atualmente selecionada.

### Auditoria sem alterações (P0.1, P0.3, P0.4, P1.1, P1.2)

Confirmados e preservados:

- `environment` gravado na criação e nunca alterado silenciosamente; Mainnet (`5042`) padrão, Testnet (`5042002`) selecionável.
- Seletores centralizados usados por Dashboard, Finance, Tesouraria, Assistente e Cobranças.
- Idempotência e proteção contra duplicidade (`inflight`, `inFlightIntentEnv`, `canCancel`, `verifyAndSettle`, `event.duplicate` no motor contábil).
- Aritmética exata em unidades menores nas operações críticas (`accountOutstandingMinor`, `allocationMinor`), sem alteração do motor contábil.

## 3. Testes

Novos (7):

- `canClassifyEnvironment`: `unassigned` classificável; já classificada rejeitada; liquidada rejeitada; intenção ativa rejeitada; evidência conflitante rejeitada; inexistente rejeitada. (6)
- Alternância repetida Mainnet↔Testnet não contamina os totais (seletores puros). (1)

Suíte completa: **307 pass, 0 fail** (nenhum teste pré-existente quebrado).

## 4. Compatibilidade e riscos residuais

- Registros legados continuam preservados; os `unassigned` ganham revisão explícita sem reclassificação automática.
- Backend transacional ainda não implantado: exclusividade durável entre dispositivos segue sem garantia (documentado nas fases 3.2.3.2/3.2.4).
- Reclassificação é idempotente e auditada; nunca apaga dados nem altera lançamentos contábeis existentes.

## 5. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase 3.2.5>` (mudanças são aditivas e idempotentes; sem perda de dados).
