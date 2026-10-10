# RugHawk

**Spot the rug before it's pulled.** Solana forensic intelligence for tokens and wallets, built on Cloudflare Workers AI and QuickNode by RaptorLabs (the team behind [Solmint.dev](https://solmint.dev)).

Colosseum **Crypto World's Fair** hackathon entry (Solana track).

**Live:** https://rughawk.xyz (custom domain on the Worker; `www.rughawk.xyz` redirects to it; https://rughawk.plain-forest-6a44.workers.dev remains the fallback hostname).

---

## The problem

Retail traders lose money in the first minutes of a Solana launch, not after it. Our own mainnet study (September 2026) measured it: on 13 of 13 dead control launches the creator exited, with a median of **7 seconds** after launch; 10 of 13 trending tokens were dead within hours; one serial launcher shipped 90 tokens in 36.7 hours.

Existing rug checkers (RugCheck, SolSniffer, terminal badges) are saturated on the same three checks: authorities, holder percentage, LP. They show a score; they do not show the operator.

## The wedge

RugHawk looks where the money is actually lost:

| Module | What it proves | How |
|---|---|---|
| **Launch forensics** | Dev buy at creation, every wallet that bought **in the launch block**, seconds until the deployer dumped, fake-holder spraying, dev bags moved to alt wallets | Locates the creation tx even for hot launches (pump.fun curve creator at offset 49, fee-sharing PDA payer hop, graduated-curve walk), reads the creation block via `getBlock`, and separates the deployer's sales from transfers, locks and burns, then checks the bag it holds now |
| **Deployer dossier** | Wallet age at launch, serial launching, funding trail to an exchange or a burner chain | Signature history + first-inflow tracing, exchange-like heuristic (float/velocity) |
| **Authority audit** | Mint/freeze authority, mutable metadata, all Token-2022 traps | `jsonParsed` extensions: permanent delegate, transfer hook, fee config, default-frozen, pausable, rescalable UI amount |
| **Holder intelligence** | Concentration after removing pools, curves, burns, lockers and exchange custody | Owner-program and PDA classification, derived pool authorities |
| **Scam DNA** | "Same scam, new mint" | Workers AI embeddings (bge-base-en-v1.5) in Vectorize |
| **Site & logo forensics** | What the website really renders; whether the logo copies a brand | Browser Run `quickAction()` + Llama 4 Scout (text and vision) |
| **Wallet forensics** | Program upgradeability/verification, funding trail, approvals, address poisoning | BPF loader parsing, OtterSec verify registry, lookalike detection |
| **Wallet Shield (dApp)** | Revoke live approvals, close empty accounts, reclaim rent | Signed SPL Token / Token-2022 `Revoke` and `CloseAccount` transactions |
| **Ask the Hawk** | A copilot that explains evidence and cannot be talked into lying | Deterministic scans + AI Search + Llama 4 Scout, behind an injection check and Llama Guard 3 |

Design rule: **the engine decides, the LLM explains.** The score is deterministic (noisy-OR over weighted findings); AI never changes it. A young token whose launch cannot be verified is graded as unverified (medium finding), never as clean.

## Cloudflare platform map (Startups grant)

| Product | Use |
|---|---|
| Workers + Static Assets (OpenNext) | Next.js 16 app and API, one Worker |
| Workers AI | One model per job, see the table below: Llama 4 Scout, Llama 3.3 70B, Gemma 4, Llama Guard 3, bge-base-en-v1.5, bge-reranker-base, Deepgram Nova-3, Deepgram Aura-2 |
| AI Gateway | Every AI call routed through `AI_GATEWAY_ID` (currently the auto-created `default`; create `rughawk-ai` for per-app logs, caching, spend limit and Guardrails, including the Prompt Guard P1 injection category) |
| AI Search | Instance `rughawk-playbook` (5 docs), created and filled at runtime by `/api/admin/setup` |
| Web Search API (beta) | Wired into the copilot (`WEB_SEARCH=on`); needs prepaid AI Gateway credits (the API answers 402 until credits are loaded) |
| Vectorize | Scam DNA index `rughawk-dna` (768-dim, cosine) |
| Browser Run | Renders token websites (markdown + screenshot) for the drainer-lure review |
| D1 | Scan history, deployer linkage, feed, watchlist, alerts |
| KV | Report, metadata, RDAP and funding-trace cache |
| R2 | Report snapshots, screenshots, Next.js incremental cache |
| Rate Limiting bindings | Per-IP limits on scans, AI and the RPC relay |
| Cron Triggers | Watchtower re-scans every 10 minutes |

### Workers AI: one model per job

The engine decides, the model explains. Every call goes through AI Gateway; every model was picked for its job (`lib/ai/workers-ai.ts`):

| Job | Model | Why this one |
|---|---|---|
| Verdicts, market pulse, warning posts, Shield briefing (schema-constrained JSON) | `@cf/meta/llama-4-scout-17b-16e-instruct` | Valid JSON every run in about 1.6 s through the gateway; the fastest mixture-of-experts model for latency-bound explanations |
| Copilot and finding explanations (streamed) | Llama 4 Scout, fallback `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Token streaming, 131K context for scan digests plus playbook notes |
| Verdict translation (14 languages) | `@cf/google/gemma-4-26b-a4b-it`, fallback `@cf/meta/m2m100-1.2b` | 140+ languages, structured output, a third of Scout's price; translates the whole verdict in one call with tickers and crypto terms intact |
| Logo check and rendered-site review (image plus text) | Llama 4 Scout (vision) | Natively multimodal: the screenshot from Browser Run and the page markdown go in one message, so image-only lures ("Connect wallet" buttons) count |
| Scam DNA embeddings and DNA search | `@cf/baai/bge-base-en-v1.5` | 768 dimensions, the size of the Vectorize index |
| Playbook re-ranking | `@cf/baai/bge-reranker-base` | Orders the retrieved notes by relevance to the question |
| Copilot input safety | `@cf/meta/llama-guard-3-8b` | MLCommons hazard classification; the pattern-based injection screen runs first |
| Voice questions | `@cf/deepgram/nova-3`, fallback `@cf/openai/whisper-large-v3-turbo` | Multilingual, language detection, key-term prompting for "pump.fun", "Token-2022", "Raydium" |
| Spoken verdicts, answers, pulse and briefings | `@cf/deepgram/aura-2-en`, fallback `@cf/deepgram/aura-1`; `@cf/deepgram/aura-2-es` for Spanish | Context-aware pacing; the Spanish verdict is read by the Spanish voice |

What the models power on the site:

- **Hawk verdict** on every report, in 15 languages, with a Listen button (English and Spanish voices).
- **Explain** on every finding: a streamed plain-English briefing grounded in the finding, the scan digest and the matching playbook notes.
- **Ask the Hawk** by text or voice: the recording stops when you go quiet, the answer comes back in the language you asked in, and a spoken question gets a spoken answer.
- **Warning post**: an X post and a Telegram message written from the findings, editable before posting.
- **Scam DNA search** on the home page: describe a token in words and the nearest flagged identities in Vectorize come back with their grades.
- **Shield briefing**: approvals, seizable holdings and reclaimable rent explained to the wallet owner, with the actions to take.
- **Market pulse** with Listen, **site review** over text and screenshot, **logo forensics**.

RPC: two providers side by side, routed per method in `lib/rpc.ts` (measured on mainnet 2026-10-08):

| Provider | Role | Gets |
|---|---|---|
| QuickNode endpoint 672714 (label RugHawk) | Archive node (`getFirstAvailableBlock` = 0) | Every history walk (`getSignaturesForAddress`), heavy index methods (`getTokenLargestAccounts`: 0.3 s here, 13 to 20+ s on Ankr), transaction submission, half of the state reads |
| Ankr Solana | Hot-state node (keeps about 14 hours of ledger; older blocks answer "cleaned up", older transactions answer null) | The other half of the state reads, `getTransaction` and `getBlock` for slots inside its retention window (probed every 10 minutes) |

Each provider has its own per-isolate budget (20 rps by default, `QUICKNODE_RPC_RPS` / `ANKR_RPC_RPS`); the QuickNode account cap is 50 rps shared with Solmint's production endpoints. A provider that answers 429 or 5xx is cooled down and the other one takes the traffic; a null transaction from the hot node is re-checked on the archive node before it is believed. Reports carry the per-provider call split (`rpcProviders`).

## Run it

```bash
npm install
cp .dev.vars.example .dev.vars        # add QUICKNODE_RPC_URL and ANKR_RPC_URL
npm run scan -- token <mint>          # engine against mainnet from the terminal
npm run scan -- wallet <address>
npm run dev                           # Next.js dev server
npm run preview                       # OpenNext build + local workerd
```

Deploy (Cloudflare account already has D1, KV and R2 provisioned; ids in `wrangler.jsonc`):

```bash
npx wrangler login
./scripts/setup-cloudflare.sh         # Vectorize, schema, secrets, deploy, AI Search
```

## API

| Endpoint | |
|---|---|
| `GET /api/scan?address=` | Auto-detects mint vs wallet, returns the report |
| `GET /api/scan/token?mint=` | Token report |
| `GET /api/scan/wallet?address=` | Wallet / program report |
| `GET /api/shield?owner=` | Approvals, seizable tokens, reclaimable rent |
| `GET /api/ai/verdict?kind=&address=` | AI verdict (cached per score) |
| `POST /api/ai/ask` | Copilot; `stream: true` returns server-sent events (`meta`, `delta`, `done`) |
| `POST /api/ai/explain` | One finding explained (`kind`, `address`, `findingId`), server-sent events, cached per score |
| `POST /api/ai/share` | Warning post for X and Telegram (`kind`, `address`), cached per score |
| `GET /api/ai/memory?q=` | Scam DNA searched in plain words (embedding + Vectorize) |
| `POST /api/ai/shield` | Shield report of a wallet briefed in plain English (`owner`) |
| `POST /api/ai/transcribe` | Spoken question (audio body) as text (Nova-3, Whisper fallback) |
| `POST /api/ai/translate` | Verdict in another language (`kind`, `address`, `score`, `lang`) |
| `GET /api/ai/pulse` | 24-hour market pulse: engine counts, phrased by Predator AI, cached 10 minutes |
| `POST /api/ai/speak` | Text as audio (audio/mpeg), `lang` `en` or `es` |
| `POST /api/ai/site` | Browser Run site review over the page text and screenshot (3 free a day per IP, Pro unlimited) |
| `GET /api/ai/logo?mint=` | Logo brand-impersonation check (same daily allowance) |
| `GET /api/og/token/<mint>` | Shareable 1200x630 risk card |
| `GET /api/feed` | Latest flagged tokens + totals |
| `POST /api/watch`, `GET /api/watch?address=` | Watchtower |
| `GET /api/health` | Service and RPC provider health |

## Validation (production, 2026-10-07)

30 real tokens scanned on the live deployment: 28 fresh pump.fun and Meteora DBC launches plus two controls (BONK, PYUSD). Result: 22 CRITICAL, 3 HIGH, 1 ELEVATED, 4 LOW (both controls LOW 0). Every grade is backed by on-chain evidence, for example:

| Token | Grade | Evidence |
|---|---|---|
| JET | CRITICAL | 6 wallets bought 81.2% of supply in the launch block; the deployer then sprayed dust into at least 72 fresh wallets to fake a holder count |
| SG | CRITICAL | Deployer dumped 100% of its bag 6 minutes after launch through a trading-bot router (CPI into pump.fun) |
| pls | CRITICAL | Deployer dumped 100% of a 15.7% bag 1 second after launch |
| "TRUMP" clone | CRITICAL | Impersonates the real TRUMP mint; deployer dumped 100% of its bag 38 seconds after launch |
| SCraft | CRITICAL | 4 wallets took 31.6% in the launch block; the deployer bought 25.9% at creation and locked all of it in Streamflow 99 seconds later |
| Infection | CRITICAL | 8 wallets took 37.1% in the launch block; the deployer moved its 4.5% bag to 2 other wallets 5 minutes after launch |
| BONK | LOW 0 | Canonical mint; exchange custody recognised |
| PYUSD | LOW 0 | Permanent delegate and freeze shown as expected for a regulated issuer |

**Accuracy pass.** The first deployment treated every token that left the deployer wallet as a sale. On the live feed that put a wrong "deployer dumped" headline on 11 of 24 tokens: 6 deployers had locked their bag in Streamflow, 3 had burned tokens, 1 had moved its bag to two wallets and 1 had sprayed dust to fake holders. The engine now reads the deployer's token account history, classifies every outflow (sale, transfer, lock, burn), checks the bag the deployer holds now, and reports what it cannot verify as unverified: never as clean, never as a dump. Regression tests cover each case.

Live AI checks: Llama 4 Scout verdicts (about 4 s, gateway-routed), copilot grounded in AI Search, injection attempts blocked, Llama Guard 3 active, Aura voice (MP3 in 1.8 s), Browser Run render plus R2 screenshot, logo vision, Vectorize Scam DNA (30 vectors).

## Business model

- **Free**: 25 scans/day, AI verdicts in 15 languages, 3 site and logo deep checks a day, Shield, share cards and AI-written warning posts (distribution engine: every shared report is an ad).
- **Pro $19/mo**: unlimited scans, Watchtower alerts on Telegram, unlimited site/logo forensics, web intel.
- **API from $99/mo**: Telegram trading bots, launchpads, wallets (they already pay for rug checks).
- **Shield reclaim fee**: optional, disclosed % of reclaimed rent, fail-closed when no treasury is configured.

## Security posture

Endpoint tokens live only as Worker secrets. The RPC relay is origin-checked and method-allowlisted. Every input address is validated. The copilot screens every message for injection patterns and runs Llama Guard 3 before the model sees it; the model only explains deterministic evidence and cannot trigger actions. Shield builds transactions client-side and the user signs them in their own wallet; RugHawk never holds keys. Report security issues to security@raptorlabs.dev.

## Billing (Stripe)

Plans match the pricing section: Free (25 fresh scans a day per IP, 3 deep checks a day per IP via `FREE_DEEP_CHECKS_PER_DAY`), Pro at $19/month, API at $99/month with 50,000 scan calls a month. The wallet is the account: a visitor connects a Solana wallet, signs one message (Sign In With Solana, checked with Ed25519 in WebCrypto) and gets an HMAC-signed session cookie. Stripe Checkout carries the wallet as `client_reference_id`; the webhook at `/api/billing/webhook` mirrors subscriptions into D1 and entitlements are read from there.

Stripe objects (live account): products RugHawk Pro and RugHawk API, monthly prices with lookup keys `rughawk_pro_monthly` and `rughawk_api_monthly`, one Payment Link per plan, a webhook endpoint for `checkout.session.completed`, `customer.subscription.*` and `invoice.payment_failed`, and a Billing Portal configuration with the hosted login page.

Secrets (`npx wrangler secret put`): `SESSION_SECRET`, `STRIPE_WEBHOOK_SECRET`, optionally `STRIPE_SECRET_KEY` (a restricted key: with it checkout uses Checkout Sessions, management uses Billing Portal sessions, plan changes are prorated in place, and the account page activates the plan before the webhook lands; without it the Payment Links and the hosted portal page do the same job) and `TELEGRAM_BOT_TOKEN` (with the `TELEGRAM_BOT_NAME` var) for Watchtower alerts on Telegram. Vars in `wrangler.jsonc`: price ids, Payment Links, portal URL, `FREE_SCANS_PER_DAY`, `API_CALLS_PER_MONTH`.

Routes: `POST /api/auth/nonce`, `POST /api/auth/verify`, `POST /api/auth/logout`, `GET /api/me`, `POST /api/billing/checkout`, `POST /api/billing/portal`, `GET /api/billing/sync`, `POST /api/account/api-key` (and DELETE), `PUT /api/account/webhook`, `POST /api/account/telegram` (and DELETE), `DELETE /api/watch`. Account page: `/account`.

API plan: send `Authorization: Bearer rh_live_...` to `/api/scan/token`, `/api/scan/wallet` or `/api/scan`. Responses carry `X-RugHawk-Quota-Limit`, `X-RugHawk-Quota-Used` and `X-RugHawk-Quota-Remaining`; the quota resets on the first of the month. Watchtower alerts for API customers are POSTed to their webhook URL with `X-RugHawk-Signature: t=<unix>,v1=<HMAC-SHA256(secret, t + "." + body)>`.
