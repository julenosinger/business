# FIN-04.1B.2.2A — Payment Intent Integrity & Security Hardening

**HEAD inicial:** `03fb6cb` (FIN-04.1B.2.2) · **HEAD final:** `01ed75a`

Resultado: **594 testes passando** (eram 591) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO — Gates A, B, C, D, J APROVADOS; E, F, G (parcial), H, I pendentes.**

---

## Causas-raiz e correções

### Gate A — Intenção autoritativa · APROVADO
`createPaymentIntent` não confia mais em chainId/token/GatewayWallet/beneficiário do chamador — resolve via `gatewayConfigFor`/`treasuryRecipientFor`/`validateBeneficiary`. Valida: obrigação receivable/aberta/não-cancelada/ambiente exato, venda existente/não-cancelada/vinculada, saldo pendente, expiração futura. Sem beneficiário configurado → `not_configured`.

### Gate B — Integridade monetária · APROVADO
Rejeita valor não-finito/≤0, `usdcMinor` não-inteiro/≤0/overflow uint256, e **divergência** entre `amount` e `usdcMinor` (para USDC, `amount×1e6 === usdcMinor`). BigInt em unidades mínimas.

### Gate C — Máquina de estados protegida · APROVADO
Novo `src/lib/payment-intent.ts`: `PAYMENT_INTENT_TRANSITIONS` explícito + `canTransitionIntent` (repetição do mesmo estado idempotente; `CREATED → ONCHAIN_CONFIRMED` proibido; terminais não revertidos). `transitionPaymentIntent` usa o grafo.

### Gate D — Idempotência e reservas · APROVADO
`idempotencyKey` persistente (mesma chave retorna a intenção; parâmetros divergentes → `conflict`). Reserva: `amount ≤ outstanding − reservado`, considerando intenções ativas (não EXPIRED/CANCELED/FAILED).

### Gate J — Integridade contábil · APROVADO (por construção)
Criar intenção/reservar/transicionar não liquida conta a receber, não cria caixa, não altera receita/estoque/CMV.

## Testes
- **Novos (3):** criação autoritativa (resolução automática), rejeição por ausência de beneficiário, divergência monetária, reservas (15+30 rejeitada; 15+25 aceita), idempotência/conflito, proibição de transição.
- **Anteriores:** 591 preservados.

## Arquivos
- **Modificados:** `types.ts`, `store.tsx`, `tests/fin-04.1b.2.2-intent.test.ts`.
- **Criados:** `src/lib/payment-intent.ts`.

## Gates pendentes / limitações
- **Gate E (Payment Attempts):** estrutura de tentativa persistente (attemptId, hashes, receipts) ainda não implementada — a intenção registra `txHashes`, mas sem entidade de tentativa dedicada.
- **Gate F (persistência):** `paymentIntents` é persistido via `AppData`/backup (aditivo); migração/validação de intenções legadas inválidas não foram auditadas em profundidade.
- **Gate G (ChargeModal):** correções de concorrência assíncrona (lock de sessão, revalidação após await) permanecem incompletas — documentadas na FIN-04.1B.2.2A anterior.
- **Gate H (isolamento):** intenções já carregam `environment` e são segregadas por `clearSandboxData`; a validação estrita de chainId em cada operação de checkout (ainda não implementado) fica para o checkout nativo.
- **Gate I (validação RPC):** `eth_chainId`/`eth_getCode`/`decimals()` **não executados** (sem execução on-chain autorizada) — não bloqueia o desenvolvimento determinístico.

## Rollback
`git revert 4a7aab5 && git revert 69b0d21`
