# Recebimento via Circle Gateway (direto, sem backend)

Fluxo isolado que permite receber USDC usando **apenas os contratos + API oficiais do Circle Gateway**
(via `@circle-fin/app-kit` → `appKit.unifiedBalance.depositFor`), **sem depender do servidor Bun**.

Não altera os fluxos existentes:

- **Legado (transferência ERC-20)** — `PaymentRequest` com `paymentRail: 'legacy_transfer'` + `PaymentWatcher`.
- **Comercial (backend)** — `/api/payment-intents` (permanece quando o backend está no ar).
- Demais módulos (Dashboard, Contabilidade, Vendas, Estoque, Tesouraria etc.) intactos.

## Como funciona

1. **Criar cobrança** — no modal **Cobrar em USDC**, marque **“Receber via Circle Gateway direto (sem backend)”**.
   - O app resolve a conta institucional creditada (`treasuryDepositors` → fallback `treasuryRecipients`) e gera
     uma `PaymentRequest` local com `paymentRail: 'gateway_direct'`, destinatário = **GatewayWallet oficial** da Arc,
     valor com **marca única** (como o fluxo legado) e um link compartilhável (`?invoice=…`).

2. **Pagar (cliente)** — na página de pagamento, o cliente conecta a carteira e clica em **Pagar**.
   - O app executa `appKit.unifiedBalance.depositFor({ depositAccount: <depositor do comerciante> })`, que chama
     `depositFor(token, depositor, value)` no contrato GatewayWallet (assinatura única, mesma rede Arc).

3. **Detecção e baixa (comerciante)** — o `PaymentWatcher` detecta o evento `Transfer` do USDC para o
   GatewayWallet com o valor marcado exato e chama `receiveGatewayDirect`, que baixa a conta a receber pelo
   valor efetivamente recebido (nunca o saldo em aberto inteiro).

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/lib/gateway-direct.ts` | Resolução/validação do depositor e contexto de recebimento direto. |
| `src/lib/invoice.ts` | `Invoice` ganha `rail`/`dp` (opcionais, compatível com links antigos). |
| `src/components/ChargeModal.tsx` | Opção “Gateway direto (sem backend)”. |
| `src/pages/PayPage.tsx` | Paga via `depositFor` quando `invoice.rail === 'gateway_direct'`. |
| `src/components/PaymentWatcher.tsx` | Baixa automática via `receiveGatewayDirect`. |
| `src/lib/store.tsx` | Novo método `receiveGatewayDirect`. |
| `src/lib/types.ts` | `paymentRail` ganha `'gateway_direct'`; `PaymentRequest.depositor`. |

## Configuração necessária

A conta institucional creditada deve estar em **Configurações** (Treasury):

- `treasuryDepositors.mainnet` (preferido) ou `treasuryRecipients.mainnet` — endereço que o Circle Gateway
  credita (não pode ser o GatewayWallet/GatewayMinter/USDC). Sem isso, a opção direta é desabilitada.

Nenhum segredo vai para o frontend. O fluxo direto não toca no backend nem em cookies de sessão.

## Como testar

### Local (sem backend)

```bash
bun run dev
```

1. Em **Configurações → Treasury**, defina `treasuryDepositors.mainnet` com uma conta institucional válida.
2. Em **Treasury → Cobrar em USDC**, marque **“Receber via Circle Gateway direto (sem backend)”**, escolha a conta,
   informe o valor e clique **Criar cobrança**.
3. Copie o link e abra em outra aba (ou carteira diferente).
4. Clique **Pagar**: deve assinar o `depositFor` e mostrar o comprovante no explorer.
5. Na aba do comerciante (com o app aberto), o `PaymentWatcher` detecta a transferência e baixa a conta automaticamente.

### Sem backend no ar

O fluxo direto funciona mesmo com o backend desligado (não há chamada a `/api/*`). O fluxo comercial
(`/api/payment-intents`) continua exibindo o erro de backend apenas se escolhido explicitamente — o novo
fluxo direto não dispara esse erro.

### Não-regressão

- Suíte completa (`bun test tests --isolate`), typecheck app/servidor, lint e build de produção verdes.
- Fluxos legado e comercial permanecem inalterados (testes existentes preservados).

## Rollback

`git revert` dos commits desta integração. Nenhum dado local (`gbos:v1`) é alterado por esta mudança.
