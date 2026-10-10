import { getEnv } from '@/lib/env';
import { tokenReport, walletReport } from '@/lib/service';
import { explainFinding, findFinding } from '@/lib/ai/explain';
import { sseResponse } from '@/lib/ai/sse';
import { fail, json, originAllowed } from '@/lib/http';
import { isAddress } from '@/lib/solana/address';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/explain { kind, address, findingId }: one finding of a report
 * explained in plain English, streamed as server-sent events (`meta`,
 * `delta`, `done`). Cached per (address, score, finding) for 15 minutes.
 */
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as { kind?: unknown; address?: unknown; findingId?: unknown };
    const kind = body.kind === 'wallet' ? 'wallet' : 'token';
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    const findingId = typeof body.findingId === 'string' ? body.findingId.trim().slice(0, 64) : '';
    if (!isAddress(address) || !/^[A-Z0-9_]{3,64}$/.test(findingId)) return json({ error: 'kind, address and findingId are required.' }, { status: 400 });
    const { env, ctx } = await getEnv();
    const report = kind === 'token' ? await tokenReport(env, ctx, address) : await walletReport(env, ctx, address);
    const finding = findFinding(report, findingId);
    if (!finding) return json({ error: 'No such finding in this report.' }, { status: 404 });
    const { stream, cached, generated, fallback } = await explainFinding(env, ctx, report, finding);
    return sseResponse({ cached, generated, findingId }, stream, (t) => t.replace(/\u2014/g, ', '), fallback);
  } catch (e) {
    return fail(e);
  }
}
