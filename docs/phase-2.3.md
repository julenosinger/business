# Fase 2.3: Arc Mainnet + Testnet, seletor de rede e prontidão de produção

Baseline: `1152278` (Fase 2.2). Sem regressões: **225 testes passando** (eram 219), typecheck limpo, lint limpo, build de produção OK.

Esta fase adiciona, de forma **cirúrgica e retrocompatível**, coexistência segura entre Arc Mainnet e Arc Testnet,
um seletor de rede no cabeçalho, **modo claro como padrão** e a correção das duas falhas pré-existentes de CI
(dependência ausente e script de lint incompatível com Windows).

---

## 1. Arquitetura de rede dupla (`src/lib/network.ts`, `NetworkSelector.tsx`)

- `NetworkId = 'mainnet' | 'testnet'`. **Padrão: Mainnet** (chain id 5042). Fonte autoritativa de fatos: `onchain-facts.ts`.
- A preferência é persistida em `gbos:network` e **validada na leitura**: qualquer valor desconhecido volta para
  Mainnet. A troca é sempre explícita (nunca silenciosa).
- Seletor compacto no cabeçalho (`NetworkSelector`): mostra a rede ativa com indicador discreto (Live/Teste) e
  permite alternar. Funciona em desktop e mobile (label curto no mobile).
- **Sincronização com a carteira**: ao trocar para uma rede com a carteira conectada, o app pede `switchChainAsync`
  e **só atualiza a rede do app após sucesso**. Recusa/erro mantém a rede anterior e mostra mensagem clara.
- `arcChainIdOf()` / `isMainnetBlocked()` / `MAINNET_READY` centralizam a lógica de rede.

## 2. Configuração de chains e Gateway

- `config.ts`: adicionado `arc` (Mainnet, 5042) às chains/transports do wagmi (além do `arcTestnet` já existente).
- `gateway.ts`: `GATEWAY_CHAINS` agora inclui **Arc Mainnet** (`key: 'Arc'`, `env: 'live'`) e cada chain tem
  `env: 'live' | 'test'`. `useGatewayBalances` é **sensível à rede**: usa `networkType: 'mainnet' | 'testnet'` e
  inclui a rede na `queryKey`, invalidando o cache ao trocar de rede (isolamento de saldos).
- Nenhum endereço de token/contrato foi duplicado: tudo vem de `onchain-facts`.

## 3. Gate de execução Mainnet (segurança)

- `MAINNET_READY = false` (constante de código, NÃO uma configuração do usuário). Enquanto `false`:
  - `useGatewayBalances` **não consulta** saldos Mainnet.
  - `TreasuryModal` (depósito/envio) e `BatchPayModal` (lote) bloqueiam a execução quando a rede selecionada é
    `env: 'live'`, com aviso explícito e botão desabilitado.
  - A página Tesouraria mostra um banner explicativo quando a rede ativa é Mainnet bloqueada.
- Isso honra "Mainnet execution must remain behind an explicit readiness gate". Testnet permanece inalterado.
- Não há simulação de saldo/sucesso; não há segredo de API no frontend.

## 4. Modo claro como padrão (`theme.ts`, `index.html`)

- `theme.ts`: o padrão agora é **claro** (`localStorage.getItem('gbos:theme') === 'dark' ? 'dark' : 'light'`).
  Preferência explícita de Dark é respeitada e nunca é resetada.
- `index.html`: script inline define `data-theme` antes do primeiro paint (sem "flash" de tema).
- A troca de tema não reseta rede, carteira, contabilidade ou dados do negócio (e vice-versa). Tema e rede são
  independentes.

## 5. Isolamento de dados Mainnet/Testnet

- Saldos do Gateway são separados por `networkType` e por `chain` (já existente). Transações de tesouraria
  (`treasuryOps`) e cobranças (`requests`) já carregam `chain`/`chainId`; nunca se somam saldos de redes diferentes.
- Registros históricos sem metadados de rede confiáveis continuam classificados como legado/desconhecidos na
  Conciliação (não são atribuídos silenciosamente a Mainnet).
- Registros de negócio (produtos, fornecedores, clientes) não são duplicados nem apagados ao trocar de rede.

## 6. Correções de CI (dependência ausente + lint no Windows)

- **typecheck**: adicionada declaração ambiente `scripts/compass-chains.d.ts` para o módulo interno
  `@circlefin/compass-chains` (usado só pelo script de deploy, que não faz parte do app em `src/`). `tsc --noEmit`
  agora passa limpo — sem mascarar erros reais (o resto de `scripts/` continua sendo checado).
- **lint**: o script `lint` usava sintaxe bash (`$?` / `$(())`) que não roda no PowerShell/cmd do Windows.
  Substituído por `scripts/lint.ts` (Bun, `spawnSync`), cross-platform, que executa as duas etapas do oxlint e
  propaga o status de saída. `bun run lint` agora passa (exit 0).
- Erros de lint que a Fase 2.2 havia deixado (setState em efeito, chamada impura de `Date`, `require-await`,
  type assertion desnecessária) foram corrigidos.

## 7. Testes

- Novo `tests/network-theme.test.ts`: default Mainnet (5042), seleção explícita de Testnet, persistência e
  validação, `isMainnetBlocked`, default Light e persistência de Dark.
- Suíte completa: **225 pass, 0 fail**. Build de produção OK.

## Riscos / bloqueios de produção restantes

- **Backend transacional** (Seção 8) continua sendo um contrato (`backend.ts`), não um servidor. A persistência
  segue `localStorage`. Nada simula sucesso remoto. Migração local→servidor: backup + preview + aprovação (a
  implementar junto com o servidor).
- **Verificação on-chain** (`verify.ts`) é a primitiva pronta; a auto-confirmação de liquidações de tesouraria
  (pendente→confirmado) via recibo ainda não está ligada ao fluxo — permanece a confirmação humana.
- **Mainnet permanece bloqueada** até validar contratos oficiais, credenciais, backend e verificação
  (`MAINNET_READY = false`).

## Implantação e rollback

- Deploy: `bun install && bun run build` (Vercel: importar o repositório; `vercel.json` já configura o fallback SPA).
- Rollback: `git revert` dos commits da fase 2.3 (a persistência de tema/rede fica em `localStorage`, não em código;
  reverter o código não apaga dados de negócio).

## Próxima fase recomendada

1. Provisionar o backend transacional e migrar o razão (com backup/preview/aprovação).
2. Ligar `verifyUsdcReceipt` à confirmação automática da tesouraria e lançamento de taxas.
3. Validar contratos/credenciais Mainnet e liberar `MAINNET_READY` de forma controlada (feature flag por ambiente).
