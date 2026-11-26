# FIN-04.1B.2.2A.1 — Evidence-Gated Payment Execution Integrity

**HEAD inicial:** `b51f514` · **HEAD final:** `(commit desta fase)`

Resultado: **646 testes passando** (eram 594) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO — P0 integrado; verificação on-chain (verificador independente) permanece pendente por design.**

---

## Missão

Concluir a proteção do Payment Intent com Payment Attempts persistentes, transições condicionadas a evidência, precisão monetária exata, idempotência segregada e reservas seguras — sem confirmação financeira antecipada e sem transações reais.

## Causas-raiz e correções

### P0 — Precisão monetária exata · APROVADO
- Eliminado o padrão `BigInt(Math.round(input.amount * 1_000_000))`.
- Novos helpers em `src/lib/payment-intent.ts`: `parseUsdcMinor`, `parseMinorUnits`, `validateUsdcAmount`, `UINT256_MAX` (BigInt, sem float).
- `createPaymentIntent` valida `usdcMinor` (inteiro positivo ≤ uint256) e, para USDC, a correspondência exata com `amount` via `validateUsdcAmount`.
- Reserva passa a usar `accountOutstandingMinor()` (aritmética exata de `accounting/money`, expoente por moeda) em vez de `accountOutstanding()` (float).
- Moeda original da obrigação é validada (`account.currency === input.currency`) — nunca mistura moedas.

### P0 — Payment Attempts persistentes · APROVADO
- Modelo `PaymentAttempt` + `PaymentAttemptEvent` em `types.ts`.
- `paymentAttempts` em `AppData`, `emptyData()`, `buildDemoData()`, `load()`, `parseBackup()` (chaves adicionadas a `LIST_KEYS`).
- Métodos no `Store`: `createPaymentAttempt`, `registerDepositSubmission`, `markAttemptAmbiguous`.
- Impede mais de uma tentativa executável por intenção; tentativa ambígua bloqueia nova tentativa (anti duplo-clique/duplicação).

### P0 — Validação de hashes e evidências · APROVADO
- `isValidTxHash` / `normalizeTxHash` (64 hex, não-zero, lowercased).
- `registerDepositSubmission` rejeita hash inválido e hash reutilizado entre tentativas.
- Confirmação técnica (`ONCHAIN_CONFIRMED`) permanece **indisponível** no fluxo real: exige `source='verifier'` + `hasVerifiedReceipt`, derivados internamente — nunca expostos à interface.

### P0 — Máquina de estados protegida · APROVADO
- `authorizeIntentTransition` (camada contextual de evidência) integrado em `transitionPaymentIntent`.
- Contexto (`IntentTransitionContext`) derivado de registros autoritativos; `source='system'`, `hasVerifiedReceipt=false`.
- `CREATED → ONCHAIN_CONFIRMED` proibido; `SUBMITTED` exige tentativa + hash; `ONCHAIN_CONFIRMED`/`AWAITING_GATEWAY_VERIFICATION` exigem verificador; release (`EXPIRED`/`CANCELED`/`FAILED`) bloqueada com submissão não resolvida ou hash sem revert verificado.

### P0 — Idempotência real das transições · APROVADO
- `transitionPaymentIntent` valida o contexto e, se `from === to`, retorna `true` sem duplicar histórico.

### P0 — Idempotência segregada · APROVADO
- `scopedIdempotencyKey` (organização + ambiente + chave) e `intentFingerprint` (parâmetros imutáveis canônicos).
- `createPaymentIntent` computa `minor` + `fingerprint` **antes** da busca idempotente; mesma chave + mesmo fingerprint → retorna a intenção; divergência → `{ ok:false, reason:'conflict' }`.
- Fingerprint persistido em `PaymentIntent.fingerprint`.

### P0 — Reservas financeiras seguras · APROVADO
- Modelo `PaymentReservation` + `paymentReservations`.
- Reserva criada na MESMA mutação da intenção (atômico local); estado `HELD`/`REQUIRES_REVIEW` continua reservando.
- `availableForReservation(outstanding, reserved)` usado no cálculo; timeout/ambiguidade/expiração/troca de ambiente **não** liberam reserva (release bloqueada por `authorizeIntentTransition`).

### P0 — Isolamento operacional · APROVADO
- `matchesIntentScope` (organização + ambiente + chain id 5042/5042002) aplicado em `createPaymentAttempt`, `registerDepositSubmission`, `markAttemptAmbiguous`.
- Comandos da interface usam o ambiente ativo; tentativas/reservas carregam `environment` imutável.
- `clearSandboxData` agora também limpa `paymentAttempts`/`paymentReservations` da Testnet, preservando Mainnet.

### Gate J — Integridade contábil · APROVADO (por construção)
- Criar intenção/tentativa/submeter depósito não liquida a obrigação, não gera caixa, não altera receita/estoque/CMV.

## Arquivos

- **Modificados:** `src/lib/payment-intent.ts`, `src/lib/types.ts`, `src/lib/store.tsx`, `src/lib/demo.ts`, `src/lib/backup.ts`.
- **Criados:** `tests/fin-04.1b.2.2a.1-precision.test.ts`, `tests/fin-04.1b.2.2a.1-intent.test.ts`.

## Testes (52 novos)

- **Precisão exata:** `parseUsdcMinor` (15, 0.000001, casas excedentes, notação científica, zero, negativo), `validateUsdcAmount`, overflow uint256.
- **Hashes:** válido/inválido/zero/reuso.
- **Máquina de estados:** bloqueio de `SUBMITTED` sem hash/tentativa; `ONCHAIN_CONFIRMED` sem verificador; cancelamento/falha com submissão não resolvida; idempotência de transição.
- **StoreProvider (caminhos reais):** bloqueio de `SUBMITTED`/`ONCHAIN_CONFIRMED`; hash inválido/reutilizado; reserva preservada em timeout ambíguo; transição sem duplicar histórico; mesma chave em ambientes distintos; recuperação após remontagem; ausência de liquidação antecipada; backup preserva intenções/tentativas/reservas; backup legado importa com arrays vazios; `clearSandboxData` preserva Mainnet e remove Testnet.

## Limitações / pendências

- **Verificador independente:** não implementado (deferido). Confirmação técnica on-chain permanece indisponível no fluxo real; `applyVerifiedPaymentEvidence`, `recoverPaymentAttempt`, `beginPaymentSubmission` e `registerApprovalSubmission` são pendências para o checkout nativo (FIN-04.1B.2.2B/2.3).
- **Gate I (validação RPC):** `eth_chainId`/`eth_getCode`/`decimals()` não executados (sem execução on-chain autorizada); não bloqueia o desenvolvimento determinístico local.
- **Conversão não-USDC:** o fluxo comercial é USDC; conversão exata de outras moedas (`fxConvert`) existe no motor contábil mas não foi conectada ao checkout nesta fase.

## Rollback

`git revert 2303b71 && git revert 36cd8c4`
