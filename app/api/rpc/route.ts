import { getEnv } from '@/lib/env';
import { noteFailure, providerRole, publicRpcDetail, relayOrder, rpcUpstreams } from '@/lib/rpc';
import { json, originAllowed } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/rpc: Solana JSON-RPC relay for the browser wallet flow (Shield
 * revoke/close transactions). Endpoint tokens stay server-side. Only the
 * methods a wallet transaction needs are relayed, so the paid endpoints cannot
 * be used as a free indexer. State reads alternate between QuickNode and Ankr;
 * a batch that submits a transaction goes to QuickNode first (lib/rpc.ts).
 */
const ALLOWED = new Set([
  'getLatestBlockhash', 'sendTransaction', 'simulateTransaction', 'getSignatureStatuses', 'getBalance',
  'getAccountInfo', 'getMultipleAccounts', 'getMinimumBalanceForRentExemption', 'getFeeForMessage',
  'getBlockHeight', 'getEpochInfo', 'getSlot', 'isBlockhashValid', 'getRecentPrioritizationFees',
  'getTokenAccountsByOwner', 'getGenesisHash', 'getVersion', 'getHealth',
]);
const MAX_BODY = 120_000;

export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.text();
  if (body.length > MAX_BODY) return json({ error: 'Payload too large' }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  const methods = calls.map((c) => (c as { method?: string })?.method ?? '');
  if (calls.length > 20 || methods.some((m) => !ALLOWED.has(m))) {
    return json({ error: 'Method not allowed on this relay' }, { status: 403 });
  }
  const { env } = await getEnv();
  let last = 'no provider reachable';
  for (const up of relayOrder(rpcUpstreams(env), methods)) {
    try {
      const res = await fetch(up.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(12_000) });
      if (res.status === 429 || res.status >= 500 || res.status === 403) {
        noteFailure(up, res.status === 429 ? 3000 : 10_000);
        last = `${providerRole(up)} node responded ${res.status}`;
        continue;
      }
      return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json', 'x-rughawk-rpc': providerRole(up) } });
    } catch (e) {
      last = `${providerRole(up)} node: ${publicRpcDetail(e instanceof Error ? e.message : 'failed')}`;
    }
  }
  return json({ error: `All RPC providers failed: ${last}` }, { status: 502 });
}
