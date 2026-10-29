# Cooket

> Built with Arc Studio - money-powered apps in minutes

Project memory for future agents and humans.

## What This App Does

Cooket is a USDC payment app on **Arc Mainnet only** (chain 5042) with Privy sign-in and wallets. Balance overview, five-step send flow, receive with QR, activity, contacts, settings, and server-verified payment links with a public checkout (`/pay?id=...`).

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS (dark palette in `tailwind.config.js`; the default `slate` scale is remapped for dark)
- Auth/wallet: Privy (`@privy-io/react-auth` + `@privy-io/wagmi`), App ID in `VITE_PRIVY_APP_ID`. Providers in `src/main.tsx`; gate in `src/components/layout/AppShell.tsx`
- Web3: wagmi v2 + viem. Chain facts only via `@/onchain-facts`; amounts via `@/onchain-money`
- Backend: `server/` (plain `node:http`, run with `bun run server`, proxied at `/api`). Verifies Privy JWTs via JWKS (no secret), verifies merchant wallet signatures, and verifies payments from Arc logs
- Shared rules: `src/shared/links.ts` (signed message format, link status)

## Arc specifics (do not regress)

- USDC is native gas (18 decimals) and the ERC-20 view (6). One pool; never add the two.
- All explicit USDC movements log from the system emitter `0xffff...fffe` (18 decimals). History and payment verification read that emitter, not the ERC-20 contract log, to avoid double counting and to include native sends.
- Mempool floor: maxFeePerGas >= 20 gwei (`ARC_MIN_MAX_FEE_PER_GAS`); sends and fee estimates enforce it.
- The primary RPC is load balanced: retry `-32014` and stay a few blocks behind head when scanning.
- The explorer API is behind a bot challenge, so history is RPC based.

## Decisions

- Fonts are self-hosted from `public/fonts` (Inter, JetBrains Mono) and declared in `src/index.css`. Do not reintroduce Google Fonts links: a blocked or slow font request left text invisible.

- No demo data. Without a Privy session the app shows sign-in only.
- Completed = receipt success with 1 confirmation (`CONFIRMATIONS`). The reconciler resolves pending records after reloads.
- Payment links live on the server. Creation needs a Privy session and a signature from the recipient wallet. A payment is recorded only if the tx succeeded on 5042, has a USDC system Transfer to the recipient, matches the fixed amount, and falls inside the link window. Each transfer log can count once.
- The server stores data in `server/data/db.json` (atomic writes). Replace with a real database for production.
- Never switch the wallet network silently: switching is always an explicit button.

## Deployed contracts

None.

## To Run

```bash
bun install
bun run server
bun run dev
bun run check
```

## CooketPayRouter (payment links)
- Source: `contracts/CooketPayRouter.sol` (ownerless, no custody, token fixed at deploy). Tests: `contracts/test/CooketPayRouter.t.sol`. Verification test: `bun run test:router`.
- NOT deployed yet. Deployed address is configured through `VITE_COOKET_ROUTER_ADDRESS` (read by `server/config.ts`). Never hardcode it.
- Links store the router they were created with. Router links are credited only from a `PaymentReceived` event of that router with the link id hash, recipient and amount, plus a real USDC movement in the same tx (`server/verify.ts`). Links without a router keep the old direct-transfer verification.
- Checkout for router links is two explicit signatures: exact-amount approve, then pay (`src/chain/useRouterCheckout.ts`). Send USDC (`useSendUsdc`) is untouched.
- Deploys to mainnet are done by the user with their own wallet; Arc Studio tools do not deploy to mainnet.

## Payment link API hosting
- Production: Vercel Function `api/[...path].mjs` (same origin as the app, no CORS). `api/_handler.mjs` is generated at build by `vercel-build` (esbuild bundles `server/handler.ts`); do not commit it.
- Storage: Supabase via PostgREST with the service role key, server-only (`server/store-supabase.ts`). Schema and RLS: `supabase/migrations/0001_payment_links.sql`. On Vercel without Supabase variables the API returns 503 instead of using the disk.
- Local dev still uses the JSON file store. The Vite dev server proxies `/api` to `bun run server`.
- Tests: `bun run test:api`, `bun run test:router`, `bun run check:storage` (needs real Supabase credentials).
