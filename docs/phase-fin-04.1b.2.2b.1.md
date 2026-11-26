# FIN-04.1B.2.2B.1 — Functional Checkout Backend & Treasury Account Resolution

**HEAD inicial:** `2af19fc` · **HEAD final:** `4dc759e`

Resultado: **689 testes passando** (eram 670) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO — resolução Treasury, backend compartilhado (migration + API), segurança criptográfica, criação transacional e proteção do watcher concluídos; página pública de checkout e execução on-chain permanecem dependências documentadas.**

---

## Causas-raiz e correções

### Gate A — Resolver a conta creditada pela Treasury · APROVADO
- `resolveInstitutionalGatewayContext()` resolve o `depositor` (conta institucional creditada) via `TreasuryIdentityRepository`, nunca o GatewayWallet, a carteira do operador ou do cliente.
- `settingsIdentityRepository()` adapta a infraestrutura existente: `treasuryDepositors` (opcional) com fallback para o beneficiário convencional (`treasuryRecipients`). Sem identidade autorizada → `treasury_identity_unresolved` (cobrança pendente, nunca transação inválida).

### Gate B — Backend compartilhado · APROVADO (migration + persistência)
- Migration v2 em `server/db.ts`: `payment_intents`, `payment_reservations`, `payment_attempts`, `checkout_tokens` (+ índices únicos de idempotência, hash de depósito e account). Valores monetários como `TEXT` (unidades mínimas), nunca REAL/FLOAT.

### Gate C — Segurança criptográfica · APROVADO
- Servidor: `generateCheckoutToken()` usa `randomBytes(32)` (CSPRNG) + `hashCheckoutToken()` SHA-256 (`node:crypto`). Removido FNV-1a/Math.random.
- Frontend: `createCheckoutToken()` usa `crypto.getRandomValues` + SHA-256 (viem/@noble); sem fallback criptográfico inseguro.
- Checkout público responde com `Cache-Control: no-store` e `Referrer-Policy: no-referrer`.

### Gate D — Criação transacional · APROVADO
- Servidor: `createGatewayCharge()` em UMA transação SQLite (idempotência org+env+chave; conflito de fingerprint; intenção + reserva + token). Reemissão do link não duplica intenção/reserva.
- Frontend: `createGatewayCharge()` no Store cria obrigação avulsa + intenção + reserva atomicamente (sem conta órfã em falha).

### Gate E — Cobrança parcial e múltiplas moedas · APROVADO (parcial)
- `getChargeAvailability()` (em aberto − reservado) integrado ao ChargeModal: sugere o saldo disponível, não o valor original.
- Moeda contábil = moeda original da conta (não hardcoded USDC); conversão exata via `parseExactDecimal`/`convertToUsdcMinor`.

### Gate L — Proteção do watcher legado · APROVADO
- `requiresGatewayVerification()` detecta cobranças `circle_gateway` E antigas (sem `paymentRail`) apontando para o GatewayWallet. `receiveRequest` não as liquida.

### Gate F — API · APROVADO (rotas mínimas)
- `POST /api/payment-intents` (autenticada Bearer), `GET /api/checkout/:token` (pública). Ambiente validado no servidor.

## Arquivos

- **Servidor:** `server/db.ts`, `server/api.ts`, `server/handler.ts`, `server/index.ts`, `server/payments.ts` (novo).
- **Frontend:** `src/lib/gateway-config.ts`, `src/lib/gateway-charge.ts`, `src/lib/store.tsx`, `src/lib/types.ts`, `src/components/ChargeModal.tsx`.
- **Testes:** `tests/backend-checkout.test.ts` (novo), `tests/fin-04.1b.2.2b.1.test.ts` (novo).

## Testes (19 novos)

- Backend (10): token CSPRNG/SHA-256, criação transacional, idempotência sem duplicar intenção/reserva, conflito de fingerprint, rollback sem órfãos, consulta pública mínima, `paymentReady` com depositor não resolvido, autenticação.
- Frontend (9): resolução institucional, `createGatewayCharge` atômico (parcial/avulsa/idempotência/sem órfão), token criptográfico, `requiresGatewayVerification` e proteção do watcher para cobranças antigas.

## Limitações / pendências (dependências externas)

- **Página pública `/checkout/:token` (Gate G):** não implementada na UI — requer roteamento SPA para o token e fetch de `/api/checkout/:token`. O link usa o padrão de query param existente (`/?checkout=…`), não rota de path.
- **Execução on-chain (Gates I/J/K):** `prepareGatewayDeposit`/`readPaymentRequirements` já existem e são testados, mas a assinatura voluntária da carteira do pagador e a persistência pré-assinatura no backend não foram integradas à UI. Nenhuma transação real é executada.
- **Gate M (integração visual da Treasury):** Payment Intents ainda não aparecem na seção Cobranças em USDC (só `data.requests`).
- **Sincronização da obrigação ao backend:** o cadastro financeiro permanece no AppData local; o servidor persiste a intenção recebida do cliente e não revalida o saldo da obrigação de forma independente (requer sincronização autoritativa mínima).

## Rollback

`git revert 65f1700 && git revert 9a0b447`
