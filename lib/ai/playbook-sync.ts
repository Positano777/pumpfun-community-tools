import type { AppEnv } from '../env';
import { PLAYBOOK } from './playbook';

const VERSION_KEY = 'playbook:version';

/** Content version of the playbook: changes whenever any document changes (FNV-1a over ids and bodies). */
export function playbookVersion(docs = PLAYBOOK): string {
  let h = 0x811c9dc5;
  for (const doc of docs) {
    for (const ch of `${doc.id}\n${doc.body}\n`) {
      h ^= ch.codePointAt(0) ?? 0;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface PlaybookUpload {
  instance: string;
  created: boolean;
  uploaded: { doc: string; status: string }[];
}

/**
 * Creates the knowledge-search instance when it is missing and uploads every
 * playbook document. Idempotent: an existing instance is reused and documents
 * overwrite. Uploads do not wait for indexing, which finishes in the background.
 */
export async function uploadPlaybook(env: AppEnv, attempts = 3, retryDelayMs = 3000): Promise<PlaybookUpload> {
  if (!env.AI_SEARCH) throw new Error('Knowledge search binding not configured');
  const id = env.AI_SEARCH_INSTANCE || 'rughawk-playbook';
  const existing = await env.AI_SEARCH.list().then((r) => r.result.some((i) => i.id === id)).catch(() => false);
  const instance = existing ? env.AI_SEARCH.get(id) : await env.AI_SEARCH.create({ id });
  const uploaded: PlaybookUpload['uploaded'] = [];
  for (const doc of PLAYBOOK) {
    let status = 'queued';
    // A freshly created instance can answer not_found for a few seconds.
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await instance.items.upload(doc.id, doc.body);
        status = 'queued';
        break;
      } catch (e) {
        status = `error: ${e instanceof Error ? e.message : 'failed'}`;
        if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    uploaded.push({ doc: doc.id, status });
  }
  if (env.CACHE && uploaded.every((u) => u.status === 'queued')) {
    await env.CACHE.put(VERSION_KEY, JSON.stringify(playbookVersion())).catch(() => undefined);
  }
  return { instance: id, created: !existing, uploaded };
}

/**
 * Keeps the hosted knowledge base in step with the code. The Watchtower cron
 * calls this every run; it costs one cache read until a deploy changes a
 * playbook document, then re-uploads the playbook once.
 */
export async function syncPlaybookIfChanged(env: AppEnv): Promise<'unchanged' | 'synced' | 'failed' | 'skipped'> {
  if (!env.AI_SEARCH || !env.CACHE) return 'skipped';
  const current = await env.CACHE.get(VERSION_KEY, 'json').catch(() => null);
  if (current === playbookVersion()) return 'unchanged';
  const result = await uploadPlaybook(env, 1, 0);
  return result.uploaded.every((u) => u.status === 'queued') ? 'synced' : 'failed';
}
