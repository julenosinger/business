# Fase 2.5: Integridade de pagamentos Mainnet e reconciliação automática

Baseline: `0e08f46` (Fase 2.4). Sem regressões: **240 testes passando** (eram 229), typecheck limpo, lint limpo,
build de produção OK.

**Objetivo: separar SUBMISSÃO de LIQUIDAÇÃO.** Uma resposta do SDK do Gateway prova que a transação foi
submetida, não que foi liquidada. Nenhuma conta é baixada apenas porque existe um hash/URL de explorer.

---

## 1. Correção P0: baixa prematura eliminada

- `TreasuryModal` e `BatchPayModal` **não chamam mais `settleAccount()`** logo após `spend()` retornar.
- A operação é registrada com `status: 'pending'` (depósitos e envios). A baixa da conta só ocorre após
  **verificação independente** (`verifyAndSettle`).
- Mensagem da fase "done" atualizada: o pagamento foi **submetido** e aguarda confirmação na rede (não mais
  "a conta foi baixada").

## 2. Máquina de estados de pagamento (`accounting/settlement.ts`)

- Estados: `created → awaiting_signature → submitted → pending → confirmed`, com desvios `failed`,
  `ambiguous` e `requires_review`. Transições validadas (`canTransition`); `confirmed`/`failed` são terminais.
- `classifyVerification`: `confirmed→confirmed`, `failed→failed`, `ambiguous→requires_review`,
  `pending→pending`. Um timeout/falha de RPC vira `requires_review`, **nunca `failed`**; um broadcast
  ambíguo **nunca** é reenviado automaticamente.
- `TreasuryOp` ganhou `status` (persistido), `settledAt` e `settlementId`.

## 3. Correção de roteamento (P0)

- Removidos os fallbacks perigosos `destChain?.key ?? 'Arc_Testnet'` (TreasuryModal e BatchPayModal).
- Rede de destino agora é **validada antes de assinar**: destino inválido retorna erro específico, nunca
  substitui silenciosamente por Testnet.
- `network.ts` ganhou `gatewayChainIdOf()` (chave do Gateway → chain id) para a verificação.

## 4. Verificação endurecida (`accounting/verify.ts`)

- `verifyUsdcReceipt` **exige evidência esperada** (remetente `expectedFrom`, destinatário `expectedTo`
  e/ou valor `expectedAmountMinor`). Sem evidência → `ambiguous` (`insufficient_evidence`), nunca `confirmed`
  só porque o recibo teve sucesso.
- `matchTransfer` agora confere remetente e destinatário (não reusa evidência de pagamento alheio).
- `pending` = sem prova ainda; `ambiguous` = erro de rede/entrada inválida. Nenhum vira `confirmed`.

## 5. Reconciliação automática (`settlement-service.ts`, `store.verifyAndSettle`)

- `reconcileTreasuryOp(op)`: valida hash, chain e valor; chama `verifyUsdcReceipt` com destinatário e valor
  exatos; classifica o resultado. Sem hash/chain/valor válidos → `requires_review`.
- `store.verifyAndSettle(opId)` (assíncrono, idempotente): verifica uma única vez e, **somente** em
  `confirmed`, baixa a conta (`settle(..., verified=true)`) e marca `settledAt`. Estados terminais não
  re-verificam nem re-baixam.
- A baixa verificada nasce **confirmada** no razão (`AccountSettlement.verified` → `confirmation: 'confirmed'`
  no `autopost`); baixas via tesouraria sem verificação continuam `pending` (revisão humana).
- O botão **Verificar** na Atividade da Tesouraria permite ao proprietário disparar a verificação manual.
  A Atividade agora mostra o status real (Pendente/Confirmada/Falhou/Requer revisão), não mais "Registrada".

## 6. Integridade contábil

- Só liquidações **confirmadas** baixam o passivo. Idempotência por sequência e por `opId` preservadas.
- Períodos fechados continuam bloqueando lançamentos/estornos (regras existentes). Estado on-chain
  permanece separado do estado de lançamento contábil.
- Preservados: compras, liquidações parciais, períodos, Livro-Caixa, DRE, Razão Geral, Conciliação.

## 7. Testes

- Novo `tests/settlement.test.ts` (11 testes): transições da máquina de estados, terminais,
  `classifyVerification` (ambiguidade ≠ falha), verificação endurecida (sem evidência → não confirma,
  hash inválido → ambíguo, `matchTransfer` com remetente), `reconcileTreasuryOp` (sem hash/chain/valor →
  `requires_review`).
- Suíte completa: **240 pass, 0 fail**.

## Dependências/riscos restantes (honestos)

- **Servidor/banco transacional**: transporte `fetch` pronto (fase 2.4), mas sem infra provisionada.
  Persistência autoritativa segue `localStorage`. Migração local→servidor (backup + preview + aprovação)
  fica pendente do provisionamento.
- **Liquidação de destino via Gateway forwarder**: a verificação usa o recibo da chain de origem + a
  transferência USDC esperada. A finalidade de entrega no destino (CCTP/Gateway) exige o ciclo de
  liquidação documentado do provedor — recomendado como próxima integração (o app mantém `pending`/
  `requires_review` quando não há prova final).
- **Polling automático em background**: o botão "Verificar" é manual. Um serviço de polling limitado
  (reconciliação automática após reload) é a próxima etapa recomendada.

## Implantação e rollback

- Deploy: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 2.5 (estado de rede/tema fica no `localStorage`, não em código).

## Próxima fase recomendada

1. Provisionar o servidor REST e migrar o razão (backup/preview/aprovação).
2. Polling automático da reconciliação (bounded, com backoff e idempotência entre reloads).
3. Integrar o ciclo de liquidação de destino do Gateway (finalidade CCTP) na verificação.
