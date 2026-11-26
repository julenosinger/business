# FIN-04.1B.2.2A.2 — Treasury Checkout Unlock, Payment Lifecycle & Recovery Integrity

**HEAD inicial:** `902f799` · **HEAD final:** `(commit desta fase)`

Resultado: **661 testes passando** (eram 646) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: APROVADO para os requisitos locais aplicáveis — execução on-chain (verificador independente e checkout nativo) permanece pendente por design, documentada em limitações.**

---

## Objetivo

Corrigir o bloqueio do botão "Criar cobrança" no modal "Cobrar em USDC" e concluir as correções de precisão monetária, Payment Attempts, reservas, persistência e recuperação da auditoria.

## Causas-raiz e correções

### P0 — Botão "Criar cobrança" bloqueado · APROVADO
- **Causa:** `ChargeModal` usava `validateBeneficiary()` no endereço da Treasury, que é intencionalmente o contrato `GatewayWallet` (Circle Gateway). `validateBeneficiary` rejeita contratos de infraestrutura → `beneficiary.ok === false` → botão permanentemente desabilitado.
- **Correção:** novo `validateGatewayTreasury()` (gateway-config.ts) valida o GatewayWallet como destino de depósito oficial; o modal usa `destinationValid = beneficiary?.ok || gatewayValid`, aceitando tanto o GatewayWallet (fluxo Gateway) quanto um beneficiário convencional (legado). Removido o gate artificial de carteira do operador (`useAccount`) — criar cobrança não exige assinatura blockchain. Botão agora `disabled={busy}` com validações autoritativas e erros explicativos no handler (nunca bloqueio silencioso).

### P0 — Separação GatewayWallet × beneficiário · APROVADO
- `resolveTreasuryReceivingConfig()` separa `gatewayWallet` (contrato, destino do depósito) de `beneficiary` (carteira convencional). Config antiga com GatewayWallet no campo beneficiário → `beneficiary = null` (configuração pendente, registro legado preservado).
- Endereços da Treasury **preservados** e validados por teste: Mainnet `0x77777777…00eE` (chain 5042), Testnet `0x0077777d…A19B9` (chain 5042002).

### P0 — Precisão monetária sem arredondamento · APROVADO
- Removido `input.amount.toFixed(6)` (float). Novo `parseExactDecimal(value, decimals)` (BigInt, rejeita precisão excessiva/notação científica/overflow).
- `convertToUsdcMinor()` converte moeda original → USDC (6 casas) por cotação exata, arredondando para cima.

### P0 — Separar moeda contábil de USDC · APROVADO
- `PaymentIntent`/`PaymentReservation` agora registram `amountMinor` (moeda contábil) separado de `usdcMinor` (on-chain). A reserva usa `amountMinor`; a transação blockchain usa `usdcMinor`. Fingerprint inclui `amountMinor` e `usdcMinor` separadamente. Moeda não-USDC exige `amountDecimal` + `rate` (sem conversão 1:1).

### P0 — Imutabilidade dos hashes · APROVADO
- `registerDepositSubmission` agora: repetição idempotente não duplica histórico; hash diferente não sobrescreve o original (`hash_conflict`); exige submissão iniciada (`AWAITING_SIGNATURE`/`AMBIGUOUS` + `submissionStartedAt`); impede reuso entre tentativas.

### P0 — Persistência pré-assinatura · APROVADO
- Novo `beginPaymentSubmission(attemptId, payer)`: valida escopo/pagador/estado/expiração e persiste `submissionStartedAt` + `AWAITING_SIGNATURE` antes da chamada externa.

### P0 — Ciclo de vida das tentativas · APROVADO
- `createPaymentAttempt` rejeita intenção terminal/expirada, reserva inexistente/liberada, obrigação cancelada, configuração incompatível e tentativa anterior não resolvida (`attemptBlocksRetry`).

### P0 — Liberação atômica de reservas · APROVADO
- `transitionPaymentIntent` agora encerra, na mesma mutação: estado da intenção, tentativas não transmitidas (canceladas) e a reserva (via `canReleaseReservation`). Expiração/cancelamento seguros liberam a reserva; timeout/ambiguidade/submissão não liberam.

### P0 — ChargeModal e concorrência assíncrona · APROVADO
- `busyRef` (lock anti duplo clique) + `sessionRef` (invalida sessões obsoletas ao trocar ambiente/obrigação/fechar). Revalidação após `getBlockNumber()`. RPC exclusivamente de leitura; indisponibilidade não impede a cobrança (`fromBlock` cai para `0`).

### P0 — Preservar evidências Testnet · APROVADO
- `clearSandboxData` agora distingue operações Testnet reais (transmitidas/ambíguas) de rascunhos/demonstração, preservando intenções/tentativas/reservas/obrigações reais com integridade referencial (sem registros órfãos).

### P1 — RPC exclusivamente de leitura · PARCIAL (por design)
- `eth_getBlockNumber` (leitura) já era usado no ChargeModal; agora com fallback. Consultas adicionais (`eth_getCode`, `decimals()`, ABI `depositFor`) não são executadas automaticamente no desenvolvimento (sem transação real). A ABI oficial `DEPOSIT_FOR_ABI` já está em `gateway-config.ts`.

## Arquivos

- **Modificados:** `src/components/ChargeModal.tsx`, `src/lib/gateway-config.ts`, `src/lib/payment-intent.ts`, `src/lib/store.tsx`, `src/lib/types.ts`, `tests/fin-04.1b.2.2a.1-intent.test.ts`.
- **Criados:** `tests/fin-04.1b.2.2a.2.test.ts`.

## Testes (15 novos + 5 adaptados)

- Preservação dos endereços GatewayWallet; `validateGatewayTreasury`; separação gateway/beneficiário.
- `parseExactDecimal`/`convertToUsdcMinor` (BRL 500 @ rate 5 = 100 USDC, arredondamento); `validateExecutionMode`; `attemptBlocksRetry`/`canReleaseReservation`.
- Store: reserva em moeda original (BRL 500 → `amountMinor` 50000); precisão excessiva/divergência rejeitadas; hash imutável + replay idempotente; `beginPaymentSubmission`; tentativa para intenção cancelada; cancelamento/expiração seguros liberam reserva; `clearSandboxData` preserva operações Testnet reais.

## Limitações / pendências

- **Verificador independente / checkout nativo:** não implementado (deferido a FIN-04.1B.2.2B/2.3). Confirmação on-chain (`ONCHAIN_CONFIRMED`) permanece indisponível no fluxo real.
- **Execução do depósito oficial (`depositFor`):** o ChargeModal cria a cobrança; a execução do pagamento pelo pagador usa o fluxo legado (detecção de `Transfer`). A migração para `depositFor` (crédito do beneficiário) é pendência documentada.
- **Rascunho comercial "Configuração pendente":** modelado como `beneficiary = null` em `resolveTreasuryReceivingConfig`; persistência de rascunho dedicado fica para o checkout nativo.

## Rollback

`git revert <commit-testes> && git revert <commit-feat>`
