# MAINNET-ONLY 1.0 — Complete Testnet Removal & Production Architecture Consolidation

**HEAD inicial:** `33d25ee` · **HEAD final:** `5d3952e`

Resultado: **728 testes passando** (eram 727) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: APROVADO (núcleo operacional) — app inicializa e permanece em Mainnet, seletor Testnet removido e backend rejeita Testnet explicitamente. Remoção de RPCs/contratos/config Testnet e arquivamento de dados históricos permanecem como pendências documentadas.**

---

## Causas e correções

### Gate B/C — Remoção operacional da Testnet · APROVADO (interface + backend)
- `src/lib/network.ts`: `read()` retorna SEMPRE `mainnet` (ignora preferência antiga de Testnet); `setNetwork` permanece como API interna para classificação de dados históricos e testes de isolamento/migração.
- `src/components/NetworkSelector.tsx`: o seletor Mainnet/Testnet virou um indicador estático "Arc Mainnet" (não há mais alternância de ambiente); o clique apenas garante que a carteira conectada esteja em Arc Mainnet.
- `server/handler.ts`: `resolveEnvironment` rejeita `testnet` com `testnet_discontinued` (sem conversão silenciosa para Mainnet) nos endpoints de obrigações/cobranças.

### Gate D — Preservação da Arc Mainnet · APROVADO
- Chain ID 5042 e GatewayWallet `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` preservados (via `gatewayConfigFor('mainnet')`).
- Demais redes Mainnet preservadas (`GATEWAY_CHAINS` mantém as redes `live`).

### Gate K — Testes · APROVADO (728)
- Testes HTTP reais migrados para Mainnet; novo teste comprova rejeição de `testnet` (`testnet_discontinued`).
- Testes de isolamento Mainnet/Testnet preservados (o campo `environment` continua classificando dados históricos).

## Arquivos

- **Servidor:** `server/handler.ts`.
- **Frontend:** `src/lib/network.ts`, `src/components/NetworkSelector.tsx`.
- **Testes:** `tests/backend-checkout-http.test.ts`.

## Pendências (próximas fases desta migração)

- **Arquivamento de dados Testnet:** separar/arquivar registros `environment='testnet'` (migração versionada, sem conversão para Mainnet) — ainda não executado.
- **Remoção de RPCs/contratos/config Testnet:** `onchain-facts`, `config.ts`, `gateway.ts` e variáveis de ambiente ainda mantêm referências Testnet para CLASSIFICAÇÃO de histórico — remoção estrutural adicional fica para fase subsequente.
- **`clearSandboxData`/`loadSandboxDemo`:** fluxos de sandbox Testnet ficam inoperantes (o app não entra em Testnet), mas seus componentes ainda existem — limpeza estrutural pendente.

## Rollback

`git revert 47cc114 && git revert 11349c3`
