# Automação de compras + Logística Global

Integração do fluxo de compras com a Logística Global e correção do "Pago agora".

## O que mudou

### 1. "Aguardar recebimento" cria remessa na Logística Global

Ao registrar uma compra marcando **"Aguardar recebimento da mercadoria"**:

- A compra é criada com `stockPosted: false` (estoque ainda não muda), como antes.
- Uma **remessa de entrada** é criada automaticamente na Logística Global, ligada à compra
  (`orderRef.kind = 'purchase'`), com status **`ready`** (aguardando recebimento) e os itens da compra.
- O estoque **só** muda ao confirmar o recebimento.

### 2. "Marcar como recebido" na Logística

Na remessa de entrada ligada a uma compra, o painel de recebimento ("Conferir e receber") agora
pode ser usado direto do status `ready` (antes exigia `delivered`). Ao confirmar:

- O estoque aumenta pelas quantidades aceitas.
- O custo médio ponderado é recalculado (`receiveGoods`).
- A compra é marcada como `stockPosted: true`.
- A contabilidade é lançada automaticamente quando o adaptador `purchases` está ligado
  (`autoPost` → evento `purchase.recorded`).

### 3. "Pago agora" não liquida sem evidência

Ao registrar com **"Pago agora"**, a compra **não** é mais liquidada automaticamente:

- Antes: criava uma saída no Livro-Caixa (já "paga").
- Agora: cria uma **conta a pagar (aberta)** com vencimento hoje, que só é baixada quando houver
  liquidação real (tesouraria ou registro de pagamento).

### 4. Compra sem "Aguardar recebimento"

Continua somando estoque + custo médio imediatamente (sem remessa), e a obrigação vira conta a pagar
até ser liquidada.

## Arquivos

| Arquivo | Mudança |
|---|---|
| `src/lib/store.tsx` | `recordPurchase`: "Pago agora" vira conta a pagar; "aguardar" cria remessa automática. |
| `src/lib/receiving.ts` | `awaitingReceiptShipment` (nova); `receiveGoods` aceita `ready` para compra ligada. |
| `src/components/logistics/ReceivingPanel.tsx` | Habilita o recebimento direto de `ready` (compra ligada). |
| `src/pages/Purchases.tsx` | Textos/toasts atualizados para a nova semântica. |
| `tests/purchase-logistics.test.ts` | 5 testes novos cobrindo os dois fluxos. |

## Regressões

- Compras antigas (`PUR-0001`, etc.) continuam funcionando: nenhum campo existente mudou de tipo nem
  foi removido; `shipments`, `receipts`, `receiving` mantêm o comportamento para `delivered`.
- Suíte completa, typecheck (app + servidor), lint e build de produção verdes.

## Rollback

`git revert` dos commits desta integração.
