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

Prerequisites: [Bun](https://bun.sh). Contract tests also require Foundry and `forge-std` (for example, clone the reviewed `v1.9.7` tag into the ignored `lib/forge-std` directory); OpenZeppelin is restored by `bun install`.

```bash
bun install
bun run server   # payment link server on :3001 (the dev server proxies /api to it)
bun run dev      # app on http://localhost:5173
bun run check    # lint and typecheck
bun run contracts:build && bun run contracts:test   # CooketPayRouter build and unit tests (Foundry)
bun run test:verify   # offline receipt/router verification fixtures (no transactions)
bun run test:api      # offline API and fake PostgREST storage tests
```

### Privy setup

In the Privy Dashboard for your app, enable the Email, Google, X (Twitter), and Wallet login methods (the app lists them in `src/main.tsx`, so a method enabled only in the dashboard will not appear until it is listed there; X's id is `twitter`), enable embedded wallets, and add every origin the app runs on (including your deployed domain and any preview domain) to the allowed origins. Without this, sign-in fails. For X, Privy's default credentials work for testing. For production, create your own X app as a confidential client (Web app, Automated App or Bot), set its redirect URI to `https://auth.privy.io/api/v1/oauth/callback`, and enter its Client ID and Secret in the Privy Dashboard under Login methods.

### Environment variables

- `VITE_PRIVY_APP_ID`: public Privy App ID. Read by the browser app and by the server, which uses it to verify Privy access tokens.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: optional, provisioned by Arc Studio. When they cover Arc, the server uses them for RPC; otherwise it uses the public Arc Mainnet RPC.
- `VITE_COOKET_ROUTER_ADDRESS`: optional, address of the deployed CooketPayRouter contract on Arc Mainnet (a public address). Read by the payment server. When set, new payment links settle through the contract and are verified from its event; when unset, links use direct USDC transfers.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: server-only. Durable storage for payment links (Supabase Postgres). Required in production; never give them a `VITE_` prefix and never expose them to the browser. Without them the server uses a local JSON file in development and refuses to run on Vercel.
- `COOKET_ROUTER_CODE_HASH`: server-only configuration required for router-backed links, the keccak256 hash of the independently verified deployed CooketPayRouter runtime bytecode, including its immutable USDC address. Compare the runtime with the reviewed Solidity build before pinning its hash; copying a hash from an untrusted RPC alone does not establish contract identity. A missing or mismatched hash prevents router payment verification. When `VITE_COOKET_ROUTER_ADDRESS` is set without a valid hash, health and new-link creation fail closed. Previously created router links also require this hash even when new links use direct transfers.
- `SUPABASE_ANON_KEY`: optional, used only by the read-only `bun run check:storage` public-read smoke check. Empty results alone do not establish correct RLS.
- `ARC_RPC_URL`: optional, a private Arc Mainnet RPC for the server (default: the public RPC from the chain registry).
- `PORT`: optional, port for the payment server (default 3001).
- `COOKET_DATA_FILE`: optional, local-development file-store path (default `server/data/db.json`). Ignored when Supabase storage is selected; the file store is prohibited on Vercel.

### Payment contract

`contracts/CooketPayRouter.sol` is an ownerless checkout contract. A payer approves the exact amount, then calls `pay`, which sends USDC straight to the merchant and logs the payment against the link. It does not custody payments and has no admin, fee, or withdrawal functions. The constructor fixes a token address; it does not enforce a chain ID or hardcode the token. Arc Mainnet uses chain **5042** and USDC **`0x3600000000000000000000000000000000000000`** (6 decimals).

The server checks Arc chain identity, pinned runtime code and the `USDC()` getter. It credits a matching `PaymentReceived` only alongside a preceding system-emitter USDC movement from the event payer to the link recipient, in a successful canonical receipt inside the link window. The system movement uses 18 decimals and is converted to the token's 6 decimals; its ERC-20 mirror is never added to it. The transfer's `(tx_hash, log_index)` is the claim key. Router transactions cannot also pay legacy direct-transfer links. Retries preserve older router records that used event indices through an exact `(link_id, tx_hash)` lookup, independently of paginated payment lists. Database uniqueness still enforces `(tx_hash, log_index)` globally; the lookup itself is not the concurrent replay guard. Receipts need one confirmation, consistent with the existing send flow; this does not establish longer-term finality.

Checkout requests an exact-amount allowance and a separate `pay` signature. Existing sufficient allowances can skip approval. Neither approval nor transaction submission marks a link paid: the API must verify and persist the payment. Network switching remains an explicit user action.

### Deployed router checkout setup

The user reports deployment and explorer verification of [CooketPayRouter at `0x1BB1348ab8900D0F04c483fBaeCfd6472D808EF9`](https://explorer.arc.io/address/0x1BB1348ab8900D0F04c483fBaeCfd6472D808EF9). Read-only public RPC inspection observed chain 5042 and runtime matching the local Solidity build byte-for-byte with the immutable Arc USDC address substituted. `USDC()` also returned that token at block **28629631**. The runtime hash is **`0x2c40f831959fd75019c2e52aef0f2c036c8f845c4847eef58dfb03597b384682`**. The explorer page could not be independently retrieved during this review. These checks establish code identity at the observed block, not a successful checkout or production configuration.

The public values are in `config/arc-mainnet-router.env.example`. For local testing, add its three variables to your existing ignored `.env.local` without replacing other settings; if no file exists, copy the example there. Both Bun's payment server and Vite load `.env.local`. Keep `VITE_PRIVY_APP_ID` configured as before. Restart both processes after configuration changes. `ARC_RPC_URL` selects the server RPC only; the frontend already uses the Arc Mainnet registry RPC. If an existing Arc Studio RPC proxy is configured, it takes precedence on the server.

For an approved future production rollout, set `VITE_COOKET_ROUTER_ADDRESS` and server-only `COOKET_ROUTER_CODE_HASH` to those values in the hosting environment. `ARC_RPC_URL=https://rpc.mainnet.arc.io` is optional because it is already the default. Retain the existing Privy and Supabase configuration. A new application build/deployment is required to publish code changes; changing a local file does not configure `app.cooket.fun`. No production settings were changed by this integration.

To test checkout yourself:

1. Start `bun run server` and `bun run dev`, or use an explicitly approved deployment with the same backend configuration. Inspect `/api/health`: expect chain 5042, the router address above, and `routerConfigured: true`. Health alone does not check deployed code or database connectivity.
2. Sign in as the merchant and create a **new** payment link. Creation checks router runtime and `USDC()` before storing the router with the link. Inspect `GET /api/links/<id>` and confirm its `router` is the deployed address. Existing links without a router remain legacy direct-transfer links; opening them does not convert them.
3. Open `/pay?id=<id>` with a **different** payer wallet. Explicitly switch to Arc Mainnet if prompted and retain enough USDC for payment plus gas (one shared balance).
4. For an insufficient allowance, click **Approve** and check the wallet request: token `0x3600000000000000000000000000000000000000`, spender the deployed router, exact checkout amount in 6-decimal units. Wait for confirmation, then click **Pay** separately. A sufficient existing allowance skips approval.
5. Check the pay request targets the router and calls `pay(keccak256(link ID text), merchant recipient, amountRaw, bytes32(0))` on chain 5042. You decide whether to sign and send these real transactions; automated tests do neither.
6. Wait for **Payment verified**, then confirm the merchant sees the payment. The browser registers the submitted hash through `POST /api/links/<id>/payments`; the server requires a successful canonical receipt, matching router event and actual system-emitter USDC movement. While verification is pending, use **Check existing payment** and do not pay again. Saved attempts recover after reload.

No new migration is introduced. Supabase must already match `0001_payment_links.sql` plus `0002_payment_links_router.sql`, including nullable `payment_links.router` and replay-protection keys. Inspect actual schema and migration history before any separately authorized migration; never blindly replay SQL on existing data.

### Production (Vercel)

The app is a Vite static site plus one Vercel Function for the payment link API.

- `api/index.mjs` serves everything under `/api/*`. It loads `api/_handler.mjs`, which the `vercel-build` script generates from `server/handler.ts` with esbuild (the file is not committed).
- `vercel.json` explicitly rewrites every API path depth to that concrete function, carrying the route in `__cooket_path`. The handler also accepts original URLs. A bracket-named function alone did not route nested `/api/links/<id>` requests in this Vite deployment, even while `/api/health` worked. Platform 404s are treated as service failures; only application JSON `not_found` errors mean a missing link.
- The browser calls `/api/...` on the same origin, so no CORS headers are sent or needed.
- `vercel.json` adds the single-page-app rewrite (everything except `/api` serves `index.html`), a 30 second function limit, and basic security headers.
- Reconcile the database schema and migration history using the sequence below; existing tables and data must be preserved.
- Set the environment variables above in the Vercel project (Production and Preview), then redeploy. Mark the Supabase service role key as sensitive.
- `GET /api/health` reports configured storage, chain ID, auth presence and router configuration. Missing Vercel storage or invalid router configuration returns 503. A 200 response is a configuration/liveness check: it does **not** contact Supabase or RPC, verify migration application, or establish router deployment.

### Supabase migration sequence

Production payment links, verified payments and creation nonces use Supabase Postgres through server-only PostgREST calls with `SUPABASE_SERVICE_ROLE_KEY`. There is no JSON production fallback on Vercel.

Before applying SQL, inspect the actual migration history, column types, constraints, RLS and grants in the target database. This review does not connect to production or establish its current schema.

1. For a new, empty project, apply `supabase/migrations/0001_payment_links.sql`, then `0002_payment_links_router.sql`. The baseline defines `payment_links`, `link_payments`, and `used_nonces`, their indexes and uniqueness constraints, and RLS with public-role privileges revoked.
2. For an existing database where the baseline is already recorded, preserve that history and apply only the new `0002` migration. It adds nullable `payment_links.router` if missing and otherwise does nothing to that column. It leaves all rows and legacy tables intact and reloads the PostgREST schema cache. Existing links with no router stay direct-transfer links. An existing incompatible router column causes a rollback.
3. `0002` assumes all other baseline columns, keys, types and RLS already exist. It does not repair arbitrary legacy schemas. If tables exist but `0001` is absent from the migration ledger, inspect and reconcile the ledger against the actual schema first; do not blindly replay the baseline over unknown live tables. `CREATE TABLE IF NOT EXISTS` does not repair missing columns or constraints.
4. Expected columns are `payment_links(id, owner_did, recipient, description, merchant, mode, amount_raw, expires_at, created_at, inactive, router)`, `link_payments(link_id, tx_hash, log_index, payer, amount_raw, block_number, paid_at, verified_at)`, and `used_nonces(nonce, used_at)`. Amounts and block numbers are text; timestamps are bigint milliseconds; log indices are integers. Replay protection depends on the `used_nonces(nonce)` and `link_payments(tx_hash, log_index)` primary keys; payment ownership depends on the `link_id` foreign key.
5. `bun run check:storage` performs read-only column/read-access checks against the explicitly configured project. It never inserts probe rows or deletes data. It cannot prove unique constraints or RLS on empty tables; inspect those separately. Use isolated local Postgres for mutation tests. No migration has been applied to production by this task.

Nonce reservation and link insertion are separate PostgREST requests. If insertion fails after reservation, creation fails closed and the merchant must create a fresh signature/nonce; it does not falsely report a created link.

### Tests

- `bun run contracts:test`: CooketPayRouter unit tests (Foundry).
- `bun run test:verify`: offline verifier fixtures, including counterfeit router code, wrong chain/event/link/payer/recipient/amount, missing movements, reorged or malformed receipts, and router/legacy replay.
- `bun run test:migrations`: disposable local PostgreSQL tests for fresh, current, and pre-router schemas, data preservation and uniqueness (requires local PostgreSQL binaries).
- `bun run test:router`: compatibility entry point for the same offline verifier fixtures. It never deploys contracts or signs transactions.
- `bun run test:router:abi`: reads the compiled router artifact and checks shared ABI selectors, outputs and indexed event fields. Run `bun run contracts:build` first. No RPC or transactions.
- `bun run test:router:checkout`: offline public-deployment configuration, immutable-runtime hash, exact approval and actual checkout-hook call checks with mocked wallet/RPC methods. Requires the compiled artifact. It never signs or sends transactions.
- `bun run test:router:anvil`: retained contract-to-verifier integration harness in `contracts/test-integration/router-anvil.ts`. It refuses to start without `COOKET_RUN_ANVIL_TRANSACTIONS=1`. **Do not opt in under a no-deployment/no-signing rule**: this harness deploys and signs on an unforked, loopback-only Anvil chain. Its test-only token emits both the canonical system Transfer at 18 decimals and the ERC-20 mirror at 6 decimals. It is an approximation of Arc logs and cannot establish real Arc behavior. This review only bundles the harness; it does not execute it.
- `bun run test:api`: the payment link API and storage layer, offline.
- `bun run test:public-checkout`: nested hosting rewrites, zero-USDC merchant creation, public checkout rendering for a funded payer, and mocked payment verification/duplicate registration. Uses disposable local storage and mocked auth/RPC; no real signatures or transactions.
- `bun run test:checkout-recovery`: offline reload, registration retry/idempotence, RPC outage and positive cancellation-evidence checks for router and legacy checkout.
- `bun run test:file-store`: development file-store preservation, read-error and concurrent-write tests against disposable local files.

The existing `scripts/compass-deploy.ts` imports `@circlefin/compass-chains`, which is absent from the package manifest/lockfile. The public npm registry lookup also returned HTTP 404 for that package. Full-project lint/typecheck remain blocked; obtain the intended package source and pinned version before changing dependencies. No substitute registry or guessed version is used, and no exclusion is added to the project checks. Payment verification tests do not import or execute deployment tooling.

### Network

Arc Mainnet only (chain ID 5042). USDC is the gas token. Chain, RPC, USDC address, and explorer come from Arc Studio's verified chain registry.

### Data

Contacts, notes, preferences, and records of payments sent from this browser live in local storage. Production payment links, verified payments, and signature nonces live in Supabase Postgres. Local development uses `server/data/db.json` only when Supabase is not configured. Browser preferences remain in local storage. Production readiness still requires verified migration history/RLS/constraints, server secrets, Privy origin setup, an independently verified router and pinned runtime hash if router checkout is enabled, and separate live RPC/Supabase verification. Offline tests and a local build do not establish any of these live conditions.

The development file store initializes empty only when the database path is absent. Empty, malformed, unreadable or non-regular existing files fail closed and are never automatically replaced. Writers use an exclusive `.lock` file, fresh reads and a pre-commit change check; a leftover lock requires manual inspection. This coordinates cooperating writers using the same path, not arbitrary external editors that ignore the lock.

Checkout restores saved pending and confirmed-but-unregistered payment-link transactions from local storage. It retries the existing server verification API without requesting another wallet signature; unresolved attempts block another payment. Generic RPC errors and missing transaction lookups remain unknown/pending, regardless of elapsed time. Failure requires a canonical reverted receipt or a confirmed same-nonce cancellation/reverted replacement; a replacement hash alone is insufficient. Recovery requires retained browser records and RPC/API availability; clearing browser storage or moving to another device is not covered.
