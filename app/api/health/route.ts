import { getEnv } from '@/lib/env';
import { rpcUpstreams } from '@/lib/rpc';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/health: which services are live and which RPC providers answer. */
export async function GET() {
  const { env } = await getEnv();
  const probe = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' });
  const rpc = await Promise.all(
    rpcUpstreams(env).map(async (u) => {
      const t = Date.now();
      const base = { name: u.name, role: u.archive ? 'archive' : 'hot', balanced: u.weight > 0 };
      try {
        const r = await fetch(u.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: probe, signal: AbortSignal.timeout(4000) });
        return { ...base, ok: r.ok, ms: Date.now() - t };
      } catch {
        return { ...base, ok: false, ms: Date.now() - t };
      }
    }),
  );
  return json(
    {
      ok: rpc.some((r) => r.ok),
      services: {
        cache: Boolean(env.CACHE), db: Boolean(env.DB), storage: Boolean(env.REPORTS),
        explain: Boolean(env.AI), dna: Boolean(env.DNA), render: Boolean(env.BROWSER), knowledge: Boolean(env.AI_SEARCH),
      },
      rpc,
    },
    { cache: 15 },
  );
}
