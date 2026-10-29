# Cooket: pre-deployment security audit (Cloudflare Pages)

Audit date: 2026-10-29. Scope: repository `marcellino511/cooket`, branch `main`.
No application code, Privy settings, or Arc Mainnet settings were changed. No commit was made; this file is untracked.

Legend: **[Verified]** = checked directly in this environment. **[Not verified]** = depends on something I could not check.

## 1. GitHub verification

- [Verified] Local `HEAD` and remote `main` are both `c0663d260c56dd6e063a0ccba4ee7fbeca9a012b`. Ahead/behind: 0/0.
- [Verified] Working tree is clean (0 modified or untracked files before this report was written).
- [Verified] `main` has exactly one commit and is the only branch. 99 tracked files.
- [Verified] Remote URL is `https://github.com/marcellino511/cooket.git` with no credentials embedded in it or in `.git/config`.
- [Verified] The GitHub CLI token is stored outside the repository (user config directory), not in tracked files.

## 2. Secrets audit

Checked: tracked files, the full history (1 commit), and the remote tree via the GitHub API. Values were never printed.

- [Verified] `.env`, `.env.*`, `*.jsonl` runtime logs, `.circle/`, `server/data/`, Foundry output and `lib/` are not tracked and were never in history.
- [Verified] No file in the remote tree or in history has a name matching env, secret, key, pem, recovery file, credential, mnemonic or seed patterns.
- [Verified] Content scan of all history found no private key blocks, GitHub tokens, Stripe/AWS/Slack-style keys, JWTs, seed phrases, or secret-named variables assigned to long literal values.
- [Verified] The only 64-hex literal in source is the public ERC-20 `Transfer` event signature in `server/verify.ts`.
- [Verified] Frontend reads one environment variable: `VITE_PRIVY_APP_ID` (a public Privy App ID, safe by Privy's design). No Privy App Secret is referenced anywhere in the code.
- [Verified] Server-side variables (`PORT`, `COOKET_DATA_FILE`, `RPC_PROXY_*`) are read only in `server/`, which is not part of the browser bundle. `DEPLOYER_PRIVATE_KEY` is referenced only by `scripts/compass-deploy.ts` (a deploy helper; reads it from `.env` at run time; not bundled).
- [Verified] Built bundle scan: no preview-domain strings, private key blocks or GitHub tokens. One hit for the text `APP_SECRET` is a Privy SDK error-code name (`insufficient_app_secret_permissions`), a false positive.
- [Not verified] Pattern scans cannot prove there are no secrets. Rotate anything that was ever pasted in chat or logs. A dedicated scanner (for example gitleaks or GitHub secret scanning) should be run before going public. The repository is public.

### Security findings

| # | Severity | Finding |
|---|----------|---------|
| S1 | Medium | `src/tracing.ts` and `src/console-capture.ts` (Arc Studio preview instrumentation) ship in the production bundle (verified: `studio-trace-event` is present in the build). They patch `fetch` and `console` and `postMessage` events to the parent frame. If a third-party site embeds Cooket in an iframe, it can receive request URLs, RPC calls and console output. Standalone, the messages go to the page itself. Remove or gate them for production, and add a `frame-ancestors` CSP. |
| S2 | Low | No `_headers` file: no CSP, `X-Content-Type-Options`, `Referrer-Policy` or `frame-ancestors`. Privy needs its own frames and endpoints allowed, so a CSP must be tested before enforcing. |
| S3 | Low | `bun audit` reports 35 advisories (14 high, 15 moderate, 6 low), all transitive. The ones traced come through `@privy-io/react-auth`, `wagmi`, `viem` and the preinstalled `@circle-fin/*` SDKs. 12 declared dependencies are not imported by the app (all `@circle-fin/*`, `@openzeppelin/contracts`, `@web3icons/react`, `connectkit`, `clsx`, `tailwind-merge`). Removing unused ones would shrink the surface. Which advisories reach the browser bundle was not analysed. |
| S4 | Info | The page footer badge "Built with Arc Studio" is hard-coded in `src/main.tsx`. A branding choice, not a security issue. |

## 3. Cloudflare Pages compatibility

- Framework: Vite 6 + React 18 + TypeScript. Output directory: `dist`.
- [Verified] `vite build` succeeds (31 s; largest chunk about 2.1 MB, 627 kB gzip; warning only).
- [Verified] `package.json` has **no `build` script**. `bun run build` would fail. Use the explicit command `bunx vite build`, or add a `"build": "vite build"` script (a code change, not made).
- [Verified] Required build-time variable: `VITE_PRIVY_APP_ID`. Vite inlines it at build time. If it is missing, the deployed app shows a "Privy is not configured" screen instead of crashing.
- [Not verified] Package manager: the repo has `bun.lock` and `.bun-version` (1.3.14). Cloudflare's build image Bun support and version selection were not checked; confirm in the Cloudflare dashboard.
- [Not verified] SPA routing: there is no `_redirects`. Routes such as `/send` and `/pay?id=...` need an `index.html` fallback. Cloudflare documents SPA fallback for projects without a top-level `404.html`, but this was not tested here.
- [Verified] Arc Mainnet configuration is unchanged (chain 5042, USDC `0x3600...0000`, RPC and explorer from the facts registry). Chain ID and USDC address are read from `src/onchain-facts.ts`, not typed in code.
- [Not verified] Privy Dashboard: the production domain must be added to allowed origins, and Email, Google, Wallet login and embedded wallets must be enabled. I have not touched the Privy configuration and did not add any preview domain. The production URL is not known yet.

### Backend: the main compatibility blocker

[Verified] Payment links, checkout and payment verification need the Node server in `server/`:

- The frontend calls a relative `/api/...` path. In development, Vite proxies it to `localhost:3001`. Cloudflare Pages serves static files only, so `/api` would return 404/HTML. Overview, Send, Receive, Activity, Contacts and Settings do not depend on it. **Payment Links and the public `/pay` checkout will not work.**
- The server uses `node:http` and writes a JSON file to disk (`server/data/db.json`). That runs on a Node host with a persistent disk; it does not run as-is on Cloudflare Workers or Pages Functions (no filesystem).
- There is no configurable API base URL. Pointing the frontend at a separately hosted server needs either a code change or a proxy rule on the same domain.
- The server verifies Privy tokens with the app's public signing keys and needs `VITE_PRIVY_APP_ID`; it does not need a Privy secret.

## 4. Blockers to fix before deploying

1. **Backend hosting decision** for payment links (separate Node host with durable storage, or a rewrite for Workers + D1/KV), plus a way for the frontend to reach it.
2. **Build command**: set `bunx vite build` with output `dist`, or add a `build` script.
3. **SPA fallback** confirmed for deep links (`/pay?id=...`).
4. **Privy allowed origins** for the real production domain, entered by you in the Privy Dashboard once the URL exists.
5. **S1**: remove or disable the Studio instrumentation in production builds and set `frame-ancestors`.

## 5. Safest next steps

1. Decide where the payment server runs. If you only want a first static deploy, deploy the frontend alone and accept that Payment Links will be unavailable (the UI will show a "could not load" error rather than fake data).
2. Prepare, in one reviewed commit: a `build` script, `public/_redirects` (`/* /index.html 200`), a `public/_headers` file with `X-Content-Type-Options`, `Referrer-Policy` and `frame-ancestors`, and removal of the Studio instrumentation from production. I have not made these changes; say the word and I will.
3. Create the Cloudflare Pages project from the GitHub repo with `VITE_PRIVY_APP_ID` set, get its URL, then add that URL to Privy allowed origins yourself.
4. Run a secret scanner and review the high advisories before announcing the repo or the app. Mainnet moves real funds; get an independent security review before real use.
