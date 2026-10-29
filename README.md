# Cooket

A USDC payment app on Arc Mainnet for individuals, freelancers, and small businesses. Sign in with Privy, then send and receive USDC, share verified payment links, review activity, and manage contacts.

Built with [Arc Studio](https://studio.arc.io)

**Cooket moves real USDC on Arc Mainnet. Transactions are irreversible. Review and test thoroughly, and have the code independently audited, before using it with real funds.**

## What you can do

- Sign in with email, Google, or an existing wallet. Privy creates a wallet if you do not have one.
- See your real USDC balance, recent payments, and monthly totals.
- Send USDC with a guided flow: recipient, amount, review, confirmation, and result. Every payment is approved in your wallet.
- Receive USDC with your address and a QR code.
- Create payment links with a fixed or payer-chosen amount and an optional expiry. Payments appear only after the payment server verifies them onchain.
- Search and filter activity and open full transaction details.
- Save contacts and set preferences such as display currency and large-transfer warnings.

## Tech stack

React, TypeScript, Vite, Tailwind CSS, Privy (`@privy-io/react-auth`, `@privy-io/wagmi`), wagmi, viem, TanStack Query, Lucide icons. A small Node HTTP server (`server/`) stores payment links and verifies payments against Arc Mainnet.

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
bun install
bun run server   # payment link server on :3001 (the dev server proxies /api to it)
bun run dev      # app on http://localhost:5173
bun run check    # lint and typecheck
```

### Privy setup

In the Privy Dashboard for your app, enable the Email, Google, and Wallet login methods, enable embedded wallets, and add every origin the app runs on (including your deployed domain and any preview domain) to the allowed origins. Without this, sign-in fails.

### Environment variables

- `VITE_PRIVY_APP_ID`: public Privy App ID. Read by the browser app and by the server, which uses it to verify Privy access tokens.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: optional, provisioned by Arc Studio. When they cover Arc, the server uses them for RPC; otherwise it uses the public Arc Mainnet RPC.
- `PORT`: optional, port for the payment server (default 3001).
- `COOKET_DATA_FILE`: optional, path of the payment server's data file (default `server/data/db.json`).

### Network

Arc Mainnet only (chain ID 5042). USDC is the gas token. Chain, RPC, USDC address, and explorer come from Arc Studio's verified chain registry.

### Data

Contacts, notes, preferences, and records of payments sent from this browser live in local storage. Payment links and their verified payments are stored by the payment server in a JSON file. For production, deploy the server with durable storage and the same Privy App ID.
