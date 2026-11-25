# FIN-04.1B.2 — Circle Gateway Native Merchant Settlement

**HEAD inicial:** `3efc293` (FIN-04.1B.1) · **HEAD final:** `(commit desta fase)`

Resultado: **583 testes passando** (eram 578) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

**Status: PARCIALMENTE APROVADO — Gate A (Configuração & Isolamento) APROVADO; Gates B–E BLOQUEADOS (sem execução on-chain / backend).**

---

## Gate A — Gateway Configuration & Environment Isolation · APROVADO

### Contratos e APIs validados contra o registro on-chain
Os endereços fornecidos **coincidem** com o registro gerado `onchain-facts.ts` (fonte autoritativa do Arc Studio), portanto não há divergência a corrigir:

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | `5042` | `5042002` |
| GatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| GatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` (6 decimais) | idem |
| API | `gateway-api.circle.com` | `gateway-api-testnet.circle.com` |
| Domain | 26 (compartilhado) | 26 (compartilhado) |

### Implementado
- `src/lib/gateway-config.ts`: resolver central por ambiente (`gatewayConfigFor(network)`), com `gatewayWalletForChain(chainId, network)` que **rejeita chainId de outro ambiente** (isolamento estrito — o domínio 26 nunca é usado como identificador de ambiente).
- `encodeDepositFor(token, depositor, value)`: codificação da ABI oficial `depositFor(address,address,uint256)`, com selector verificado por teste.
- **5 testes novos** (resolução por ambiente, não-compartilhamento de contratos/APIs, rejeição de chainId cruzado, encoding com selector oficial).

## Gates B–E — BLOQUEADOS (limitações reais, documentadas)

- **B (Checkout nativo com `depositFor`)** e **C (Verificação independente + liquidação)**: exigem executar transações on-chain e/ou um backend que verifique evidências independentemente do frontend. O app é **local-first** (sem backend multiusuário), e esta entrega **não executa transações reais** nem declara testes on-chain como realizados. O fluxo de checkout/verificação **não é certificado para produção**.
- **D (Contabilização/conciliação) e E (UI/certificação integrada)**: dependem dos gates B/C.

### Fundação entregue (não "apenas tipos")
- Resolver de contratos/API por ambiente (funcional e testado).
- ABI + encoding de `depositFor` (funcional e testado).
- A configuração `Settings.treasuryRecipient` (FIN-04.1B.1) permanece como destinatário institucional configurável, à espera do checkout nativo.

## Arquivos
- **Criados:** `src/lib/gateway-config.ts`, `tests/gateway-config.test.ts`.

## Limitações e riscos
- Nenhuma validação RPC de bytecode/ABI foi executada (não há execução on-chain autorizada); a conformidade é baseada no registro `onchain-facts` gerado pelo Arc Studio.
- A assinatura de `depositFor` é assumida conforme o prompt; deve ser validada na ABI da versão implantada antes de qualquer uso em produção.
- Não há verificação de "crédito Gateway disponível" independente (o saldo unificado agregado não é prova isolada de pagamento de uma venda).

## Pendências anteriores (não resolvidas)
- Recebimento individual por linha de compra e contabilização proporcional de recebimentos parciais.
- Falhas contábeis persistentes/recuperáveis.

## Rollback
`git revert 3a31efd`
