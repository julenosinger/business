# FIN-04.1B.2.2 — Native Circle Gateway Merchant Checkout

**HEAD inicial:** `c5b387a` (FIN-04.1B.2.1A) · **HEAD final:** `2cab3b1`

Resultado: **591 testes passando** (eram 588) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO — Gate 1 (Payment Intent) APROVADO; Gates 2–8 BLOQUEADOS (on-chain/backend).**

---

## Gate 0 — Correções residuais
- P0.1/P0.2/P0.3/P0.4 já vigentes desde FIN-04.1B.2.1A (beneficiário por ambiente, `validateBeneficiary`, `encodeDepositFor` com BigInt, `withTag` sem fallback fixo).
- P0.5 (validação RPC) permanece **não executada** (sem execução on-chain autorizada) — não bloqueia o desenvolvimento determinístico.

## Gate 1 — Payment Intent persistente · APROVADO
- `PaymentIntent` (types): `intentId`, `saleId`, `accountId`, `customerId`, `environment`, `chainId`, `token`, `gatewayWallet`, `beneficiary`, `amount`, `currency`, `usdcMinor` (BigInt string), `rate`, `createdAt`, `expiresAt`, `state`, `txHashes`, `history`.
- `PaymentIntentState` (máquina de estados): CREATED → AWAITING_WALLET → AWAITING_APPROVAL → … → ONCHAIN_CONFIRMED → AWAITING_GATEWAY_VERIFICATION, EXPIRED/FAILED/CANCELED/REQUIRES_REVIEW.
- Store: `createPaymentIntent` (valida obrigação aberta, vínculo com venda, valor positivo; campos financeiros imutáveis) e `transitionPaymentIntent` (só transição de estado + histórico).
- `AppData.paymentIntents` persistido; `clearSandboxData` isola por ambiente.
- **3 testes novos** (criação parcial 15/40, rejeição de obrigação inválida, imutabilidade nas transições).

## Gates 2–8 — BLOQUEADOS (limitações reais)
- **Checkout compartilhável** exige **backend** (endpoint público de leitura da intenção + criação autorizada) — o app é local-first, sem servidor multiusuário.
- **Execução on-chain** (`approve`, `depositFor`, receipt) e **verificação independente** exigem transações reais e RPC de escrita — não executadas nesta entrega.
- A intenção entregue é a **fundação funcional e persistente**; o checkout nativo, a atribuição verificável da evidência e a liquidação definitiva ficam para FIN-04.1B.2.3.

## Integridade financeira preservada
- Nenhuma venda é marcada como paga pela criação de intenção; conta a receber permanece pendente; sem entrada de caixa fictícia, sem duplicação de receita/estoque/CMV.
- `receiveRequest()` legado não liquida intenções Gateway pelo valor nominal.

## Arquivos
- **Modificados:** `types.ts`, `store.tsx`, `demo.ts`.
- **Criados:** `tests/fin-04.1b.2.2-intent.test.ts`.

## Limitações e riscos
- Sem atribuição verificável entre `depositFor()` e a intenção nesta fase (sem identificador comercial nativo); preparado para a próxima fase.
- Sem monitoramento persistente em segundo plano (apenas polling no navegador).
- Validação RPC não executada (documentado).

## Pendências anteriores (não resolvidas)
- Recebimento por linha de compra + contabilização proporcional.
- Falhas contábeis persistentes/recuperáveis.

## Rollback
`git revert 9a98317 && git revert 136262e`
