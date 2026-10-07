/**
 * The Hawk Playbook: RugHawk's knowledge base. Uploaded to an AI Search
 * instance by POST /api/admin/setup (built-in storage, hybrid retrieval), and
 * used directly as a keyword-retrieval fallback when AI Search is not set up,
 * so the copilot is grounded either way.
 */
export interface PlaybookDoc {
  id: string;
  title: string;
  body: string;
}

export const PLAYBOOK: PlaybookDoc[] = [
  {
    id: 'solana-rug-patterns.md',
    title: 'How Solana rugs actually happen',
    body: `# How Solana rugs actually happen

## 1. Dev buy and dump (bonding-curve launchpads)
On pump.fun, Raydium LaunchLab, Meteora Dynamic Bonding Curve and Moonshot there is no liquidity pool to pull while the token trades on its curve. The rug is the creator buying a large share inside the creation transaction and selling it into the first buyers. RaptorLabs' September 2026 field study found the creator exited in 13 of 13 dead control launches, with a median of 7 seconds after launch. Creators who never sold were the only tokens still alive five hours later. RugHawk flags DEV_SOLD with the exact seconds after launch and the share of the dev bag that was sold.

## 2. Bundled launches
A bundle puts the creation transaction and several buys from wallets the operator controls into the same block (usually through Jito). Those wallets hold supply bought before anyone else could see the token, and they sell into the first public demand. RugHawk reads the creation block itself and reports every wallet that bought in it, plus the share of supply they took and whether they still hold it.

## 3. Liquidity pull (AMM pools)
On classic AMMs (Raydium AMM v4, CPMM) the creator receives LP tokens. If the LP is not burned or locked, the creator can withdraw the pool at any time and leave holders with an untradeable token. Graduated launchpad tokens usually have their LP burned by the launchpad; manually created pools need checking.

## 4. Authority abuse
- Mint authority: the issuer can print unlimited supply and sell it into the pool.
- Freeze authority: the issuer can freeze any holder's account so it can never sell (the classic Solana honeypot).
- Mutable metadata: the name, ticker and logo can be swapped after launch, for example into a copy of a trending token.

## 5. Token-2022 traps
- Permanent delegate: a third party can move or burn tokens from any holder at any time.
- Transfer hook: custom code runs on every transfer and can block sells.
- Transfer fee: a tax on every transfer that the fee authority can raise later.
- Default account state frozen: new holders start frozen and can buy but not sell unless unfrozen.
- Pausable: one key can halt all transfers.

## 6. Serial launchers and clones
Operators spray dozens of tokens per day from the same or freshly funded wallets and dump whichever one gets bids. One wallet in the field study ran 90 launches in 36.7 hours; one trended and the wallet still ended net negative, paid for by buyers. Clones copy the name, ticker and links of whatever is trending. RugHawk's Scam DNA compares every token's identity against tokens it already flagged.`,
  },
  {
    id: 'token-2022-extensions.md',
    title: 'Token-2022 extensions: what each one lets the issuer do',
    body: `# Token-2022 extensions: what each one lets the issuer do

Token-2022 (program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb) lets an issuer bolt extra powers onto a mint. Most are legitimate for regulated assets and dangerous for anonymous memecoins.

## Permanent delegate
The permanent delegate is an address set by the issuer on the mint itself. It can transfer or burn tokens out of every holder's account at any time, without the holder's signature, and it never expires. It is not the same as a token approval: an approval is a delegate a holder signs on their own token account and can revoke; a permanent delegate is controlled by the issuer and cannot be revoked by holders. Regulated stablecoins such as PayPal USD carry one to comply with legal orders. On an anonymous memecoin it means buyers do not truly own what they hold. RugHawk marks it CRITICAL outside regulated issuers.

## Transfer hook
A transfer hook makes every transfer call a custom program. The program can reject sells, charge extra, or allow only whitelisted wallets to trade: the most flexible honeypot primitive on Solana. A dormant hook (authority set, no program yet) can be switched on later.

## Transfer fee
A tax withheld on every transfer and harvested by the withdraw-withheld authority. Launchpad royalties of 1 to 3% are common; above 5% bleeds holders. If a fee config authority exists, the fee can be raised later (up to 100%) after a one-epoch delay.

## Default account state: frozen
Every new token account starts frozen and only the freeze authority can unfreeze it. Unless you are whitelisted you can buy but never sell.

## Pausable
One key can halt every transfer, trapping all holders at once.

## Non-transferable
Soulbound tokens that cannot move after minting. A tradable "currency" with this extension is misrepresented.

## Interest-bearing and scaled UI amount
The balance your wallet displays is multiplied by an issuer-controlled rate, so screenshots of balances prove nothing.

## Confidential transfers
Encrypted amounts. Legitimate for privacy, but they make insider flows harder to audit.

## Metadata pointer and token metadata
Name, ticker and logo stored on the mint. If an update authority remains, they can be changed after launch.

## Mint close authority
The mint account can be closed once the supply is zero. Low risk on its own.`,
  },
  {
    id: 'wallet-drainers.md',
    title: 'Wallet drainers and how to stay safe',
    body: `# Wallet drainers on Solana

## Token approvals (delegates)
Signing an Approve instruction lets a delegate move a set amount of a token without asking again. Phishing sites hide approvals inside "claim" or "verify" transactions. RugHawk Shield lists every live approval in your wallet and revokes them in one transaction.

## Owner reassignment
A SetAuthority instruction can change the owner of a token account. After signing it the tokens belong to the attacker even though nothing was "transferred". Never sign transactions that change account ownership.

## Durable nonce pre-signing
A transaction built with a durable nonce does not expire. Drainers ask for a signature today and submit it weeks later when the wallet holds more. Be suspicious of any site that asks you to sign but does not submit immediately.

## Blind signAllTransactions
Batch signing many transactions at once hides what each one does. Use wallets that simulate every transaction and read the simulation.

## Address poisoning
Attackers send dust from addresses that copy the first and last characters of an address you use, hoping you copy the wrong one from your history. Always verify the full address. RugHawk flags lookalike addresses in wallet scans.

## Fake airdrops and claim sites
Unknown tokens arriving in your wallet often link to a claim site. A memecoin site that asks you to connect a wallet to claim something is the standard drainer lure. RugHawk renders token websites with Browser Run and reviews what they actually show.

## Hygiene
Use a burner wallet for new launches, a hardware wallet for savings, revoke stale approvals, and close empty token accounts to reclaim their rent.`,
  },
  {
    id: 'reading-a-rughawk-report.md',
    title: 'Reading a RugHawk report',
    body: `# Reading a RugHawk report

The score runs from 0 to 100. Each finding has a weight, and the weights combine like independent probabilities (noisy-OR), so many small smells add up and one critical capability dominates. Any critical finding puts the token in the CRITICAL band (70+); any high finding puts it at 45 or more.

Grades: LOW (0-19), ELEVATED (20-44), HIGH (45-69), CRITICAL (70-100).

Findings are grouped by category: authority, extension, metadata, holders, market, launch, deployer, funding, impersonation, website, intel and exposure. Good findings (revoked authorities, locked metadata, no dev sells) are shown but never lower the score below what the risks justify.

Context rules: regulated stablecoins (USDC, USDT, PYUSD) are expected to keep mint, freeze and permanent-delegate powers, so those findings are informational. Canonical blue-chip mints treat holder concentration and DEX liquidity as informational because exchanges and treasuries hold most of the supply.

The AI verdict explains the deterministic findings in plain English. It never changes the score. The LLM explains; the engine decides.

Partial results: if a module could not run (for example the creation transaction of a very busy token could not be located), the report says so instead of implying it was checked.`,
  },
  {
    id: 'field-study-2026-09.md',
    title: 'Field study: why trending memecoins die',
    body: `# Field study: 13 trending tokens and 70 control launches (September 2026)

Measured by RaptorLabs on Solana mainnet using QuickNode RPC and DexScreener data.

- 10 of the 13 trending tokens were dead or dying within hours.
- pump.fun produces about 1,186 launches per hour, roughly 25,400 per day. 39 of 60 random launches got 35 or fewer successful transactions in their entire life.
- Operator capital in the creation transaction was the only measured predictor of first-hour volume, and the two operators who spent the most (86 SOL each) lost about 83 SOL each.
- 71.4% of random launches duplicate an existing name or ticker; duplication had no measurable effect on volume.
- Dev-buy-and-dump: on 13 random dead launches, 13 of 13 creators exited, median 7 seconds after launch.
- Transaction counts are not demand: one token showed 10,417 transactions of which 96.51% failed.
- Graduation from pump.fun costs a fixed toll from the curve and happens for well under 2% of launches.

Takeaway for traders: check whether the creator already sold, whether the launch block was bundled, and whether the deployer is a serial launcher before anything else.`,
  },
];

/** Keyword retrieval fallback: score docs by query-term overlap, return the best paragraphs. */
export function localRetrieve(query: string, max = 3): { source: string; text: string }[] {
  const terms = query.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? [];
  if (!terms.length) return [];
  const paragraphs = PLAYBOOK.flatMap((d) => d.body.split(/\n(?=## )/).map((p) => ({ source: d.title, text: p.trim() })));
  return paragraphs
    .map((p) => {
      const lower = p.text.toLowerCase();
      return { ...p, score: terms.reduce((s, t) => s + (lower.includes(t) ? 1 : 0), 0) };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ source, text }) => ({ source, text: text.slice(0, 1200) }));
}
