import { getEnv } from '@/lib/env';
import { PLAYBOOK } from '@/lib/ai/playbook';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/setup (Authorization: Bearer ADMIN_TOKEN): creates the AI
 * Search instance (built-in storage, hybrid retrieval) and uploads the Hawk
 * Playbook. Idempotent: an existing instance is reused, documents overwrite.
 */
export async function POST(req: Request) {
  const { env } = await getEnv();
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return json({ error: 'Forbidden' }, { status: 403 });
  if (!env.AI_SEARCH) return json({ error: 'AI Search binding not configured' }, { status: 503 });
  const id = env.AI_SEARCH_INSTANCE || 'rughawk-playbook';
  const existing = await env.AI_SEARCH.list().then((r) => r.result.some((i) => i.id === id)).catch(() => false);
  const instance = existing ? env.AI_SEARCH.get(id) : await env.AI_SEARCH.create({ id });
  // Non-blocking uploads: indexing finishes in the background, so this
  // request returns in seconds instead of waiting on every document.
  const uploaded: { doc: string; status: string }[] = [];
  for (const doc of PLAYBOOK) {
    let status = 'queued';
    // A freshly created instance can answer not_found for a few seconds.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await instance.items.upload(doc.id, doc.body);
        status = 'queued';
        break;
      } catch (e) {
        status = `error: ${e instanceof Error ? e.message : 'failed'}`;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    uploaded.push({ doc: doc.id, status });
  }
  return json({ instance: id, created: !existing, uploaded });
}
