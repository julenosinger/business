# FIN-04.1B.2.2B.2 — Authoritative Checkout & End-to-End Execution

**HEAD inicial:** `29d561b` · **HEAD final:** `bb0ce2f`

Resultado: **691 testes passando** (eram 689) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO — backend financeiro autoritativo (criação da cobrança) corrigido; ChargeModal → API, checkout público e execução on-chain permanecem dependências documentadas.**

---

## Causas-raiz e correções

### Gate A/B/E — Backend financeiro autoritativo · APROVADO
- `server/payments.ts` não recebe mais `chainId`, `tokenAddress`, `gatewayWallet`, `depositor`, `currency`, `amountMinor`, `usdcMinor`, `fingerprint` ou `expiresAt` do cliente.
- Novo DTO comercial mínimo `CreateCommercialChargeInput` (`environment`, `accountId?`, `description?`, `amountDecimal`, `currency?` (avulsa), `idempotencyKey`, `companyName`).
- O servidor resolve: configuração blockchain via `gatewayConfigFor()`; valores monetários via `parseExactDecimal()`; `fingerprint` via SHA-256 (`computeChargeFingerprint`); vencimento com TTL fixo; `depositor` via config do servidor (validado com `validateBeneficiary`, nunca o GatewayWallet).

### Gate C — Sincronização autoritativa das obrigações · APROVADO (via razão)
- A obrigação é derivada do RAZÃO (`obligationOutstandingMinor`/`obligationCurrency` exportados de `settle.ts`), nunca do cliente. Obrigação ausente → `obligation_not_found`.

### Gate D — Reserva financeira transacional · APROVADO
- Validação do saldo disponível (`outstanding − reservas HELD/REQUIRES_REVIEW`) dentro da MESMA transação SQLite. Cobrança acima do saldo → `insufficient_balance`; não há reserva excedente nem conta órfã.

### Gate I — Segurança dos tokens · APROVADO (expiração individual)
- `isActiveCheckoutToken` valida a expiração do TOKEN e da INTENÇÃO separadamente. Intenção expirada não inicia pagamento, mas o comerciante continua consultando.

## Arquivos

- **Servidor:** `server/payments.ts`, `server/api.ts`, `server/index.ts`, `server/settle.ts`.
- **Testes:** `tests/backend-checkout.test.ts`.

## Testes (12 no backend)

- Rejeição de `insufficient_balance`, `obligation_not_found`, `duplicate_conflict`; idempotência sem duplicar intenção/reserva; fingerprint calculado pelo servidor; gatewayWallet/chainId resolvidos do registro (não do cliente); depositor inválido (GatewayWallet) rejeitado; token CSPRNG/SHA-256; consulta pública mínima com `paymentReady` correto.

## Limitações / pendências

- **Gate J (ChargeModal → API):** o modal ainda usa `createGatewayCharge` do Store local (local-first). Integração ao backend exige sessão de autenticação comercial no frontend (o Bearer administrativo não pode ir ao bundle) — pendente.
- **Gate L (página pública `/checkout/:token`):** não implementada na UI (requer roteamento SPA e fetch de `/api/checkout/:token`).
- **Gate K (múltiplas moedas no servidor):** cobranças não-USDC exigem cotação autoritativa do razão — pendente.
- **Gates N/O/P/Q/R (RPC, aprovação, execução, persistência pré-assinatura):** preparação (`prepareGatewayDeposit`/`readPaymentRequirements`) testada, mas execução on-chain real não integrada à UI. Nenhuma transação real executada.
- **Gate T (integração visual da Treasury):** Payment Intents do backend ainda não aparecem na seção Cobranças em USDC.
- **Gate U (contabilidade):** submissão/receipt isolado não liquida; confirmação definitiva fica para FIN-04.1B.2.3.

## Rollback

`git revert adab2d7 && git revert 0fa2182`
