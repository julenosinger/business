# FIN-04.1B.2.2B — Native Treasury Checkout & Payment Intent Integration

**HEAD inicial:** `2493c96` · **HEAD final:** `(commit desta fase)`

Resultado: **670 testes passando** (eram 661) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO — integração local (ChargeModal → Payment Intent) concluída; execução on-chain e persistência compartilhada cross-device permanecem dependências externas documentadas.**

---

## Objetivo

Integrar ChargeModal → Payment Intent → Reserva → link de checkout, preservando a Treasury e sem liquidação antecipada.

## Causas-raiz e correções

### P0 — Resolver configuração Gateway (depositor × destino) · APROVADO
- `createPaymentIntent` rejeitava o GatewayWallet porque usava `validateBeneficiary()` sobre o endereço configurado (confundindo destino com depositor).
- Novo `resolveGatewayReceivingContext()` separa: `gatewayWallet` (contrato de DESTINO, sempre do registry) de `depositor` (conta institucional CREDITADA). Config antiga com GatewayWallet → `depositor = null` (configuração pendente), nunca o contrato nem a carteira do operador.
- `createPaymentIntent` agora aceita o GatewayWallet como destino e cria a intenção com `beneficiary = ''` quando o depositor não foi resolvido (cobrança pendente com diagnóstico, nunca transação inválida).

### P0 — Integrar ChargeModal ao Payment Intent · APROVADO (parcial)
- `ChargeModal` usa `createPaymentIntent` no fluxo Gateway (destino = GatewayWallet), removendo `withTag()`, marcas aleatórias e links de transferência direta desse caminho.
- `addRequest` preservado apenas no fluxo legado (beneficiário convencional → transferência ERC20 simples).
- Sem dependência de carteira do operador; link de checkout com referência opaca.

### P0 — Preparação oficial do depósito · APROVADO
- `prepareGatewayDeposit()` codifica `depositFor(token, depositor, value)` reutilizando `encodeDepositFor`/`DEPOSIT_FOR_ABI` (ABI única, sem conflito). Destino sempre o GatewayWallet; valida depositor e configuração.
- `readPaymentRequirements()` consulta saldo/allowance (leitura exclusiva), rejeita chain divergente.

### P0 — Referência pública opaca · APROVADO
- `createCheckoutToken()` gera token opaco + hash; `checkoutUrlFor()` monta o link sem valores financeiros na URL.

### P0 — Disponibilidade de cobrança · APROVADO
- `getChargeAvailability()` = saldo em aberto − reservado (em unidades mínimas da moeda original), reutilizando `fromNumber` (sem float).

### P0 — Impedir baixa pelo watcher legado · APROVADO
- Novo `PaymentRail` (`legacy_transfer` | `circle_gateway`) em `PaymentRequest`.
- `receiveRequest` NÃO liquida cobrança `circle_gateway` (exige verificação independente); cobranças legadas continuam funcionando.

## Arquivos

- **Modificados:** `src/components/ChargeModal.tsx`, `src/lib/gateway-config.ts`, `src/lib/store.tsx`, `src/lib/types.ts`.
- **Criados:** `src/lib/gateway-charge.ts`, `tests/fin-04.1b.2.2b.test.ts`.

## Testes (9 novos)

- Resolução do contexto Gateway (destino × depositor); `prepareGatewayDeposit` (calldata decodificado, destino correto, rejeição de depositor não resolvido e configuração divergente); `readPaymentRequirements` (saldo/allowance, chain errada).
- `getChargeAvailability` (40 − 15 = 25); token opaco + link sem valores.
- `createPaymentIntent` aceita GatewayWallet (depositor pendente, token persistido); `receiveRequest` não liquida `circle_gateway` e ainda liquida legado.

## Limitações / pendências (dependências externas)

- **Persistência compartilhada cross-device:** o app é local-first (localStorage). O backend existente (`server/`) persiste apenas o razão contábil (SQLite). Persistir Payment Intents/Tentativas/Reservas e servir o checkout público exige estender o backend (rotas `POST /api/payment-intents`, `GET /api/checkout/:token`, etc.) — **não implementado nesta fase**. O link funciona no mesmo dispositivo; abrir em outro navegador requer essa infraestrutura.
- **Execução on-chain real (`depositFor` + aprovação):** preparada (`prepareGatewayDeposit`/`readPaymentRequirements`), mas **não executada** automaticamente. O checkout do cliente (página + assinatura voluntária da carteira do pagador) não foi integrado à UI.
- **Resolução do depositor institucional:** reutiliza a configuração existente; quando ela contém o GatewayWallet (legado), o depositor fica `null` e a cobrança é salva como pendente com diagnóstico específico.
- **RPC de leitura:** `eth_getBlockNumber` (legado) é usado; `eth_getCode`/`decimals()`/verificação de proxy não foram executados automaticamente (sem transação real).

## Rollback

`git revert <commit-testes> && git revert <commit-feat>`
