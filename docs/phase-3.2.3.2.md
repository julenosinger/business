# Fase 3.2.3.2: Integridade da preparação de pagamentos e cancelamento seguro

Baseline: `8f8fa6a` (Fase 3.2.3.1). Sem regressões: **291 testes passando** (eram 289), typecheck (app + servidor)
limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz e correções

### P0.1 — Bloqueio de mudança de ambiente com intenção ativa
- **Causa:** `preparePayment()` alterava `paymentNetwork` sem verificar intenções ativas em OUTRA rede.
- **Correção:** `preparePayment` agora verifica `inFlightIntentEnv` (pendente/ambígua/revisão, em QUALQUER ambiente)
  e bloqueia com mensagem clara, preservando a intenção existente. Idempotente quando a obrigação já está preparada
  para o mesmo ambiente.

### P0.2 — Preparação explícita e consistente
- Preparar é idempotente e independente de executar: só persiste `paymentNetwork` após validação de elegibilidade;
  fechar o modal sem executar não cria `TreasuryOp` nem baixa nada (já garantido nas fases anteriores).

### P0.3 — Elegibilidade centralizada (pura)
- `payEligibility(account, ops)` (cancelada/liquidada/intenção ativa/ok) e `canCancel(account, ops)`
  (manual/sem liquidações/sem intenção ativa) — funções puras reutilizadas por Preparar/Pagar/cancelamento.

### P0.4 — Cancelamento individual seguro
- `cancelAccount(id)` retorna `CancelResult` (`{ ok } | { ok: false; reason }`), valida com `canCancel` no snapshot
  e **revalida no estado mais recente** dentro do updater (defesa contra corrida). Preserva Desfazer.

### P0.5 — Cancelamento em lote consistente
- `cancelAccounts(ids)` retorna `BatchCancelResult` (`{ canceled, refused: { id, reason } }`), validando cada item.
  O `PaymentQueue` exibe total cancelado/recusado e **preserva a seleção dos itens recusados** (não limpa
  silenciosamente). Sem cliques duplicados (confirmação + resultado).

### P0.6 — Segurança entre abas/dispositivos
- Sem backend provisionado, NÃO há exclusividade durável; o frontend usa `inflight` + elegibilidade como mitigação
  explícita, sem simular segurança. Não expõe tokens nem cria endpoints fictícios.

## 2. Testes (novos)

- `payEligibility`: cancelada/liquidada/intenção ativa/ok.
- `canCancel`: manual/sem liquidações/sem intenção ativa/não encontrada.

Suíte completa: **291 pass, 0 fail**.

## 3. Status (honesto)

| Item | Status |
| --- | --- |
| Bloqueio de troca com intenção (P0.1) | IMPLEMENTADO · TESTADO |
| Preparação explícita (P0.2) | IMPLEMENTADO |
| Elegibilidade centralizada (P0.3) | IMPLEMENTADO · TESTADO |
| Cancelamento individual (P0.4) | IMPLEMENTADO (resultado + revalidação) |
| Cancelamento em lote (P0.5) | IMPLEMENTADO (resultado por item) |
| Exclusividade entre dispositivos (P0.6) | **BLOCKED** (backend) |

## 4. Riscos residuais / dependências

- Exclusividade durável entre dispositivos exige o backend transacional (Fases 2.9–3.1), ainda não implantado.
- Cancelamento é lógico (localStorage); revalidação no updater é mitigação de corrida, não garantia de produção.

## 5. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 3.2.3.2 (dados não são afetados de forma destrutiva).
