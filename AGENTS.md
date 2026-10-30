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
- Production payment-link storage is Supabase Postgres via server-only PostgREST. Local development can use `server/data/db.json` (atomic writes); Vercel fails closed without Supabase configuration.
- Never switch the wallet network silently: switching is always an explicit button.

## Deployed contracts

CooketPayRouter on Arc Mainnet: `0x1BB1348ab8900D0F04c483fBaeCfd6472D808EF9` (deployment and explorer verification reported by the user). Read-only RPC inspection matched its runtime byte-for-byte to the local build with Arc USDC, and `USDC()` returned the expected token, at block 28629631. Public configuration is in `config/arc-mainnet-router.env.example`; production application configuration and real checkout remain unverified.

## To Run

```bash
bun install
bun run server
bun run dev
bun run check
```

## CooketPayRouter (payment links)
- Source: `contracts/CooketPayRouter.sol` (ownerless, no custody, token fixed at deploy). Tests: `contracts/test/CooketPayRouter.t.sol`. Verification test: `bun run test:router`.
- Address is configured through `VITE_COOKET_ROUTER_ADDRESS`; verification also requires `COOKET_ROUTER_CODE_HASH`, the verified deployed runtime code hash. Use the public deployment configuration above; never hardcode an address in application logic. `test:router:checkout` checks the configured deployment and mocked checkout calls without transactions.
- Links store the router they were created with. Router links are credited only from a `PaymentReceived` event of that router with the link id hash, recipient and amount, plus a real USDC movement in the same tx (`server/verify.ts`). Links without a router keep the old direct-transfer verification.
- Checkout for router links is two explicit signatures: exact-amount approve, then pay (`src/chain/useRouterCheckout.ts`). Send USDC (`useSendUsdc`) is untouched.
- Deploys to mainnet are done by the user with their own wallet; Arc Studio tools do not deploy to mainnet.

## Payment link API hosting
- Production: Vercel Function `api/index.mjs` (same origin as the app, no CORS), reached by the explicit `/api/:path*` rewrite in `vercel.json`. `server/handler.ts` accepts original paths or the rewrite's `__cooket_path` query. `api/_handler.mjs` is generated at build by `vercel-build` (esbuild bundles `server/handler.ts`); do not commit it. A bracket-named function alone failed to route nested link paths in this Vite deployment.
- Merchants need no USDC to create a link or receive payment. Creation uses an authenticated ownership message, not an onchain transaction; only the payer funds payment and gas. `bun run test:public-checkout` covers zero-balance merchant creation and funded-payer checkout offline.
- Storage: Supabase via PostgREST with the service role key, server-only (`server/store-supabase.ts`). Baseline schema and RLS: `supabase/migrations/0001_payment_links.sql`; forward compatibility for a missing router column: `0002_payment_links_router.sql`. Inspect existing schema and migration history before applying SQL. On Vercel without Supabase variables the API returns 503 instead of using the disk.
- Local dev still uses the JSON file store. The Vite dev server proxies `/api` to `bun run server`.
- Tests: `bun run test:api`, `bun run test:verify`, `bun run test:migrations`. `bun run check:storage` is a read-only external smoke check (needs Supabase credentials). `test:router` runs the same offline fixtures as `test:verify`; no deployments, keys, signing or transactions. `test:router:abi` checks compiled ABI parity without RPC. The retained `test:router:anvil` harness requires explicit `COOKET_RUN_ANVIL_TRANSACTIONS=1`; never opt in under no-deployment/no-signing instructions.
