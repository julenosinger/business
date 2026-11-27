# MAINNET-ONLY 1.1 — Complete Testnet Removal & Financial Integrity Certification

**HEAD inicial:** `fa97b67` · **HEAD final:** `dfad621`

Resultado: **726 testes passando** (eram 728) · typecheck app/servidor limpo · lint limpo · build de produção OK.

**Status: APROVADO (núcleo operacional) — Testnet completamente removida da configuração operacional (rede, blockchain, Gateway e backend) e da interface; testes de isolamento/sandbox substituídos por testes de rejeição e proteção histórica. Arquivamento físico de dados históricos e limpeza de RPCs do registry permanecem como pendências de auditoria.**

---

## Gate B — Alternância de ambiente eliminada · APROVADO
- `setNetwork` agora é um **no-op**: nenhuma função interna, preferência persistida, localStorage, cookie, parâmetro de URL, chamada à API, estado React ou conexão de carteira pode ativar Testnet. `getNetwork()` retorna sempre `mainnet`.
- `NetworkId` mantém `'testnet'` apenas como valor de CLASSIFICAÇÃO de registros históricos (campo `environment`).

## Gate C/D — Redes Testnet removidas da arquitetura operacional · APROVADO
- `src/config.ts`: cadeias wagmi reduzidas às Mainnet (`Arc`, Ethereum, Base, Arbitrum, Optimism, Avalanche, Polygon).
- `src/lib/gateway.ts`: `GATEWAY_CHAINS` agora só Mainnet; `GatewayChainId`/`key` restritos a Mainnet; `gatewayChainsFor` ignora o parâmetro.
- Arc Mainnet (chain 5042) e GatewayWallet `0x77777777…00eE` preservados.

## Gate H — Backend exclusivamente Mainnet · APROVADO
- `resolveEnvironment` rejeita `testnet` com `testnet_discontinued` em todos os endpoints de obrigações/cobranças (sem conversão silenciosa).

## Gate G — Sandbox inerte · APROVADO
- `clearSandboxData`/`loadSandboxDemo` ficam inoperantes (a rede ativa é sempre Mainnet); testes atualizados para comprovar o comportamento inerte.

## Gate M/O — Testes · APROVADO (726)
- Testes de isolamento Testnet substituídos por injeção de registros históricos via `importData` (campo `environment`), preservando a proteção histórica.
- Testes de sandbox/alternância substituídos por testes de inércia/rejeição.

## Arquivos

- **Servidor:** `server/handler.ts` (rejeição `testnet_discontinued`).
- **Frontend:** `src/lib/network.ts`, `src/lib/gateway.ts`, `src/config.ts`, `src/components/NetworkSelector.tsx`.
- **Testes:** 15 arquivos atualizados (isolamento/sandbox → rejeição/histórico).

## Pendências (auditoria, não operacionais)

- **Arquivamento físico dos registros Testnet** (separação versionada dos dados `environment='testnet'`, sem conversão) — não executado nesta fase.
- **Limpeza de RPCs/contratos Testnet do `onchain-facts`** (registry gerado) — mantidos para CLASSIFICAÇÃO de histórico; remoção estrutural adicional requer auditoria do registry.
- **Remoção física de `clearSandboxData`/`loadSandboxDemo`** do Store — mantidos como no-op para compatibilidade de interface; remoção completa em limpeza posterior.

## Rollback

`git revert 4d4ce47 && git revert 3b6a2f0`
