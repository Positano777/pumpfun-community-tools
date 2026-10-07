# Colosseum Crypto World's Fair: RugHawk submission kit

**Deadline: October 12, 2026** (Colosseum Arena; confirm the cut-off time and timezone on the submission form).
**Tracks:** Solana track ($100k: 10 x $10k) + general pool ($30k grand, 20 x $15k) + accelerator consideration ($250k pre-seed).

Judging criteria Colosseum publishes: functionality, potential impact, novelty, UX (use of Solana's performance), open source, business plan, team.

## Checklist

- [ ] Buy `rughawk.com`, `rughawk.app`, `rughawk.dev` on Spaceship (verified available 2026-10-07: $8.88 + $6.21 + $6.21 first year)
- [ ] Point the domains' nameservers to Cloudflare, uncomment `routes` in `wrangler.jsonc`
- [ ] `npx wrangler login && ./scripts/setup-cloudflare.sh` (Vectorize, secrets, deploy, AI Search playbook)
- [ ] Dashboard: create AI Gateway `rughawk-ai`; enable Guardrails and a daily spend limit
- [ ] Scan 30 to 50 fresh pump.fun launches to seed the feed and the Scam DNA index
- [ ] Record the pitch video (3 min max) and the technical demo video
- [ ] Make the GitHub repo public (open source is a judging criterion)
- [ ] Submit on the Arena with: repo, live URL, both videos, X handle

## Pitch video script (2:45)

1. **Hook (0:00-0:20).** "On pump.fun, 1,186 tokens launch every hour. We measured what happens next: in 13 of 13 dead launches the creator dumped, median seven seconds after launch. By the time a rug checker shows you a score, the money is gone."
2. **Problem (0:20-0:50).** Rug checkers are commoditised: same three checks, a number, no operator. Traders need to know who launched it, who bought in the launch block, and whether the dev already sold.
3. **Product (0:50-1:50).** Live demo: paste a fresh launch. RugHawk finds the creation transaction even when the token is buried under thousands of bot trades, reads the launch block, names the bundled wallets, times the dev dump to the second, traces the deployer's funding back to an exchange, and Workers AI explains it in plain English. Then Wallet Shield: revoke a live approval and reclaim rent in one signature.
4. **Why us (1:50-2:15).** RaptorLabs built Solmint.dev, a live Solana token platform on Cloudflare. We wrote the detection rules from our own mainnet field study, not from a blog post.
5. **Business (2:15-2:45).** Free for traders (every shared risk card is distribution), Pro at $19/month for Watchtower alerts, API from $99/month for the Telegram trading bots and launchpads that already pay for rug data. Shield's optional reclaim fee is revenue from day one.

## Technical demo script (3:00)

1. Architecture slide: one Cloudflare Worker (Next.js 16 via OpenNext) + QuickNode; Workers AI through AI Gateway; D1, KV, R2, Vectorize, Browser Run, AI Search.
2. Terminal: `npm run scan -- token <fresh mint>`: show the RPC call count and timing.
3. The hard part: a hot launch with thousands of transactions. Show the creator discovered from the pump.fun bonding curve (offset 49), the fee-sharing PDA hop, the `getBlock` read of the launch slot.
4. Context-aware scoring: PYUSD (permanent delegate expected for a regulated issuer), BONK (exchange custody recognised).
5. AI layer: verdict JSON schema, Prompt Guard blocking an injection in the copilot, Scam DNA match, Browser Run screenshot of a token site, Aura voice verdict.
6. Shield: build and sign a Revoke + CloseAccount transaction; show the rent coming back.
7. Security: endpoint tokens as secrets, method-allowlisted RPC relay, edge rate limits, image proxy that hides user IPs.

## Judge-facing one-liner

**RugHawk reads the launch block, names the operator and times the dump to the second. The engine decides; Cloudflare Workers AI explains.**
