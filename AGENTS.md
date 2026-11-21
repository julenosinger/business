# Global Business OS

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

ERP and finance app (pt-BR) for small and large merchants: dashboard, accounting (cash book + DRE), accounts payable/receivable, sales/POS, stock, purchases, customers, suppliers, employees/payroll, reports, and a USDC treasury that runs on Circle Gateway (unified balance via App Kit).

Notes for agents:
- i18n: bilingual PT/EN via `t('pt text', 'en text')` from `src/lib/i18n.tsx` (language switch remounts the tree under `I18nProvider`). Do not hold translated labels in module-level constants; build them in functions. Stored categories are Portuguese; show them with `cat()`.
- Theme: dark/light via `data-theme` on `<html>` (`src/lib/theme.ts`); colors are RGB-channel CSS variables in `src/index.css` mapped in `tailwind.config.js`. Use token classes (`bg-fill/5`, `text-ok`) and the `C` color constants in `charts.tsx`, never raw hex.
- Safety nets: `src/lib/backup.ts` (JSON export/import, backup reminder on Dashboard); destructive store actions use `undoable()` (snapshot + Undo toast); `cancelSale` restores stock and books a refund entry (category Sales, excluded from opex); canceled sales are skipped by kpis/top products/customer totals.
- USDC payment requests: `PaymentRequest` in the store; link is `/?invoice=<base64url>` (public data only, built with `getShareBase()` via `useShareBase`); payer page `src/pages/PayPage.tsx` renders instead of the workspace when the param exists; `src/components/PaymentWatcher.tsx` scans USDC `Transfer` logs to the merchant wallet from the request's creation block and matches the exact amount (a unique 100-999 micro-USDC tag is added to each request). Batch pay: `BatchPayModal.tsx` (sequential `spend`, one signature each). Safety limit in Settings (`approvalLimit`) adds a confirmation checkbox.
- Business data is local-only: `src/lib/store.tsx` persists to localStorage (`gbos:v1`). Demo data (`src/lib/demo.ts`) is loaded only on request.
- Treasury: `src/lib/gateway.ts` (App Kit unified balance, testnet) and `src/components/TreasuryModal.tsx` (deposit, spend with Forwarding Service). Paying an account via USDC settles it and stores the explorer link in `Account.treasuryTx`.
- The USDC rate to local currency is user-defined in Settings (never hardcoded).
- Supported treasury chains are the testnets listed in `GATEWAY_CHAINS`; add a chain in both `src/config.ts` and `src/lib/gateway.ts`.
- No contracts are deployed; the treasury is non-custodial (user's connected wallet signs).

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```
