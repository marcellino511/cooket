# Cooket

A USDC payment app on Arc Mainnet for individuals, freelancers, and small businesses. Sign in with Privy, then send and receive USDC, share verified payment links, review activity, and manage contacts.

Built with [Arc Studio](https://studio.arc.io)

**Cooket moves real USDC on Arc Mainnet. Transactions are irreversible. Review and test thoroughly, and have the code independently audited, before using it with real funds.**

## What you can do

- Sign in with email, Google, X, or an existing wallet. Privy creates a wallet if you do not have one.
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
bun run contracts:build && bun run contracts:test   # CooketPayRouter build and unit tests (Foundry)
bun run test:router   # payment verification against a local test chain (needs Foundry's anvil and a prior forge build)
```

### Privy setup

In the Privy Dashboard for your app, enable the Email, Google, X (Twitter), and Wallet login methods (the app lists them in `src/main.tsx`, so a method enabled only in the dashboard will not appear until it is listed there; X's id is `twitter`), enable embedded wallets, and add every origin the app runs on (including your deployed domain and any preview domain) to the allowed origins. Without this, sign-in fails. For X, Privy's default credentials work for testing. For production, create your own X app as a confidential client (Web app, Automated App or Bot), set its redirect URI to `https://auth.privy.io/api/v1/oauth/callback`, and enter its Client ID and Secret in the Privy Dashboard under Login methods.

### Environment variables

- `VITE_PRIVY_APP_ID`: public Privy App ID. Read by the browser app and by the server, which uses it to verify Privy access tokens.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: optional, provisioned by Arc Studio. When they cover Arc, the server uses them for RPC; otherwise it uses the public Arc Mainnet RPC.
- `VITE_COOKET_ROUTER_ADDRESS`: optional, address of the deployed CooketPayRouter contract on Arc Mainnet (a public address). Read by the payment server. When set, new payment links settle through the contract and are verified from its event; when unset, links use direct USDC transfers.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: server-only. Durable storage for payment links (Supabase Postgres). Required in production; never give them a `VITE_` prefix and never expose them to the browser. Without them the server uses a local JSON file in development and refuses to run on Vercel.
- `SUPABASE_ANON_KEY`: optional, used only by `bun run check:storage` to prove the public key cannot read the tables.
- `ARC_RPC_URL`: optional, a private Arc Mainnet RPC for the server (default: the public RPC from the chain registry).
- `PORT`: optional, port for the payment server (default 3001).
- `COOKET_DATA_FILE`: optional, path of the payment server's data file (default `server/data/db.json`).

### Payment contract

`contracts/CooketPayRouter.sol` is an ownerless checkout contract. A payer approves the exact amount, then calls `pay`, which sends USDC straight to the merchant and logs the payment against the link. It holds no funds and has no admin functions. Deploy it yourself with your own wallet and set `VITE_COOKET_ROUTER_ADDRESS` afterwards.

### Production (Vercel)

The app is a Vite static site plus one Vercel Function for the payment link API.

- `api/[...path].mjs` serves everything under `/api/*`. It loads `api/_handler.mjs`, which the `vercel-build` script generates from `server/handler.ts` with esbuild (the file is not committed).
- The browser calls `/api/...` on the same origin, so no CORS headers are sent or needed.
- `vercel.json` adds the single-page-app rewrite (everything except `/api` serves `index.html`), a 30 second function limit, and basic security headers.
- Create the tables once by running `supabase/migrations/0001_payment_links.sql` in the Supabase SQL editor, then `bun run check:storage` to confirm.
- Set the environment variables above in the Vercel project (Production and Preview), then redeploy. Mark the Supabase service role key as sensitive.
- Check a deployment: `GET /api/health` should report `"storage":"supabase"`, `"chainId":5042`, and the router address once configured.

### Tests

- `bun run contracts:test`: CooketPayRouter unit tests (Foundry).
- `bun run test:router`: payment verification against a local test chain.
- `bun run test:api`: the payment link API and storage layer, offline.

### Network

Arc Mainnet only (chain ID 5042). USDC is the gas token. Chain, RPC, USDC address, and explorer come from Arc Studio's verified chain registry.

### Data

Contacts, notes, preferences, and records of payments sent from this browser live in local storage. Payment links and their verified payments are stored by the payment server in a JSON file. For production, deploy the server with durable storage and the same Privy App ID.
