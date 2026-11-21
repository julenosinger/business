# Global Business OS

A business management app for small and large merchants: accounting, stock, sales, purchases, payroll, accounts payable and receivable, reports, and a USDC treasury powered by Circle Gateway.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Dashboard with revenue, profit, expenses, stock value, cash flow and upcoming obligations
- Accounting: cash book and a simplified income statement (DRE)
- Accounts payable and receivable with due dates and overdue tracking
- Sales and point of sale, with automatic stock and cash updates
- Stock control with minimum levels and movements
- Purchases, customers, suppliers, employees and monthly payroll
- Reports with CSV export
- Backup and restore (JSON), undo after deletions, sale cancellation with refund, entry and bill editing, and per-product stock history
- English and Portuguese (switch in the top bar), plus dark and light themes
- Payment requests in USDC: share a link or WhatsApp message, the customer pays from their wallet, and the bill is settled automatically while the app is open
- Batch payments (including payroll) with per-payment status and retry, optional safety limit
- Treasury: unified USDC balance across testnets, deposits, and payments to suppliers or employees on any supported network (non-custodial, signed by your wallet)

## Tech stack

React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit, Circle App Kit.

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Other commands: `bun run build` (production build to `dist/`), `bun run preview`, `bun run check` (lint and typecheck).

### Deploy to Vercel

The repository includes a `vercel.json` (Vite framework, Bun install, single-page fallback). Import the repository in Vercel and deploy. No environment variables are required. Payment-request links use the same page with a query parameter, so they work on the deployed domain.

### Environment variables

None.

Business data is stored in the browser (local storage). The treasury runs on testnets only.
