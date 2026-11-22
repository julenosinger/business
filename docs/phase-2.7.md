# Fase 2.7: Verificação de crédito no Gateway e integridade da moeda contábil

Baseline: `8994dd5` (Fase 2.6). Sem regressões: **252 testes passando** (eram 249), typecheck limpo, lint limpo,
build de produção OK.

**Objetivo: provar o crédito real no Gateway, isolar a moeda por conta e separar estado on-chain de estado contábil.**

---

## 1. P0 — Verificação de crédito real no Gateway (depósito)

**Defeito:** `reconcileTreasuryOp()` verificava depósitos apenas com `expectedFrom` + valor. Isso prova uma
transferência de origem, mas não que a Circle creditou o saldo unificado.

**Correção (provider-aware):** depósitos agora verificam `expectedFrom = carteira` **E** `expectedTo = GatewayWallet`
(o contrato de protocolo que credita o saldo unificado). O endereço é resolvido de `onchain-facts` por rede
(`gatewayWalletForChain` → testnet `0x0077…` / mainnet `0x7777…`). Um Transfer na origem, sozinho, não prova crédito;
sem o contrato resolvível, a operação permanece `requires_review` com motivo `gateway_wallet_unknown`.

## 2. P0 — Moeda por conta (integridade contábil)

**Defeito:** `verifyAndSettle()` usava `settings.currency` (configuração global) para alocar o pagamento, não a moeda
da obrigação original.

**Correção:**
- `Account.currency` (opcional) registra a moeda da obrigação. Definida em TODOS os pontos de criação
  (venda a prazo, compra a prazo, folha, conta manual).
- `allocationAmount` aceita `CurrencyCode | undefined`: `undefined` (legado) → `unknown_currency` (nunca adivinhada).
- Migração auditável na carga (`migrateAccountCurrencies`): contas legadas sem `currency` recebem a moeda do evento
  de obrigação no razão (`payable.created`/`receivable.created`), que registrou a moeda na criação. Sem evento,
  permanece desconhecida e exige resolução do dono.
- Alocação USDC 1:1 exata; moedas BRL/USD/EUR exigem taxa de câmbio registrada (`fx_required` se ausente).
  Exemplo: obrigação 1.000 BRL, pagamento 100 USDC, taxa 5,00 → alocação 500 BRL, saldo 500 BRL.

## 3. Separação de estados financeiros

- `status` (on-chain/Gateway): `pending | confirmed | failed | ambiguous | requires_review`.
- `accountingStatus` (contábil, novo): `unallocated | pending | partially_settled | settled | posting_failed | requires_review`.
- Confirmação on-chain com FX/moeda ausente agora vira `status: 'confirmed'` + `accountingStatus: 'requires_review'`
  (a confirmação on-chain é preservada; só a alocação contábil fica para revisão). A Atividade mostra
  "Confirmada · revisão contábil" / "Confirmada · parcial".

## 4. P1 — Polling e recuperação

- `ReconciliationCoordinator` agora **aguarda** o ciclo terminar antes de agendar o próximo (nunca sobrepõe).
- Botão **Verificar** agora cobre operações recuperáveis (`pending`, `ambiguous`, `requires_review`), oculto em
  estados terminais (`confirmed`/`failed`). RPC timeout não encalha a operação permanentemente.

## 5. Testes (novos)

- `gatewayWalletForChain`: mainnet ≠ testnet, chain desconhecida → `undefined`.
- `allocationAmount`: moeda desconhecida (legado) → `unknown_currency` (nunca adivinhada).
- Suíte completa: **252 pass, 0 fail**.

## Dependências externas restantes (honestas)

- **Backend/banco transacional**: transporte `fetch` pronto (fase 2.4), mas sem infra provisionada. Persistência
  segue `localStorage`. **Idempotência durável** (constraints únicos no banco, consistência multi-aba real) exige o
  banco; o `inflight Set` é single-runtime (documentado). `BroadcastChannel` seria apenas otimização, não substituto.
- **Status de transferência do Gateway** (`GET /v1/transfer/{id}`): a verificação usa o recibo on-chain + contrato;
  a consulta de status do provedor é a camada adicional recomendada.
- **Migração de moeda** de contas pré-razão (sem evento de obrigação) permanece pendente de resolução manual do dono.

## Implantação e rollback

- Deploy: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 2.7 (rede/tema/dados ficam no `localStorage`, não em código).

## Próxima fase recomendada

1. Provisionar o servidor REST (contrato em `backend.ts`) e migrar o razão com backup/preview/aprovação.
2. Persistir `transferId` e consultar o status do Gateway como evidência adicional de destino.
3. Resolver contas legadas sem moeda via fluxo explícito do dono (sem adivinhação).
