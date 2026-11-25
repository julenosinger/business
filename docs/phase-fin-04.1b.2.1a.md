# FIN-04.1B.2.1A — Gateway Configuration Integrity & Environment Hardening

**HEAD inicial:** `c284dcc` (FIN-04.1B.2.1) · **HEAD final:** `(commit desta fase)`

Resultado: **588 testes passando** (eram 586) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

**Status: APROVADO (com P0.7 — validação RPC — BLOQUEADO por indisponibilidade de execução on-chain autorizada).**

---

## Causas-raiz e correções

| # | Correção |
|---|---|
| P0.1 | `treasuryRecipientFor` agora resolve **exclusivamente por ambiente**; sem fallback legado, carteira conectada ou outro ambiente. Sem configuração → `''` (não configurado). |
| P0.2 | Novo `validateBeneficiary(address, network)`: rejeita endereço inválido/zero e os contratos GatewayWallet/GatewayMinter/USDC; não comprova controle institucional (apenas formato/compatibilidade). |
| P0.3 | `SettingsPage` sincroniza o campo de beneficiário com a rede ativa (seed por ambiente); salvamento usa o ambiente correto e não sobrescreve o outro ambiente. |
| P0.4 | Contratos oficiais (5042/5042002, GatewayWallet/Minter, USDC) mantidos somente leitura, resolvidos por `onchain-facts`. |
| P0.5 | `ChargeModal` inclui o **ambiente na chave de seed**; ao trocar de rede, restaura a rede padrão, invalida seleções e recarrega beneficiário/obrigações. Valida beneficiário antes de criar. |
| P0.6 | `withTag()` **remove o fallback** `base.raw + 100n`; retorna `null` (erro explícito) quando não há marca disponível. |
| P0.8 | `encodeDepositFor` validado com **decode round-trip** (`decodeFunctionData`) comprovando token/depositor/valor. |
| P0.9 | Nenhuma mudança financeira/contábil: configuração não confirma vendas nem altera saldos. |

## Isolamento certificado (cenário)
Beneficiário A (Mainnet) e B (Testnet): Mainnet apresenta só A; Testnet só B; alterar/remover B não afeta A; sem fallback entre ambientes; reload preserva ambas. Coberto por teste real de StoreProvider.

## Testes
- **Novos (2):** isolamento de beneficiários via Store; validação de beneficiário (endereço zero/inválido/contratos Gateway).
- **Atualizados:** teste de `treasuryRecipientFor` removendo a expectativa de fallback legado (contradizia o isolamento).
- **Anteriores:** 586 preservados.

## Arquivos
- **Modificados:** `gateway-config.ts`, `ChargeModal.tsx`, `SettingsPage.tsx`, `tests/gateway-config.test.ts`.
- **Criados:** `tests/gateway-beneficiary.test.ts`.

## Limitações e pendências
- **P0.7 (validação RPC de leitura)** — **BLOQUEADO**: `eth_chainId`/`eth_getCode`/`decimals()`/assinatura de `depositFor` **não foram executados** (sem execução on-chain autorizada nesta entrega). A conformidade dos endereços é baseada no registro `onchain-facts` gerado pelo Arc Studio. Documentado; não fabricado.
- A marca monetária (`withTag`) permanece uma solução transitória do fluxo legado; a identificação persistente virá com o checkout nativo (FIN-04.1B.2.2).
- Checkout nativo `depositFor`, verificação independente e recuperação contábil permanecem para fases seguintes.

## Rollback
`git revert f0702f1 && git revert 3cf828a`
