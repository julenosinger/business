# UI/UX NAVIGATION 1.0 — Sitemap, Responsive Architecture & Route Persistence

**HEAD inicial:** `3907341` · **HEAD final:** `(commit desta fase)`

Resultado: **759 testes aprovados** (baseline 752 + 7 novos) · typecheck app/servidor limpo · lint limpo · build de produção OK · Mainnet preservada.

---

## Causa raiz do problema de refresh

A página ativa era mantida **apenas em estado React** (`useState<PageId>('dashboard')` em `App.tsx`).
Como o estado não era persistido nem refletido na URL, qualquer refresh recriava o componente do zero e
voltava para a Dashboard.

**Solução:** a **URL passou a ser a fonte autoritativa da navegação**. Cada página tem uma rota estável
(`/dashboard`, `/sales`, …); o `pathname` é lido de forma síncrona no primeiro render (sem flash) e a
navegação usa `history.pushState`/`replaceState` + listener `popstate` (Voltar/Avançar). Isso também
mantém compatível com o `installShareSync` (espelho de URL do Arc Studio).

## Sitemap (fonte única: `src/components/sidebar/nav-config.tsx`)

| Categoria | Páginas |
|---|---|
| Visão geral | Dashboard |
| Comercial | Vendas e PDV, Compras, Clientes, Fornecedores |
| Operações | Produtos e estoque, Logística Global |
| Financeiro | Tesouraria, Contas a pagar e receber, Contabilidade, Relatórios |
| Gestão | Funcionários e folha, Agents, Chatbot |
| Sistema | Configurações |

## Mapeamento de rotas (`src/lib/router.ts`)

| Página | Rota |
|---|---|
| dashboard | `/dashboard` |
| sales | `/sales` |
| purchases | `/purchases` |
| customers | `/customers` |
| suppliers | `/suppliers` |
| stock | `/stock` |
| logistics | `/logistics` |
| treasury | `/treasury` |
| finance | `/finance` |
| accounting | `/accounting` |
| reports | `/reports` |
| hr | `/employees` |
| agents | `/agents` |
| chatbot | `/chatbot` |
| settings | `/settings` |

**Subabas persistentes por parâmetro de URL** (`?tab=`):

- Contabilidade: `?tab=overview|cashbook|ledger|chart|reconciliation|periods`
- Contas a pagar/receber: `?tab=open|payable|receivable|paid`

**Links públicos preservados** (fora do layout administrativo, sem autenticação):

- `?invoice=<base64url>` → PayPage
- `?checkout=<token>` ou `/checkout/:token` → GatewayCheckoutPage

## Arquivos modificados

- `src/lib/router.ts` (novo) — `PAGE_ROUTES`, `pageFromPath`, `routeFor`, `useUrlParam`.
- `src/App.tsx` — Workspace com roteamento por URL + `popstate`; navegação via `pushState`.
- `src/components/sidebar/nav-config.tsx` — sitemap centralizado reorganizado por categorias + `route` + `pageLabel`.
- `src/components/sidebar/SidebarContent.tsx` — rodapé corrigido de “Testnet” → “Arc Mainnet”.
- `src/components/BottomNav.tsx` (novo) — navegação inferior mobile (Início, Vendas, Tesouraria, Financeiro, Mais).
- `src/components/Layout.tsx` — integra `BottomNav`; cabeçalho mostra a página atual (identificação).
- `src/pages/Accounting.tsx` / `src/pages/Finance.tsx` — subabas persistidas por `?tab=`.
- `tests/navigation.test.ts` (novo) — 7 testes de roteamento/sitemap.

## Melhorias

- **Desktop:** categorias funcionais agrupadas (Visão geral/Comercial/Operações/Financeiro/Gestão/Sistema),
  seções expansíveis, ícones, destaque da página ativa, trilho recolhível com tooltips, scroll próprio e
  persistência da preferência (localStorage `gbos:sidebar`).
- **Mobile:** cabeçalho compacto com menu, identificação da página, carteira, tema/idioma e indicador Mainnet;
  drawer completo; navegação inferior com área segura (`env(safe-area-inset-bottom)`); “Mais” abre o drawer.
- **Rotas:** acesso direto por URL, compartilhamento, Voltar/Avançar e persistência após refresh em todas as páginas.
- **Sem regressão funcional:** `PaymentWatcher` e `ReconciliationCoordinator` permanecem **fora** do router,
  então mudanças de rota não remontam watchers, não interrompem verificações de pagamento nem repetem operações.

## Resultados dos testes

- Suíte completa (`bun test tests --isolate`): **759 pass, 0 fail**.
- typecheck frontend/backend: limpos.
- lint: limpo.
- build de produção (`bun run build`): OK.

## Validação de produção

- **Cloudflare Pages:** `public/_redirects` → `/* /index.html 200` (fallback SPA).
- **Vercel:** `vercel.json` → rewrite `/((?!assets/).*)` → `/index.html`.
- Acesso direto a qualquer rota válida (ex.: `/sales`) e refresh servem `index.html`; o router resolve o `pathname`
  e renderiza a página correta, sem 404 e sem sobrescrever rota válida.

## Rollback

`git revert` dos commits desta fase (na ordem inversa). A navegação volta ao estado React puro, sem perda de dados
(`gbos:v1`, razão contábil, Treasury e Gateway permanecem intactos).
