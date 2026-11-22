# Fase 2.4: Ativação do Arc Mainnet e infraestrutura financeira

Baseline: `57f61c4` (Fase 2.3). Sem regressões: **229 testes passando** (eram 225), typecheck limpo, lint limpo,
build de produção OK.

**Objetivo cumprido: Arc Mainnet operacional, sem nenhum gate artificial. Arc Testnet permanece disponível.**

---

## 1. Remoção dos bloqueios artificiais de Mainnet

- Removido `MAINNET_READY = false` e `isMainnetBlocked` de `network.ts`.
- Removidos todos os estados de bloqueio derivados:
  - `gateway.ts`: `useGatewayBalances` não bloqueia mais a consulta de saldo Mainnet (usa `networkType: 'mainnet' | 'testnet'`).
  - `TreasuryModal.tsx`: removido `originBlocked` (depósito/envio Mainnet habilitados).
  - `BatchPayModal.tsx`: removido `blocked` (lote Mainnet habilitado).
  - `Treasury.tsx`: removido o banner de "Mainnet bloqueada".
- Nenhum novo gate artificial foi introduzido. As salvaguardas genuínas permanecem: assinatura explícita da
  carteira, verificação de chain id, token, destinatário, valor, saldo e taxas.

## 2. Sincronização dos padrões de rede (Treasury / Batch / Charge)

- `network.ts` ganhou `arcGatewayKeyOf()` (`mainnet → 'Arc'`, `testnet → 'Arc_Testnet'`).
- `TreasuryModal`, `BatchPayModal` e `ChargeModal` agora iniciam a chain de origem/destino com a **rede ativa**
  (antes hardcoded em `'Arc_Testnet'`). Destinos cross-chain selecionados explicitamente continuam preservados.

## 3. Backend transacional: transporte real (`backend.ts`)

- Substituídos os stubs que lançavam "not implemented" por um **transporte HTTP real** (`fetch`):
  - `POST {url}/api/ledger/events` com `{ orgId, draft, actor }` → `PostResult` (JSON). Idempotente por
    `draft.idempotencyKey` dentro do `orgId` (restrição UNIQUE no servidor), atômico (evento + journal + auditoria).
  - `GET {url}/api/ledger?orgId=...` → `LedgerState` (JSON).
  - Autenticação via `Authorization: Bearer <token>`.
- `resolveBackend` sem credenciais devolve `available: false` com o motivo exato (`missing_url`/`missing_token`/
  `missing_org_id`); **nunca** simula persistência bem-sucedida.
- Esquema preparado para futuras organizações/usuários (isolamento por `orgId`; autorização por papel em `auth.ts`).

> **Status honesto:** o transporte está implementado e testado (mocks de `fetch`), mas **não há servidor/banco
> provisionado**. Enquanto isso, a persistência autoritativa continua sendo `localStorage`. A migração local→servidor
> (backup + preview + detecção de duplicatas + confirmação) fica pendente do provisionamento do servidor.

## 4. Verificação on-chain (`verify.ts`)

- `verifyUsdcReceipt` (fase 2.3) continua a primitiva autoritativa: valida chain id, hash, sucesso do recibo,
  contrato USDC esperado, remetente/destinatário e valor exato, distinguindo `confirmed`/`failed`/`pending`/`ambiguous`.
- `pending`/`ambiguous` nunca são tratados como liquidado; timeout de RPC não vira falha; não há retry automático de
  broadcasts ambíguos.

## 5. Isolamento Mainnet/Testnet

- Saldos do Gateway separados por `networkType` e por `chain`; transações de tesouraria e cobranças carregam
  `chain`/`chainId`. Nada soma saldos de redes diferentes.
- Registros sem metadados de rede confiáveis continuam legado/desconhecido (não atribuídos a Mainnet).
- Trocar de rede atualiza os dados corretos sem apagar registros de negócio.

## 6. Testes

- Novo `tests/backend.test.ts` (4 testes): resolve sem credenciais (motivo exato), `postEvent` via `fetch` (auth,
  orgId, idempotência), `fetch` (orgId isolado na URL), erro HTTP → rejeição (nunca sucesso falso).
- Atualizado `tests/network-theme.test.ts`: Mainnet operacional (mapeia para `'Arc'`), sem gate artificial.
- Suíte completa: **229 pass, 0 fail**. Lint e typecheck limpos.

## Dependências externas restantes (honestas)

- **Servidor/banco transacional**: não provisionado (sem credenciais). O transporte `fetch` está pronto; falta a
  API REST no servidor. Persistência segue `localStorage`.
- **Credenciais/contratos Mainnet da Circle**: o app usa os endereços oficiais de `onchain-facts` (Arc Mainnet 5042,
  USDC `0x3600…`). A validação final de credenciais do ambiente de deploy (chaves/entidade Circle) é externa ao app.
- **Auto-confirmação on-chain da tesouraria**: `verifyUsdcReceipt` está pronta; ligar o "pendente → confirmado"
  automático ao fluxo de conciliação continua sendo a integração recomendada (hoje a confirmação é humana).

## Implantação e rollback

- Deploy: `bun install && bun run build` (Vercel: importar repo; `vercel.json` já tem o fallback SPA).
- Rollback: `git revert` dos commits da fase 2.4 (a persistência de rede/tema fica em `localStorage`, não em código).

## Próxima fase recomendada

1. Provisionar o servidor REST (contrato em `backend.ts`) e migrar o razão com backup/preview/aprovação.
2. Ligar `verifyUsdcReceipt` à auto-confirmação da tesouraria e ao lançamento de taxas.
3. Validação final de credenciais/contratos Mainnet no ambiente de deploy (não é um bloqueio de código).
