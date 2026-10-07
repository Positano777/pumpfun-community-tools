import { getEnv } from '@/lib/env';
import { rpcUpstreams } from '@/lib/rpc';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/health: which bindings are live and which RPC providers answer. */
export async function GET() {
  const { env } = await getEnv();
  const probe = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' });
  const rpc = await Promise.all(
    rpcUpstreams(env).map(async (u) => {
      const t = Date.now();
      try {
        const r = await fetch(u.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: probe, signal: AbortSignal.timeout(4000) });
        return { name: u.name, ok: r.ok, ms: Date.now() - t };
      } catch {
        return { name: u.name, ok: false, ms: Date.now() - t };
      }
    }),
  );
  return json(
    {
      bindings: {
        ai: Boolean(env.AI), kv: Boolean(env.CACHE), d1: Boolean(env.DB), r2: Boolean(env.REPORTS),
        vectorize: Boolean(env.DNA), browserRun: Boolean(env.BROWSER), aiSearch: Boolean(env.AI_SEARCH),
      },
      aiGateway: env.AI_GATEWAY_ID ?? null,
      rpc,
    },
    { cache: 15 },
  );
}
