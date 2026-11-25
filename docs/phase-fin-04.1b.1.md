# FIN-04.1B.1 — Treasury-Centric Sales & Verified Financial Settlement

**HEAD inicial:** `1ba260c` (FIN-04.1B) · **HEAD final:** `f7618b1`

Resultado: **578 testes passando** (eram 574) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO (correções P0 centrais entregues; infraestrutura institucional parcial)**

---

## Causas-raiz comprovadas e correções

### 1. Liquidação pelo saldo em aberto (P6)
`receiveRequest()` usava `accountOutstanding(acc)` para liquidar a obrigação, o que baixava 40 USDC quando só 15 foram comprovados. Corrigido: liquida **exatamente** `r.fiatAmount` (valor recebido da cobrança). Saldo pendente evolui corretamente (40 → 25 → 0).

### 2. Entrada de caixa genérica fabricada (P6)
Quando a cobrança vinculada não encontrava obrigação aberta, `receiveRequest` criava uma entrada de caixa `'Serviços prestados'`. Removido: o recebimento fica preservado na cobrança (paga) e é encaminhado à conciliação, sem fabricar caixa.

### 3. Estorno indevido no cancelamento (P11)
`cancelSale()` considerava qualquer método ≠ `prazo` como reembolsável pelo total. Corrigido: o valor elegível para estorno é o **efetivamente recebido** (`accountPaidAmount` para obrigações; `total` para caixa imediato). Venda USDC não paga → cancelamento sem saída fictícia; venda parcialmente recebida → estorno só do recebido.

### 4. Destinatário institucional (P3)
`ChargeModal` usava `recipient: address` (carteira conectada). Corrigido: novo `Settings.treasuryRecipient` (Configurações) define o **endereço institucional da Treasury**; o `ChargeModal` exige esse endereço e não usa mais a carteira conectada como destinatário — com aviso claro quando ausente.

## Testes
- **Novos (4):** liquidação exata do valor recebido; ausência de entrada genérica sem obrigação aberta; cancelamento sem estorno quando não pago; estorno só do valor recebido.
- **Anteriores:** 574 preservados.

## Arquivos
- **Modificados:** `types.ts` (Settings.treasuryRecipient), `store.tsx` (receiveRequest/cancelSale), `ChargeModal.tsx` (destinatário institucional), `SettingsPage.tsx` (campo de endereço institucional).
- **Criados:** `tests/fin-04.1b.1-settlement.test.ts`.

## Limitações e riscos residuais
- **Verificação on-chain independente (backend)** — o app é local-first; a verificação financeira permanece via `PaymentWatcher`/`verifyAndSettle` no navegador. Não há backend que verifique evidências independentemente do frontend. Documentado; não declarado como produção multiusuário.
- **Destinatário institucional** é configurado manualmente; não há validação on-chain de que o endereço pertence à organização (bloqueio técnico da arquitetura atual).
- **Valores marcados (tag)** ainda é o mecanismo de identificação; a preferência por identificadores inequívocos depende da infraestrutura institucional.
- **Máquina de estados persistente** e **monitoramento em segundo plano** (recuperação sem app aberto) continuam pendentes (FIN-04.1C/D).
- **Pagamento cross-chain** não certificado.
- Testes de navegador/on-chain não executados.

## Pendências anteriores (não resolvidas)
- Recebimento individual por linha de compra e contabilização proporcional de recebimentos parciais (FIN-04.1A A2/A3).
- Falhas contábeis persistentes/recuperáveis (`catch { return next }`).

## Rollback
`git revert 9ac9224 && git revert 2f912bf`
