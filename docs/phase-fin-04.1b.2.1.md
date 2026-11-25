# FIN-04.1B.2.1 — Institutional Gateway Configuration & Runtime Isolation

**HEAD inicial:** `ffc1914` (FIN-04.1B.2) · **HEAD final:** `7bd82b7`

Resultado: **586 testes passando** (eram 583) · typecheck (app + servidor) limpo · lint limpo · build de produção OK.

**Status: APROVADO (configuração institucional e isolamento de runtime)**

---

## Causas-raiz corrigidas

1. **`gateway-config.ts` aceitava fallback silencioso** — agora rejeita ambiente desconhecido em runtime, valida Chain ID, contratos, token e API; rejeita endereço zero; não usa Domain 26 como identificador de ambiente.
2. **Beneficiário global** (`Settings.treasuryRecipient`) — substituído por **beneficiário por ambiente** (`Settings.treasuryRecipients: Partial<Record<NetworkId, string>>`), com resolver `treasuryRecipientFor` (preferência por ambiente, fallback legado).
3. **`encodeDepositFor` sem validação** — agora valida token/depositor não-zero e valor BigInt positivo ≤ uint256.
4. **`ChargeModal` usava a carteira conectada na verificação de colisão** — corrigido para usar o **destinatário institucional efetivo**.
5. **Configurações não expunham os contratos** — nova seção **Circle Gateway — Configuração institucional** (somente leitura) em Configurações → Tesouraria, com contratos preenchidos automaticamente pelo resolver, por ambiente.

## Contratos configurados (automaticamente, por ambiente)
| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 5042 | 5042002 |
| GatewayWallet | `0x7777…0eE` | `0x0077…9B9` |
| GatewayMinter | `0x2222…C205` | `0x0022…75B` |
| USDC ERC-20 | `0x3600…` (6 dec.) | idem |
| API | produção | testes |

Resolvidos pelo registro `onchain-facts` (fonte autoritativa); endereços coincidem com os do prompt.

## Testes
- **Novos (3):** rejeição de endereço/valor inválidos em `encodeDepositFor`; rejeição de ambiente desconhecido; resolução de beneficiário por ambiente com fallback.
- **Anteriores:** 583 preservados.

## Arquivos
- **Modificados:** `gateway-config.ts`, `types.ts`, `ChargeModal.tsx`, `SettingsPage.tsx`, `tests/gateway-config.test.ts`.

## Limitações e riscos
- **Validação RPC de leitura** (bytecode/ABI/`depositFor` na versão implantada) **não foi executada** — não há execução on-chain autorizada nesta entrega; a conformidade é baseada no registro `onchain-facts` gerado pelo Arc Studio. Documentado; não declarado como validado via RPC.
- O beneficiário institucional é configurável e validado por formato (endereço não-zero), mas **não** é comprovado como "controlado pela organização" (sem backend/evidência de controle).
- O checkout comercial (`depositFor`) e a verificação independente permanecem para FIN-04.1B.2.2 / FIN-04.1C.

## Pendências anteriores (não resolvidas)
- Liquidação por valor nominal, verificação independente, reembolsos, recuperação contábil.
- Recebimento por linha de compra + contabilização proporcional.
- Falhas contábeis persistentes.

## Rollback
`git revert a664df2 && git revert 81bd088`
