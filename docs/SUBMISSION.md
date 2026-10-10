# Colosseum Crypto World's Fair: RugHawk submission kit

**Deadline: October 12, 2026** (Colosseum Arena; confirm the cut-off time and timezone on the submission form).
**Tracks:** Solana track ($100k: 10 x $10k) + general pool ($30k grand, 20 x $15k) + accelerator consideration ($250k pre-seed).

Judging criteria Colosseum publishes: functionality, potential impact, novelty, UX (use of Solana's performance), open source, business plan, team.

## Checklist

- [x] Deployed to Cloudflare: https://rughawk.plain-forest-6a44.workers.dev (Vectorize, secrets, AI Search playbook done)
- [x] Feed and Scam DNA seeded: 28 real launches plus 2 controls, re-scanned with the outflow classifier (sale, transfer, lock, burn)
- [ ] Re-verify the field-study claim (13 of 13 creators exited, median 7 s) with the outflow classifier before quoting it: a balance check counts Streamflow locks and burns as exits
- [ ] Buy `rughawk.com`, `rughawk.app`, `rughawk.dev` on Spaceship (verified available 2026-10-07: $8.88 + $6.21 + $6.21 first year)
- [ ] Add rughawk.com to Cloudflare, uncomment `routes` in `wrangler.jsonc`, set `NEXT_PUBLIC_APP_URL` (wrangler.jsonc + .env.production) to https://rughawk.com, `npm run deploy`
- [ ] Dashboard: create AI Gateway `rughawk-ai` (Guardrails incl. Prompt Injection P1, daily spend limit), then set `AI_GATEWAY_ID` to it
- [ ] Optional: load AI Gateway credits and set `WEB_SEARCH=on` for copilot web intel
- [ ] Deploy the AI feature branch (`npm run deploy`), then on the live site check: Speak on /ask (the microphone policy header now allows it), a spoken question answered aloud, Explain on a finding, Write a warning, Scam DNA search on the home page, Shield briefing with a connected wallet, the launch timeline on a pump.fun token
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

1. Architecture slide: one Cloudflare Worker (Next.js 16 via OpenNext) + QuickNode (archive) and Ankr (hot state), routed per method; Workers AI through AI Gateway; D1, KV, R2, Vectorize, Browser Run, AI Search.
2. Terminal: `npm run scan -- token <fresh mint>`: show the RPC call count and timing.
3. The hard part: a hot launch with thousands of transactions. Show the creator discovered from the pump.fun bonding curve (offset 49), the fee-sharing PDA hop, the `getBlock` read of the launch slot.
4. Context-aware scoring: PYUSD (permanent delegate expected for a regulated issuer), BONK (exchange custody recognised).
5. Lock vs dump: SCraft's deployer moved its whole 25.9% bag out 99 seconds after launch. A balance check calls that a dump; RugHawk reads the Streamflow lock. Then JET: the deployer sprayed dust into dozens of fresh wallets to fake a holder count.
6. AI layer, one model per job: verdict JSON schema (Llama 4 Scout), Explain on a finding streamed live, the copilot refusing an injection attempt, a question spoken in Croatian answered aloud in Croatian (Nova-3 in, Gemma 4 and Aura-2 out), Scam DNA search ("fake TRUMP token") hitting Vectorize, Browser Run screenshot reviewed by the vision model, the warning post written for X.
7. Shield: the Hawk briefing names the open doors, then build and sign a Revoke + CloseAccount transaction; show the rent coming back.
8. Security: endpoint tokens as secrets, method-allowlisted RPC relay, edge rate limits, image proxy that hides user IPs.

## Judge-facing one-liner

**RugHawk reads the launch block, names the operator and times the dump to the second. The engine decides; Cloudflare Workers AI explains.**
