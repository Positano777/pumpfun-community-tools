# RugHawk

**Spot the rug before it's pulled.** Solana forensic intelligence for tokens and wallets, built on Cloudflare Workers AI and QuickNode by RaptorLabs (the team behind [Solmint.dev](https://solmint.dev)).

Colosseum **Crypto World's Fair** hackathon entry (Solana track). Domain set reserved for launch: `rughawk.com` · `rughawk.app` · `rughawk.dev`.

---

## The problem

Retail traders lose money in the first minutes of a Solana launch, not after it. Our own mainnet study (September 2026) measured it: on 13 of 13 dead control launches the creator exited, with a median of **7 seconds** after launch; 10 of 13 trending tokens were dead within hours; one serial launcher shipped 90 tokens in 36.7 hours.

Existing rug checkers (RugCheck, SolSniffer, terminal badges) are saturated on the same three checks: authorities, holder percentage, LP. They show a score; they do not show the operator.

## The wedge

RugHawk looks where the money is actually lost:

| Module | What it proves | How |
|---|---|---|
| **Launch forensics** | Dev buy at creation, every wallet that bought **in the launch block**, seconds until the deployer dumped | Locates the creation tx even for hot launches (pump.fun curve creator at offset 49, fee-sharing PDA payer hop, graduated-curve walk) and reads the creation block via `getBlock` |
| **Deployer dossier** | Wallet age at launch, serial launching, funding trail to an exchange or a burner chain | Signature history + first-inflow tracing, exchange-like heuristic (float/velocity) |
| **Authority audit** | Mint/freeze authority, mutable metadata, all Token-2022 traps | `jsonParsed` extensions: permanent delegate, transfer hook, fee config, default-frozen, pausable, rescalable UI amount |
| **Holder intelligence** | Concentration after removing pools, curves, burns, lockers and exchange custody | Owner-program and PDA classification, derived pool authorities |
| **Scam DNA** | "Same scam, new mint" | Workers AI embeddings (bge-base-en-v1.5) in Vectorize |
| **Site & logo forensics** | What the website really renders; whether the logo copies a brand | Browser Run `quickAction()` + Llama 4 Scout (text and vision) |
| **Wallet forensics** | Program upgradeability/verification, funding trail, approvals, address poisoning | BPF loader parsing, OtterSec verify registry, lookalike detection |
| **Wallet Shield (dApp)** | Revoke live approvals, close empty accounts, reclaim rent | Signed SPL Token / Token-2022 `Revoke` and `CloseAccount` transactions |
| **Ask the Hawk** | A copilot that explains evidence and cannot be talked into lying | Deterministic scans + AI Search + Llama 4 Scout, behind Prompt Guard 2 and Llama Guard 3 |

Design rule: **the engine decides, the LLM explains.** The score is deterministic (noisy-OR over weighted findings); AI never changes it.

## Cloudflare platform map (Startups grant)

| Product | Use |
|---|---|
| Workers + Static Assets (OpenNext) | Next.js 16 app and API, one Worker |
| Workers AI | Llama 4 Scout (verdicts, copilot, vision), Llama 3.3 70B (fallback), Llama Guard 3, Prompt Guard 2, bge-base-en-v1.5, Deepgram Aura (spoken verdicts) |
| AI Gateway | Every AI call routed through `rughawk-ai` (falls back to `default`, then direct): logs, caching, cost, spend limit, Guardrails |
| AI Search | Hawk Playbook knowledge base, created and filled at runtime by `/api/admin/setup` |
| Web Search API (beta) | Optional open-web intel for the copilot (`WEB_SEARCH=on`) |
| Vectorize | Scam DNA index `rughawk-dna` (768-dim, cosine) |
| Browser Run | Renders token websites (markdown + screenshot) for the drainer-lure review |
| D1 | Scan history, deployer linkage, feed, watchlist, alerts |
| KV | Report, metadata, RDAP and funding-trace cache |
| R2 | Report snapshots, screenshots, Next.js incremental cache |
| Rate Limiting bindings | Per-IP limits on scans, AI and the RPC relay |
| Cron Triggers | Watchtower re-scans every 10 minutes |

RPC: dedicated QuickNode Solana mainnet endpoint (id 672448), capped at 20 rps so a scan burst can never starve Solmint's production endpoints on the shared account; CORS disabled because only the Worker calls it.

## Run it

```bash
npm install
cp .dev.vars.example .dev.vars        # add QUICKNODE_RPC_URL
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
| `POST /api/ai/ask` | Copilot |
| `POST /api/ai/speak` | Spoken verdict (audio/mpeg) |
| `POST /api/ai/site` | Browser Run site review |
| `GET /api/ai/logo?mint=` | Logo brand-impersonation check |
| `GET /api/og/token/<mint>` | Shareable 1200x630 risk card |
| `GET /api/feed` | Latest flagged tokens + totals |
| `POST /api/watch`, `GET /api/watch?address=` | Watchtower |
| `GET /api/health` | Bindings + RPC provider health |

## Validation (mainnet, 2026-10-07)

| Token | Result | Key evidence |
|---|---|---|
| Fresh pump.fun launch | CRITICAL 86 | Dev dumped 18s after launch; 5 wallets bought 16.4% in the launch block |
| MICROVERSE (hot, >3k txs in minutes) | CRITICAL 74 | Dev bought 11.2% at creation, dumped 100% 5s after launch; creator was a fee-sharing PDA |
| SHRENIS (graduated to PumpSwap) | CRITICAL 83 | Dev dumped 100% of a 10.8% bag 2s after launch; 3 bundled wallets took 16.1% |
| GTA | CRITICAL 70 | 4 wallets took 48.5% of supply in the launch block |
| BONK | LOW 0 | Canonical mint; exchange custody recognised |
| PYUSD (Token-2022) | context-aware | Permanent delegate/freeze shown as expected for a regulated issuer |

## Business model

- **Free**: 25 scans/day, AI verdicts, Shield, share cards (distribution engine: every shared report is an ad).
- **Pro $19/mo**: unlimited scans, Watchtower alerts on Telegram, deep site/logo forensics, web intel.
- **API from $99/mo**: Telegram trading bots, launchpads, wallets (they already pay for rug checks).
- **Shield reclaim fee**: optional, disclosed % of reclaimed rent, fail-closed when no treasury is configured.

## Security posture

Endpoint tokens live only as Worker secrets. The RPC relay is origin-checked and method-allowlisted. Every input address is validated. The copilot runs Prompt Guard and Llama Guard before the model sees a word. Shield builds transactions client-side and the user signs them in their own wallet; RugHawk never holds keys. Report security issues to security@raptorlabs.dev.
