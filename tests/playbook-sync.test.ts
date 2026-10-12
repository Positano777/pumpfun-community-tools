import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbookVersion, syncPlaybookIfChanged } from '../lib/ai/playbook-sync';
import { PLAYBOOK } from '../lib/ai/playbook';
import type { AppEnv } from '../lib/env';

function fakeEnv() {
  const kv = new Map<string, string>();
  const uploads: string[] = [];
  const env = {
    CACHE: {
      get: async (k: string) => (kv.has(k) ? JSON.parse(kv.get(k)!) : null),
      put: async (k: string, v: string) => void kv.set(k, String(v)),
    },
    AI_SEARCH: {
      list: async () => ({ result: [{ id: 'rughawk-playbook' }] }),
      get: () => ({ search: async () => ({}), items: { upload: async (name: string) => void uploads.push(name), uploadAndPoll: async () => ({}) } }),
      create: async () => {
        throw new Error('an existing instance must be reused');
      },
    },
  } as unknown as AppEnv;
  return { env, uploads };
}

test('playbook version changes with any document', () => {
  const v = playbookVersion();
  assert.match(v, /^[0-9a-f]{8}$/);
  assert.notEqual(playbookVersion([{ ...PLAYBOOK[0], body: `${PLAYBOOK[0].body} ` }, ...PLAYBOOK.slice(1)]), v);
});

test('the cron re-uploads the playbook once per content version', async () => {
  const { env, uploads } = fakeEnv();
  assert.equal(await syncPlaybookIfChanged(env), 'synced');
  assert.equal(uploads.length, PLAYBOOK.length);
  assert.equal(await syncPlaybookIfChanged(env), 'unchanged');
  assert.equal(uploads.length, PLAYBOOK.length);
});

test('without the bindings the sync is a no-op', async () => {
  assert.equal(await syncPlaybookIfChanged({} as AppEnv), 'skipped');
});
