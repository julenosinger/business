# Fase 3.2: Circle Gateway Mainnet, isolamento de redes e ativação multichain

Baseline: `50a73e5` (Fase 3.1). Sem regressões: **280 testes passando** (eram 276), typecheck (app + servidor)
limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz e correções

### P0.1 — Identificação do ambiente (badge hardcoded)
- **Causa:** `TreasuryHeader.tsx` exibia o texto fixo `Circle Gateway · Testnet`.
- **Correção:** o badge agora usa `useNetwork()` e reflete o ambiente real — `Circle Gateway · Mainnet` ou
  `Circle Gateway · Testnet` — sem texto fixo.

### P0.2/P0.4 — Isolamento completo e redes suportadas
- **Causa:** `GATEWAY_CHAINS` misturava Mainnet (Arc) e Testnets, e os seletores iteravam TODAS as redes,
  mostrando redes do ambiente anterior.
- **Correção:**
  - Registro central expandido com todas as redes EVM oficialmente suportadas pelo Circle Gateway
    (enum `UnifiedBalanceChain` do SDK instalado): **Mainnet** — Arc (5042), Ethereum (1), Base (8453),
    Arbitrum One (42161), OP Mainnet (10), Avalanche (43114), Polygon PoS (137); **Testnet** — Arc Testnet
    (5042002), Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Avalanche Fuji, Polygon Amoy.
  - `gatewayChainsFor(network)` filtra por ambiente (`live`/`test`).
  - Seletores de origem/destino/depósito (TreasuryModal, BatchPayModal, ChargeModal) e o painel
    "Saldos por rede" agora usam `gatewayChainsFor(network)`: **Mainnet só mostra Mainnet; Testnet só mostra Testnet**.
  - Arc permanece em primeiro lugar como rede principal nos dois ambientes.
  - `config.ts` (wagmi) agora inclui as redes Mainnet para leitura de saldo/recibo (`getPublicClient`).

### P0.3 — Alternância sem estados antigos
- A `useGatewayBalances` já usa `queryKey: ['gateway-balances', address, networkType]` (react-query invalida o
  cache ao trocar o ambiente). Os seletores reconstroem as redes válidas a cada render.
- Seleções incompatíveis são reinicializadas no seed dos modais (`arcGatewayKeyOf(network)`).

### P0.5 — Preservação de depósitos e envios
- Nenhuma alteração no mecanismo de depósito/spend/mint; apenas a lista de redes exibida foi filtrada por ambiente.

## 2. Redes suportadas (ambos os ambientes, Arc primeiro)

| Ambiente | Redes |
| --- | --- |
| Mainnet | Arc, Ethereum, Base, Arbitrum One, OP Mainnet, Avalanche, Polygon PoS |
| Testnet | Arc Testnet, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Avalanche Fuji, Polygon Amoy |

Endereços de contrato/token vêm de `onchain-facts`/viem — nada inventado. A Arc permanece como rede principal.

## 3. Testes (novos)

- Mainnet mostra apenas `live`; Testnet apenas `test`.
- Nenhuma rede testnet no Mainnet e nenhuma mainnet no Testnet.
- Arc é a primeira em ambos.
- Todas as redes têm chainId/label válidos.

Suíte completa: **280 pass, 0 fail**.

## 4. Status (honesto)

| Item | Status |
| --- | --- |
| Badge de ambiente (P0.1) | IMPLEMENTADO · TESTADO |
| Isolamento Mainnet/Testnet (P0.2) | IMPLEMENTADO · TESTADO |
| Alternância sem estado antigo (P0.3) | IMPLEMENTADO (cache por ambiente) |
| Redes suportadas (P0.4) | IMPLEMENTADO (EVM suportadas) |
| Preservação de depósitos/envios (P0.5) | PRESERVADO (sem mudança no mecanismo) |

## 5. Pendências externas / riscos residuais

- Redes não-EVM (Solana) e EVM mais recentes (HyperEVM, Sei, Sonic, Unichain, World_Chain) do enum do SDK **não
  foram habilitadas** — não há definição viem/onchain-facts equivalente confirmada neste repositório. Não fingir
  suporte operacional.
- A transação de referência `gatewayMint` foi usada apenas como diagnóstico; não reproduzida.
- A validação de saldo "disponível vs em processamento" depende dos dados do SDK (`totalConfirmedBalance` /
  `totalPendingBalance`), já separados no `useGatewayBalances`.

## 6. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 3.2 (dados/redes não são afetados de forma destrutiva).
