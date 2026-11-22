# Fase 3.2.3: Segurança de rede da fila de pagamentos e integridade de obrigações

Baseline: `1b46148` (Fase 3.2.2). Sem regressões: **288 testes passando** (eram 286), typecheck (app + servidor)
limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz e correções

### P0.1 — Obrigação vs. intenção de pagamento
- **Modelo adotado (reuso de entidade existente):** a obrigação é o `Account` (dívida do ERP, independente de rede);
  a intenção de pagamento já é o `TreasuryOp` com `kind: 'spend'` + `accountId` + `chain`/`destChain` + `status`.
  Nenhuma entidade nova foi criada.
- Novo seletor puro `inFlightIntentEnv(accountId, ops)` identifica a intenção EM PROCESSAMENTO (pendente/ambígua/
  revisão) de uma obrigação e seu ambiente; `null` quando não há (obrigação não preparada).

### P0.2 — Comportamento correto da fila
- A fila (`Treasury.tsx`) agora filtra obrigações com intenção em processamento no **outro** ambiente (não as exibe
  como executáveis no ambiente atual), enquanto obrigações sem intenção (não preparadas) continuam visíveis.
- Contas em processamento no ambiente atual aparecem com o selo **"em processamento"** e não são selecionáveis em
  lote até a resolução.
- Nenhuma dívida é ocultada: todas as obrigações permanecem em "Contas a pagar e receber", independentemente do
  ambiente. Nenhum valor foi alterado.

### P0.3 — Prevenção de pagamento duplicado entre ambientes
- Uma intenção em processamento na Mainnet bloqueia a execução da mesma obrigação na Testnet (e vice-versa), via
  `inFlightIntentEnv`. A liquidação idempotente e a unicidade de evidência on-chain (Fases 2.9–3.1) seguem garantindo
  que a mesma transferência não liquide duas obrigações.
- **Limitação honesta:** a exclusividade durável entre dispositivos depende do backend transacional (não implantado).
  O frontend usa estado + `inflight` como otimização, não como garantia. Nada simula segurança.

### P0.4/P0.5 — Liquidação contábil segura e troca de redes
- Sem mudança: a baixa continua exigindo verificação on-chain; parciais reduzem só o valor comprovado; estornos usam
  o motor; a rede da transação assinada nunca é alterada ao trocar de ambiente. Testnet não afeta o razão de produção.

## 2. Testes (novos)

- `inFlightIntentEnv`: pendente/requer revisão → ambiente; sem intenção/falha/confirmada → `null`.

Suíte completa: **288 pass, 0 fail**.

## 3. Status (honesto)

| Item | Status |
| --- | --- |
| Obrigação vs intenção (P0.1) | IMPLEMENTADO (reuso de TreasuryOp) |
| Comportamento da fila (P0.2) | IMPLEMENTADO · TESTADO |
| Prevenção de duplicidade entre ambientes (P0.3) | IMPLEMENTADO (frontend) · durabilidade BLOCKED (backend) |
| Liquidação contábil (P0.4) | JÁ CORRETO (Fases 2.9–3.1) |
| Troca de redes (P0.5) | JÁ CORRETO (Fases 3.2.x) |

## 4. Riscos residuais / dependências

- Exclusividade entre dispositivos (duas abas/máquinas) depende do backend transacional (não implantado). O frontend
  usa `inflight` + filtro de intenção como mitigação explícita, não como garantia de produção.
- Registros `unknown`/`invalid_environment` permanecem preservados e fora da fila executável (revisão manual).

## 5. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 3.2.3 (dados não são afetados de forma destrutiva).
