# Chatbot UI 1.1 — full-screen chat workspace

## HEAD

- Initial: `7685efedba5bc370f06dea3e71db5e565ea1ca07`
- Final: same commit. Changes are in the working tree, not committed.

## Root cause of the compact layout

1. `Layout` wrapped every page in `<main class="mx-auto max-w-[1400px] px-4 pb-24 pt-6 sm:px-6">`, which adds gutters, a width cap and 6rem of bottom padding.
2. The page added a large `PageTop` header above the chat.
3. The chat card used a brittle fixed height: `h-[calc(100dvh-15rem)] min-h-[480px]`.
4. The history panel was a fixed `w-64`, `hidden lg:flex`. Tablet (768-1023 px) had no history at all.

## Fix

- `Layout.tsx`: when the current page is `chatbot`, the shell becomes a flex column of `h-dvh`. The header is `shrink-0` and `<main>` is `flex-1 min-h-0` with no padding or max-width. No fixed offsets, so any header height works. Other pages render exactly as before.
- `Chatbot.tsx`: flex workspace (`min-h-0`, `min-w-0`). Only the message list scrolls, and the composer stays at the bottom. Desktop (>= 1024 px): history panel of 288-320 px that can be collapsed. Tablet and mobile: history in an overlay drawer (Escape or the collapse button closes it).
- `ConversationSidebar.tsx`: assistant header with collapse button, New chat button, "Conversations" label with search (by title and message text), rows with relative date (Today/Yesterday/date) and message count, delete button, empty state.
- `ChatComposer.tsx`: auto-growing textarea, Enter sends, Shift+Enter adds a line (IME-safe), 16 px text on mobile (no iOS zoom), safe-area bottom padding, disabled Send when empty.
- `ChatEmptyState.tsx`: centered welcome with six shortcuts. They only fill the message field and never send. "Other business topics" just focuses the field.
- `ChatMessage.tsx`: long text wraps (`overflow-wrap:anywhere`), so there is no horizontal overflow.

## Preserved

Conversation store, `localStorage` persistence, "Not connected" status, no simulated replies, PT/EN strings through `t()`, light/dark tokens, Arc Mainnet default and network isolation. Dashboard, Agents, Finance, Treasury, Gateway, Ledger, navigation and network config were not touched.

## Files modified

`src/components/Layout.tsx`, `src/pages/Chatbot.tsx`, `src/components/chat/ChatComposer.tsx`, `ChatEmptyState.tsx`, `ChatMessage.tsx`, `ConversationSidebar.tsx`, plus this report.

## Tests run

- Lint and typecheck (`check.sh`): 0 errors.
- Server typecheck: OK.
- `bun test tests`: 312 pass, 0 fail.
- `vite build`: OK.

## Responsiveness evidence

The sandbox has no browser, so screenshots were not captured. The layout is verified by construction (flex chain from `h-dvh` down to the scroll region) and should be checked visually at 1920x1080, 1366x768, 768, 390 and 360 px, in both languages and both themes.
