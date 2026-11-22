# Fase 3.2.2: Integridade de rede da Tesouraria e isolamento de cobranças

Baseline: `075d4fd` (Fase 3.2.1). Sem regressões: **286 testes passando** (eram 284), typecheck (app + servidor)
limpo, lint limpo, build de produção OK.

---

## 1. Causas-raiz e correções

### P0.1 — Isolamento das cobranças (RequestsCard)
- **Causa:** `Treasury.tsx` passava `data.requests` (sem filtro) ao `RequestsCard`, exibindo cobranças Mainnet no
  ambiente Testnet (a cobrança de 600,000585 USDC da Arc Mainnet aparecia na Testnet).
- **Correção:** `RequestsCard` agora recebe `visibleRequests = requestsForNetwork(data.requests, network)` — o mesmo
  seletor puro usado no gráfico. Cobranças pendentes, pagas e canceladas de cada ambiente permanecem preservadas;
  nada é excluído ao alternar.

### P0.2 — Classificação segura de redes
- `treasuryOpEnv` agora distingue `invalid_environment` quando origem e destino são conhecidos mas de ambientes
  diferentes (nunca escolhe silenciosamente um dos dois). `treasuryOpsForNetwork` exclui `invalid_environment` e
  `unknown` de ambos os históricos (preservados, sem atribuição automática).

### P0.3 — Registro central de redes
- `GATEWAY_KEY_ENVS` (fonte única de classificação de ambiente) agora reconhece as redes adicionais do enum oficial
  do SDK — Sei, Sonic, HyperEVM, Unichain e World Chain (e suas testnets) — **apenas para classificação de histórico**.
  Reconhecimento ≠ habilitação: depósito/envio/mint continuam exigindo definição viem/onchain-facts validada em
  `GATEWAY_CHAINS`. Arc permanece a rede principal.

### P0.4 — Ciclo de vida das cobranças
- A cobrança persiste `chainKey`/`chainId` no momento da criação (já existente). Verificação/pagamento usam a rede
  original da cobrança; nada é reenviado ao alternar ambientes. Sem mudança de mecanismo.

## 2. Testes (novos)

- Origem/destino de ambientes diferentes → `invalid_environment` (não vaza para nenhum histórico).
- Redes adicionais (Sei, Sonic, HyperEVM, Unichain, World Chain + testnets) reconhecidas para classificação.

Suíte completa: **286 pass, 0 fail**.

## 3. Status (honesto)

| Item | Status |
| --- | --- |
| Isolamento de cobranças (P0.1) | IMPLEMENTADO · TESTADO |
| Classificação segura (P0.2) | IMPLEMENTADO · TESTADO |
| Registro central + redes adicionais (P0.3) | IMPLEMENTADO (classificação; execução separada) |
| Ciclo de vida de cobranças (P0.4) | JÁ CORRETO (chainKey/chainId persistidos) |

## 4. Riscos residuais

- Registros `unknown`/`invalid_environment` permanecem preservados, mas ocultos do histórico (sem UI dedicada de
  revisão nesta fase).
- As redes adicionais (Sei, Sonic, HyperEVM, Unichain, World Chain) são reconhecidas para histórico, mas **não**
  executáveis (sem contrato/RPC confirmado). Não fingir suporte operacional.

## 5. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert` dos commits da fase 3.2.2 (dados não são afetados de forma destrutiva).
