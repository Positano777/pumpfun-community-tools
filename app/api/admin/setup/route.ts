import { getEnv } from '@/lib/env';
import { uploadPlaybook } from '@/lib/ai/playbook-sync';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/setup (Authorization: Bearer ADMIN_TOKEN): creates the
 * knowledge-search instance and uploads the Hawk Playbook. Idempotent: an
 * existing instance is reused, documents overwrite. The Watchtower cron does
 * the same automatically whenever a deploy changes the playbook.
 */
export async function POST(req: Request) {
  const { env } = await getEnv();
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return json({ error: 'Forbidden' }, { status: 403 });
  if (!env.AI_SEARCH) return json({ error: 'Knowledge search binding not configured' }, { status: 503 });
  return json(await uploadPlaybook(env));
}
