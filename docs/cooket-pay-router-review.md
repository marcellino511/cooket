# CooketPayRouter: review package for Arc Microgrants

Status: built and tested locally. NOT deployed. Nothing has been signed or sent on Arc Mainnet.

## 1. Competition rules (what was verified, what was not)

Source used: the CompeteHub mirror of the "Arc Microgrants: Built with Arc Studio" edition. The official page
(https://dorahacks.io/hackathon/arc-microgrants) renders with JavaScript and returned no readable rules, so confirm every item there.

Stated requirements (mirror):
- Smart contracts written and tested in Arc Studio and deployed to Arc mainnet.
- A working app built in Arc Studio that calls those contracts, live at a public link.
- At least one Arc mainnet transaction that moves USDC through the contract and the app.
- Submission: Arc Studio project URL, live app link, contract address(es) and one example tx hash linked on explorer.arc.io,
  public repo, video walkthrough (build in Arc Studio plus the mainnet transaction), short description, public builder profile.
- Scoring: real USDC on mainnet 30%, Arc Studio use across contracts/testing/app 25%, working product 25%, potential 20%.
- Deadline shown: 1 November 2026. Other editions of the page show earlier dates, so check the live page.

Fit: a checkout contract that moves USDC for Payment Links matches "escrow and conditional payouts / payments" themes and the
"contract + app + mainnet tx" requirement. It does not by itself satisfy them until it is deployed and one real payment is made.

## 2. Verified network facts

- Arc Mainnet chain ID 5042 (RPC returned 0x13b2). RPC https://rpc.mainnet.arc.io. Explorer https://explorer.arc.io.
- USDC ERC-20: 0x3600000000000000000000000000000000000000 (registry), read live: symbol USDC, name USDC, decimals 6.
- Arc's native currency is also USDC (18 decimals in the native view), so the router has no payable functions.

## 3. The contract (`contracts/CooketPayRouter.sol`, 70 lines, Solidity 0.8.28 build)

- `constructor(IERC20 usdc_)`: token fixed forever; reverts `InvalidToken(address)` for zero address or no code.
- `pay(bytes32 linkId, address recipient, uint256 amount, bytes32 reference_)`: payer is always `msg.sender`;
  reverts `ZeroLinkId`, `InvalidRecipient(address)` (zero, the router, the USDC token), `ZeroAmount`;
  then `SafeERC20.safeTransferFrom(msg.sender, recipient, amount)` and emits
  `PaymentReceived(linkId, payer, recipient, amount, reference_)`.
- No owner, admin, fee, pause, upgrade, withdraw, receive/fallback, payable function, assembly or delegatecall.
  Funds go payer to recipient and are never held.

## 4. Review results

- Security review (max depth), two rounds: one low finding (custom errors lacked the rejected address). Fixed. Round 2: no material findings.
- Functional review (max depth), two rounds: no material findings. Noted assumptions: the contract accepts any link id, so the
  server must bind payments to links (done), and `recipient == payer` can produce matching logs with no net receipt (server rejects it).
- Slither: 1 informational (naming of the immutable `USDC`). No other findings.
- This is not a substitute for an independent professional audit before real users or large funds.

## 5. Tests

`forge build` and `forge test`: 26 passed, 0 failed (24 unit/fuzz, 2 invariants at 256 runs x 128,000 calls).
Covered: success with exact balances and event fields, zero amount, zero link id, invalid recipient (zero, router, USDC token),
insufficient allowance, no allowance, insufficient balance, token returning false, token reverting (blocklist style),
constructor rejects zero/EOA, payer is always the caller (cannot spend another wallet's allowance), native value rejected,
self-payment allowed, zero reference allowed, fuzz on all inputs, router never holds tokens or native value.

Server verification test (`bun run test:router`, local anvil with chain ID 5042, mock 6-decimal token at the USDC address,
real router bytecode from the compiled artifact): 20 passed, 0 failed. It confirms the shared ABI matches the compiled contract,
a correct payment verifies, and these are rejected: another link's id, another recipient, wrong fixed amount, self-payment,
direct transfer on a router link, event from a copycat router, payment before the link existed, payment after expiry,
a link bound to a non-router address, a reverted transaction, an unknown transaction.

Limit: plain anvil cannot run Arc's native-backed USDC (a mainnet fork reverts on any USDC transfer), so the test proves the
server logic, not how Arc's own USDC logs `transferFrom`. The server accepts either the USDC ERC-20 Transfer log or Arc's
system Transfer log as evidence of movement. Confirm on the first mainnet payment.

## 6. Application changes (existing features kept)

- `src/shared/router.ts` (new): router ABI, link id hash (`keccak256(link id text)`), address parsing.
- `server/verify.ts`: router links are credited only from a `PaymentReceived` event emitted by that link's router, with this
  link's id hash and recipient, exact amount for fixed links, payer different from recipient, inside the link's time window, in a
  successful transaction on chain 5042, plus a real USDC movement from payer to recipient earlier in the same transaction.
  The router address is checked on chain first (has code, `USDC()` equals the canonical USDC). Each event is credited once.
  The frontend's "success" is never trusted: the server re-reads the chain.
- `server/index.ts`, `server/config.ts`, `server/db.ts`: new links store the router they were created with; the merchant's
  creation signature now includes the router address. Links without a router keep the old direct-transfer verification.
- `src/chain/useRouterCheckout.ts` (new) and `src/features/checkout/CheckoutCard.tsx`: for router links, checkout is two explicit
  steps: approve exactly the payment amount, then pay. The amount, recipient and contract address are shown before each signature.
  Send USDC (`useSendUsdc`) is unchanged.
- `src/features/links/CreateLinkModal.tsx`, `src/api/links.ts`: reads the router from the server before the merchant signs.
- Config: `VITE_COOKET_ROUTER_ADDRESS` (public address, read by the server). Unset means links keep using direct transfers.

## 7. Deployment plan (you run this with your own wallet)

Arc Studio's tools deploy to testnets only and cannot deploy to or sign on mainnet. Deploy from your machine or wallet:

```bash
export PRIVATE_KEY=...        # your deployer key, never paste it in chat or commit it
forge build
forge create contracts/CooketPayRouter.sol:CooketPayRouter \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key "$PRIVATE_KEY" \
  --gas-price 25gwei --priority-gas-price 1gwei \
  --broadcast \
  --constructor-args 0x3600000000000000000000000000000000000000
```

Arc enforces a minimum fee of 20 gwei; adjust the gas flags if the node rejects them. Gas is paid in USDC.

After deployment:
1. `cast call <ROUTER> "USDC()(address)" --rpc-url https://rpc.mainnet.arc.io` must print the USDC address above.
2. Put the address in the server environment as `VITE_COOKET_ROUTER_ADDRESS=<ROUTER>` and restart the payment server.
3. Create a link in Cooket (you sign the creation message), then pay it from a DIFFERENT wallet with a small amount
   (a wallet cannot pay its own link). Approve, then pay; the checkout shows the amounts before each signature.
4. Confirm the transaction and the `PaymentReceived` event on https://explorer.arc.io, and that the link shows the payment as verified.

## 8. Blockers and open questions

- Public live app: the payment server (`server/`) must be hosted somewhere reachable, with durable storage, and the frontend's
  `/api` calls routed to it. A static host such as Vercel alone cannot run it, so Payment Links and checkout would not work there.
  This is not built yet.
- Privy: the live domain must be added to the Privy allowed origins by you.
- "Deployed in Arc Studio": mainnet deployment happens outside Arc Studio's tools. Ask the organisers whether that satisfies the rule.
- Unverified on mainnet: how Arc's USDC logs `transferFrom` (see section 5). Fallback evidence is accepted by the server.
- The deployed bytecode must be the same source that is committed and tested; commit before deploying.

## Update: payment link API hosting

The server now runs as a Vercel Function (`api/[...path].mjs`, same origin as the app, so no CORS) with durable Supabase storage (`supabase/migrations/0001_payment_links.sql`). On Vercel without Supabase variables it returns 503 instead of using the disk. See README "Production (Vercel)". The earlier "server has no public hosting" blocker is resolved in code; it still needs the Supabase project, the environment variables, and a redeploy.
