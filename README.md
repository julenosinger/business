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
- Global Logistics (phase 1): shipments (inbound, outbound, transfer) with validated status workflow, manual tracking timeline with audit history, documents references, clickable KPI cards that filter the shipment list (with search, status filter, sorting and pagination), alerts and upcoming deliveries. Outbound shipments are picked, packed and stock-checked before dispatch (stock is never deducted twice: the linked sale already did it), with proof of delivery and closing. Inbound shipments are received with an inspection (expected, received, damaged) and, only then, can add stock exactly once. Purchases can optionally wait for goods receipt. Carriers directory (manual tracking links, service levels, cost estimate), freight costs (freight, insurance, fees, estimated vs actual) that can be posted once to payables, cost reports with CSV, international data (Incoterm, HS/NCM codes, customs references, entered manually), and returns (RMA) with inspection and explicit restock decisions. An Insights tab computes carrier performance, delay risk, exception summaries, freight analysis, reorder suggestions and a simple 4-week projection with local rules (no AI is connected). The code also ships read-only interfaces for signed carrier webhooks (HMAC-SHA256, idempotent, never changes status) and for a future AI provider (anonymized snapshot, validated output); neither is connected to anything yet. Shipments never change finances on their own: the only financial entry is the freight cost you choose to post.
- Treasury: unified USDC balance across testnets, deposits, and payments to suppliers or employees on any supported network (non-custodial, signed by your wallet)

## Tech stack

React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit, Circle App Kit.

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Other commands: `bun run build` (production build to `dist/`), `bun run preview`, `bun run check` (lint and typecheck), `bun run test` (unit tests for the logistics rules).

### Deploy to Vercel

The repository includes a `vercel.json` (Vite framework, Bun install, single-page fallback). Import the repository in Vercel and deploy. No environment variables are required. Payment-request links use the same page with a query parameter, so they work on the deployed domain.

### Environment variables

None.

Business data is stored in the browser (local storage). The treasury runs on testnets only.
