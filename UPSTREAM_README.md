# RugHawk

**Spot the rug before it's pulled.** Solana forensic intelligence for tokens and wallets, built by RaptorLabs (the team behind [Solmint.dev](https://solmint.dev)).

Colosseum **Crypto World's Fair** hackathon entry (Solana track). Open source under the [MIT license](LICENSE).

**Live:** https://rughawk.xyz

---

## The problem

Retail traders lose money in the first minutes of a Solana launch, not after it. We measured it on mainnet with RugHawk's own launch module. Out of 40 random dead pump.fun launches created on 11 October 2026, 28 deployers bought supply in the creation transaction. **23 of those 28 sold all of it, at a median of 59 seconds after launch.** Seven of them sold within 4 seconds, and none locked or burned the bag. Our September 2026 field study saw the same machine at scale: 10 of 13 trending tokens were dead within hours, and one serial launcher shipped 90 tokens in 36.7 hours.

Reproduce it with `npm run study`, which draws a fresh random sample. The method is in [`scripts/dev-exit-study.ts`](scripts/dev-exit-study.ts), and every launch of this run is listed with its result in [`docs/evidence/dev-exit-study-2026-10-12.json`](docs/evidence/dev-exit-study-2026-10-12.json).

Existing rug checkers are saturated on the same three checks: authorities, holder percentage, LP. They show a score; they do not show the operator.

## The wedge

RugHawk looks where the money is actually lost:

| Module | What it proves | How |
|---|---|---|
| **Launch forensics** | Dev buy at creation, every wallet that bought **in the launch block**, seconds until the deployer dumped, fake-holder spraying, dev bags moved to alt wallets | Locates the creation transaction even for hot launches (pump.fun curve creator at offset 49, fee-sharing PDA payer hop, graduated-curve walk), reads the creation block itself, and separates the deployer's sales from transfers, locks and burns, then checks the bag it holds now |
| **Deployer dossier** | Wallet age at launch, serial launching, funding trail to an exchange or a burner chain | Signature history plus first-inflow tracing, exchange-like heuristic (float and velocity) |
| **Authority audit** | Mint and freeze authority, mutable metadata, all Token-2022 traps | Parsed mint extensions: permanent delegate, transfer hook, fee config, default-frozen, pausable, rescalable UI amount |
| **Holder intelligence** | Concentration after removing pools, curves, burns, lockers and exchange custody | Owner-program and PDA classification, derived pool authorities |
| **Scam DNA** | "Same scam, new mint" | Predator AI embeddings of every token identity in a similarity index |
| **Site and logo forensics** | What the website really renders; whether the logo copies a brand | A real browser renders the page (text plus screenshot), then Predator AI reviews both, including image-only lures |
| **Wallet forensics** | Program upgradeability and verification, funding trail, approvals, address poisoning | Loader parsing, verified-build registry, lookalike detection |
| **Wallet Shield (dApp)** | Revoke live approvals, close empty accounts, reclaim rent | Signed SPL Token and Token-2022 `Revoke` and `CloseAccount` transactions |
| **Ask the Hawk** | A copilot that explains evidence and cannot be talked into lying | Deterministic scans plus the RugHawk playbook, behind an injection screen and a safety classifier |

Design rule: **the engine decides, Predator AI explains.** The score is deterministic (noisy-OR over weighted findings); AI never changes it. A young token whose launch cannot be verified is graded as unverified (medium finding), never as clean.

## Predator AI: one specialist per job

Predator AI is RaptorLabs' analysis layer. It explains the engine's evidence; it never scores.

| Job | How |
|---|---|
| Verdicts, market pulse, warning posts, Shield briefing | Schema-constrained JSON, valid on every run |
| Copilot and finding explanations | Streamed answers grounded in the scan digest and the matching playbook notes |
| Verdict translation (14 languages) | The whole verdict in one call, tickers and crypto terms kept intact |
| Logo check and rendered-site review | Multimodal: the screenshot and the page text go in one message |
| Scam DNA embeddings and search | Every token identity embedded; plain-words search over everything flagged |
| Playbook retrieval | Retrieved notes re-ranked by relevance to the question |
| Copilot input safety | A pattern-based injection screen, then a hazard classifier |
| Voice questions | Multilingual speech recognition with key-term prompting for "pump.fun", "Token-2022", "Raydium" |
| Spoken verdicts, answers, pulse and briefings | English and Spanish voices; the Spanish verdict is read by the Spanish voice |

What it powers on the site:

- **Hawk verdict** on every report, in 15 languages, with a Listen button.
- **Explain** on every finding: a streamed plain-English briefing grounded in the finding, the scan digest and the playbook.
- **Ask the Hawk** by text or voice: the recording stops when you go quiet, the answer comes back in the language you asked in, and a spoken question gets a spoken answer.
- **Warning post**: an X post and a Telegram message written from the findings, editable before posting.
- **Scam DNA search** on the home page: describe a token in words and the nearest flagged identities come back with their grades.
- **Shield briefing**: approvals, seizable holdings and reclaimable rent explained to the wallet owner, with the actions to take.
- **Market pulse** with Listen, **site review** over text and screenshot, **logo forensics**.

## Built for Solana's speed

- **Two RPC roles, routed per method** ([`lib/rpc.ts`](lib/rpc.ts)). An archive node answers every history walk and heavy index method. A hot-state node shares the current-state reads and recent transactions inside its retention window. Each role has its own request budget. A node that answers 429 or 5xx is cooled down and the other takes the traffic, and a null transaction from the hot node is re-checked on the archive node before it is believed. Reports carry the per-role call split.
- **The launch block, read directly.** Bundles are detected from the creation block itself, not from a third-party label.
- **Seconds, not minutes.** The launch module read all 40 launches of the study above, creation transaction to deployer exit, in under a minute: about 15 RPC calls per launch.
- **Watchtower.** Watched tokens are re-scanned every 10 minutes; a worsened grade, a liquidity collapse or a deployer sale becomes an alert on the token page, on Telegram and on API webhooks.

## Run it

```bash
npm install
cp .dev.vars.example .dev.vars        # add your Solana mainnet RPC endpoints
npm run scan -- token <mint>          # the engine against mainnet from the terminal
npm run scan -- wallet <address>
npm run study                         # re-measure the dev-exit statistic on a fresh sample
npm test && npm run typecheck
npm run dev                           # local web app
```

Continuous deployment: every push and pull request runs the typecheck and the test suite, and every push to `main` deploys to production and smoke-tests the live site.

## API

| Endpoint | |
|---|---|
| `GET /api/scan?address=` | Auto-detects mint vs wallet, returns the report |
| `GET /api/scan/token?mint=` | Token report |
| `GET /api/scan/wallet?address=` | Wallet or program report |
| `GET /api/shield?owner=` | Approvals, seizable tokens, reclaimable rent |
| `GET /api/ai/verdict?kind=&address=` | Predator AI verdict (cached per score) |
| `POST /api/ai/ask` | Copilot; `stream: true` returns server-sent events (`meta`, `delta`, `done`) |
| `POST /api/ai/explain` | One finding explained (`kind`, `address`, `findingId`), server-sent events, cached per score |
| `POST /api/ai/share` | Warning post for X and Telegram (`kind`, `address`), cached per score |
| `GET /api/ai/memory?q=` | Scam DNA searched in plain words |
| `POST /api/ai/shield` | Shield report of a wallet briefed in plain English (`owner`) |
| `POST /api/ai/transcribe` | Spoken question (audio body) as text |
| `POST /api/ai/translate` | Verdict in another language (`kind`, `address`, `score`, `lang`) |
| `GET /api/ai/pulse` | 24-hour market pulse: engine counts, phrased by Predator AI, cached 10 minutes |
| `POST /api/ai/speak` | Text as audio (audio/mpeg), `lang` `en` or `es` |
| `POST /api/ai/site` | Rendered-site review over the page text and screenshot (3 free a day, Pro unlimited) |
| `GET /api/ai/logo?mint=` | Logo brand-impersonation check (same daily allowance) |
| `GET /api/og/token/<mint>` | Shareable 1200x630 risk card |
| `GET /api/feed` | Latest flagged tokens plus totals |
| `POST /api/watch`, `GET /api/watch?address=` | Watchtower |
| `GET /api/health` | Service and RPC role health |

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

**Accuracy pass.** The first deployment treated every token that left the deployer wallet as a sale. On the live feed that put a wrong "deployer dumped" headline on 11 of 24 tokens: 6 deployers had locked their bag in Streamflow, 3 had burned tokens, 1 had moved its bag to two wallets and 1 had sprayed dust to fake holders. The engine now reads the deployer's token account history, classifies every outflow (sale, transfer, lock, burn), checks the bag the deployer holds now, and reports what it cannot verify as unverified: never as clean, never as a dump. Regression tests cover each case, and the headline statistic above was re-measured with the same classifier.

Predator AI checks on production: verdicts in about 4 seconds, the copilot grounded in the playbook, injection attempts blocked, the safety classifier active, spoken verdicts in under 2 seconds, rendered-site review with screenshot evidence, logo vision, Scam DNA similarity search.

## Business model

- **Free**: 25 scans a day, Predator AI verdicts in 15 languages, 3 site and logo deep checks a day, Shield, share cards and AI-written warning posts (distribution engine: every shared report is an ad).
- **Pro $19/mo**: unlimited scans, Watchtower alerts on Telegram, unlimited site and logo forensics, web intel.
- **API from $99/mo**: Telegram trading bots, launchpads, wallets (they already pay for rug checks).
- **Shield reclaim fee**: optional, disclosed % of reclaimed rent, fail-closed when no treasury is configured.

## Free tier abuse resistance

A free allowance keyed by IP alone throttles shared addresses (mobile carriers, offices) and is trivially rotated through proxies; one keyed by wallet alone is keyed by nothing, since a keypair is free. RugHawk combines three layers ([`lib/access.ts`](lib/access.ts), [`lib/eligibility.ts`](lib/eligibility.ts)):

1. **Identity.** A signed-in wallet that holds at least 0.01 SOL and has at least 5 signatures gets its own daily allowance. Manufacturing such wallets in bulk costs SOL and transactions. Every other visitor, anonymous or signed in with an empty keypair, shares the network address's allowance, so a thousand fresh wallets from one address are worth one address. Eligibility is read from the chain (balance plus newest signatures) and cached a day.
2. **Address ceiling.** A second counter caps every free run from an address whichever wallets sign in from it (4x the scan allowance, 3x the deep-check allowance), so cycling funded wallets through one connection runs out too.
3. **Sign-in for anything that costs real money.** Site renders and logo vision need a signed session: the wallet is the account, and the sign-in is the first step of the upgrade. Cached results never consume an allowance, and the edge rate limits plus an AI spend limit are the global circuit breakers.

## Security posture

Provider credentials live only as server-side secrets. The RPC relay is origin-checked and method-allowlisted, and public responses name RPC roles, never providers or endpoints. Every input address is validated. The copilot screens every message for injection patterns and runs a safety classifier before Predator AI sees it; the model only explains deterministic evidence and cannot trigger actions. Shield builds transactions client-side and the user signs them in their own wallet; RugHawk never holds keys. Report security issues to security@raptorlabs.dev.

## Accounts and billing

Plans match the pricing section: Free (25 fresh scans a day, 3 deep checks a day), Pro at $19/month, API at $99/month with 50,000 scan calls a month. The wallet is the account: a visitor connects a Solana wallet, signs one message (Sign In With Solana, checked with Ed25519) and gets an HMAC-signed session cookie. Checkout carries the wallet as the client reference; a signed webhook mirrors subscriptions into the database and entitlements are read from there. Card details never touch RugHawk.

Routes: `POST /api/auth/nonce`, `POST /api/auth/verify`, `POST /api/auth/logout`, `GET /api/me`, `POST /api/billing/checkout`, `POST /api/billing/portal`, `GET /api/billing/sync`, `POST /api/account/api-key` (and DELETE), `PUT /api/account/webhook`, `POST /api/account/telegram` (and DELETE), `DELETE /api/watch`. Account page: `/account`.

API plan: send `Authorization: Bearer rh_live_...` to `/api/scan/token`, `/api/scan/wallet` or `/api/scan`. Responses carry `X-RugHawk-Quota-Limit`, `X-RugHawk-Quota-Used` and `X-RugHawk-Quota-Remaining`; the quota resets on the first of the month. Watchtower alerts for API customers are POSTed to their webhook URL with `X-RugHawk-Signature: t=<unix>,v1=<HMAC-SHA256(secret, t + "." + body)>`.

## License

MIT, see [LICENSE](LICENSE).
