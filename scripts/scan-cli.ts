/**
 * Run the RugHawk engine against mainnet from a terminal.
 *   npm run scan -- token <mint>
 *   npm run scan -- wallet <address>
 * Reads QUICKNODE_RPC_URL (and optional HELIUS_RPC_URL / ANKR_RPC_URL) from .dev.vars.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SolanaRpc, rpcUpstreams } from '../lib/rpc';
import { MemoryCache, type ScanContext } from '../lib/scan/context';
import { scanToken } from '../lib/scan/token';
import { scanWallet } from '../lib/scan/wallet';

function loadVars(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync('.dev.vars', 'utf8')
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}

const [kind, address, out] = process.argv.slice(2);
if (!kind || !address) {
  console.error('usage: scan-cli <token|wallet> <address> [out.json]');
  process.exit(1);
}
const env = { ...process.env, ...loadVars() };
const ctx: ScanContext = {
  rpc: new SolanaRpc(rpcUpstreams(env)),
  cache: new MemoryCache(),
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
};
const report = kind === 'token' ? await scanToken(ctx, address) : await scanWallet(ctx, address);
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
const r = report as any;
console.log(`\n${kind.toUpperCase()} ${address}`);
if (r.token) console.log(`  ${r.token.name} (${r.token.symbol})  program=${r.program}  supply=${r.token.uiSupply}`);
if (r.accountType) console.log(`  type=${r.accountType} label=${r.label ?? '-'} balance=${r.solBalance} SOL`);
console.log(`  RISK ${r.risk.score}/100  ${r.risk.grade}   ${r.durationMs}ms  rpcCalls=${r.rpcCalls}`);
if (r.launch) console.log(`  launch: reached=${r.launch.reached} pad=${r.launch.launchpad} deployer=${r.launch.deployer} devInitial=${r.launch.devInitialPct}% bundled=${r.launch.bundled.wallets.length}/${r.launch.bundled.pctOfSupply}% devSells=${r.launch.devSells.length}`);
if (r.deployer) console.log(`  deployer: age@launch=${r.deployer.ageHoursAtLaunch}h txs=${r.deployer.txCount}${r.deployer.txCountCapped ? '+' : ''} created=${r.deployer.tokensCreated.length} funding=${r.deployer.fundingChain.map((h: any) => `${h.address.slice(0, 4)}:${h.kind}`).join(' <- ')}`);
if (r.holders) console.log(`  holders: top10wallets=${r.holders.top10WalletPct}% largest=${r.holders.largestWalletPct}% pool=${r.holders.poolPct}% burned=${r.holders.burnedPct}%`);
if (r.market) console.log(`  market: ${r.market.dex} liq=$${Math.round(r.market.totalLiquidityUsd)} mcap=${r.market.marketCap} pairs=${r.market.pairs}`);
if (r.socials) console.log(`  socials: web=${r.socials.website} domainAge=${r.socials.domainAgeDays}d x=${r.socials.twitter}`);
for (const f of r.findings) console.log(`  [${f.severity.toUpperCase().padEnd(8)}] w${String(f.weight).padStart(2)} ${f.id}: ${f.title}`);
if (r.partial.length) console.log('  partial:', r.partial.join(' | '));
