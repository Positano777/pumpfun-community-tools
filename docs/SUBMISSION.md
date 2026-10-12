# Colosseum Crypto World's Fair: RugHawk submission

**Deadline:** 12 October 2026, 11:59 pm PDT (Colosseum Arena).
**Tracks:** Solana track ($100k: 10 x $10k) + general pool ($30k grand, 20 x $15k) + accelerator consideration ($250k pre-seed).

Judging criteria Colosseum publishes: functionality, potential impact, novelty, UX (use of Solana's performance), open source, business plan, team.

## Links

- Live product: https://rughawk.xyz
- Source code (MIT): https://github.com/bobvasic/rughawk
- Pitch video and technical demo: attached to the Arena submission

## Status

- [x] Live at https://rughawk.xyz, with continuous deployment from `main` (typecheck and tests on every push, production deploy and smoke test on every push to `main`)
- [x] Open source under the MIT license
- [x] Feed and Scam DNA seeded: 28 real launches plus 2 controls, re-scanned with the outflow classifier (sale, transfer, lock, burn)
- [x] Headline statistic re-measured with the outflow classifier on 40 random dead pump.fun launches (11 October 2026): 23 of the 28 deployers that bought at creation sold all of it, median 59 seconds after launch. Reproducible with `npm run study`; evidence in `docs/evidence/dev-exit-study-2026-10-12.json`
- [x] Pitch video and technical demo recorded
- [x] Arena form drafted with both video links
- [ ] Submit on the Arena

## Pitch outline (2:45)

1. **Hook.** "We took 40 random dead pump.fun launches. 28 deployers bought in at creation, and 23 of them sold all of it, median 59 seconds after launch. Seven sold within 4 seconds. By the time a rug checker shows you a score, the money is gone."
2. **Problem.** Rug checkers are commoditised: same three checks, a number, no operator. Traders need to know who launched it, who bought in the launch block, and whether the dev already sold.
3. **Product.** Paste a fresh launch. RugHawk finds the creation transaction even when the token is buried under thousands of bot trades, reads the launch block, names the bundled wallets, times the dev dump to the second, traces the deployer's funding back to an exchange, and Predator AI explains it in plain English. Then Wallet Shield: revoke a live approval and reclaim rent in one signature.
4. **Why us.** RaptorLabs built Solmint.dev, a live Solana token platform. We wrote the detection rules from our own mainnet measurements, and every headline number reproduces with one command.
5. **Business.** Free for traders (every shared risk card is distribution), Pro at $19/month for Watchtower alerts, API from $99/month for the Telegram trading bots and launchpads that already pay for rug data. Shield's optional reclaim fee is revenue from day one.

## Technical demo outline (3:00)

1. Architecture: one deployment serves the app and the API; two RPC roles routed per method (an archive node for history walks, a hot-state node for current reads); Predator AI explains, never scores.
2. Terminal: `npm run scan -- token <fresh mint>`, showing the RPC call count and timing.
3. The hard part: a hot launch with thousands of transactions. The creator is discovered from the pump.fun bonding curve (offset 49), the fee-sharing PDA hop is followed, and the launch block is read directly.
4. Context-aware scoring: PYUSD (permanent delegate expected for a regulated issuer), BONK (exchange custody recognised).
5. Lock vs dump: SCraft's deployer moved its whole 25.9% bag out 99 seconds after launch. A balance check calls that a dump; RugHawk reads the Streamflow lock. Then JET: the deployer sprayed dust into dozens of fresh wallets to fake a holder count.
6. Predator AI, one specialist per job: the schema-constrained verdict, Explain on a finding streamed live, the copilot refusing an injection attempt, a question spoken in Croatian answered aloud in Croatian, Scam DNA search ("fake TRUMP token"), the rendered-site screenshot reviewed by vision, the warning post written for X.
7. Shield: the Hawk briefing names the open doors, then build and sign a Revoke + CloseAccount transaction and show the rent coming back.
8. Security: credentials as server-side secrets, method-allowlisted RPC relay, edge rate limits, an image proxy that hides user IPs, public responses that name RPC roles only.

## Judge-facing one-liner

**RugHawk reads the launch block, names the operator and times the dump to the second. The engine decides; Predator AI explains.**
