import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayUrls, ipfsRef, IPFS_GATEWAYS } from '../lib/ipfs';
import { fetchLogo, loadLogo, logoCandidates, logoKey, sniffImageType } from '../lib/logo';
import type { KVLike } from '../lib/env';

const CID = 'bafkreig54lrar2odradcozevsmczibuvqfyjz7o3uusgwstbzhfv4q3oru';
const QM = 'QmeBZSWdR4TRxTwEQ5fpzAKTTFuLDnfNFFtxKP7XJBmCE1';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]).buffer;

test('ipfs references are recognised in every common form', () => {
  assert.deepEqual(ipfsRef(`ipfs://${CID}`), { cid: CID, path: '' });
  assert.deepEqual(ipfsRef(`ipfs://ipfs/${CID}/logo.png`), { cid: CID, path: '/logo.png' });
  assert.deepEqual(ipfsRef(`https://ipfs.io/ipfs/${QM}`), { cid: QM, path: '' });
  assert.deepEqual(ipfsRef(`https://${CID}.ipfs.w3s.link/art/1.png`), { cid: CID, path: '/art/1.png' });
  assert.deepEqual(ipfsRef(`https://pump.mypinata.cloud/ipfs/${CID}?img-width=64`), { cid: CID, path: '' });
  assert.equal(ipfsRef('https://ipfs.io/ipfs/not-a-cid'), null);
  assert.equal(ipfsRef('https://cdn.example.com/logo.png'), null);
  assert.equal(ipfsRef('ipfs://bafyabc'), null);
});

test('throttled public gateways named by the metadata are tried last', () => {
  const urls = gatewayUrls(`https://ipfs.io/ipfs/${CID}`);
  assert.equal(urls[0], `https://ipfs.filebase.io/ipfs/${CID}`);
  assert.equal(urls.filter((u) => u === `https://ipfs.io/ipfs/${CID}`).length, 1);
  assert.equal(urls.length, IPFS_GATEWAYS.length);
  const dweb = gatewayUrls(`https://dweb.link/ipfs/${CID}/logo.png`);
  assert.equal(dweb[0], `https://ipfs.filebase.io/ipfs/${CID}/logo.png`);
  assert.equal(dweb[dweb.length - 1], `https://dweb.link/ipfs/${CID}/logo.png`);
});

test('dedicated gateways and plain URLs keep the original first', () => {
  const dedicated = `https://desperate-moccasin-minnow.myfilebase.com/ipfs/${QM}`;
  const urls = gatewayUrls(dedicated);
  assert.equal(urls[0], dedicated);
  assert.equal(urls.length, IPFS_GATEWAYS.length + 1);
  assert.deepEqual(gatewayUrls('https://cdn.example.com/logo.png'), ['https://cdn.example.com/logo.png']);
  assert.deepEqual(gatewayUrls('ar://xyz'), ['https://arweave.net/xyz']);
  assert.deepEqual(gatewayUrls('ftp://nope'), []);
  assert.deepEqual(gatewayUrls(''), []);
});

test('logo candidates lead with the resizing gateway and stay https', () => {
  const urls = logoCandidates(`https://ipfs.io/ipfs/${CID}`);
  assert.ok(urls[0].startsWith(`https://pump.mypinata.cloud/ipfs/${CID}?img-width=`));
  assert.equal(urls.filter((u) => u.includes('pump.mypinata.cloud')).length, 1);
  assert.ok(urls.every((u) => u.startsWith('https://')));
  assert.deepEqual(logoCandidates('http://insecure.example.com/x.png'), []);
  assert.deepEqual(logoCandidates('https://cdn.example.com/x.png'), ['https://cdn.example.com/x.png']);
});

test('image bytes are sniffed when the gateway mislabels them', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer), 'image/jpeg');
  assert.equal(sniffImageType(new TextEncoder().encode('GIF89a......').buffer), 'image/gif');
  assert.equal(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ').buffer), 'image/webp');
  assert.equal(sniffImageType(new TextEncoder().encode('<html>oops</html>').buffer), null);
  assert.equal(sniffImageType(new ArrayBuffer(0)), null);
});

function fakeFetch(answers: Record<string, () => Response>, log: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    log.push(new URL(url).hostname);
    const hit = Object.entries(answers).find(([host]) => url.includes(host));
    return hit ? hit[1]() : new Response('nope', { status: 404 });
  }) as typeof fetch;
}

test('a throttled gateway is skipped and the next one serves the logo', async () => {
  const log: string[] = [];
  const logo = await fetchLogo(`https://ipfs.io/ipfs/${CID}`, {
    fetch: fakeFetch(
      {
        'pump.mypinata.cloud': () => new Response('rate limited', { status: 429 }),
        'ipfs.filebase.io': () => new Response(PNG, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
        'ipfs.io': () => new Response('rate limited', { status: 429 }),
      },
      log,
    ),
  });
  assert.ok(logo);
  assert.equal(logo.type, 'image/png');
  assert.equal(logo.bytes.byteLength, 16);
  assert.deepEqual(log, ['pump.mypinata.cloud', 'ipfs.filebase.io']);
});

test('html error pages and empty bodies never pass as images', async () => {
  const log: string[] = [];
  const logo = await fetchLogo(`https://ipfs.io/ipfs/${CID}`, {
    fetch: fakeFetch(
      {
        'pump.mypinata.cloud': () => new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
        'ipfs.filebase.io': () => new Response('', { status: 200, headers: { 'content-type': 'image/png' } }),
        'ipfs.io': () => new Response('<svg/>', { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
        'dweb.link': () => new Response('x', { status: 500 }),
      },
      log,
    ),
  });
  assert.equal(logo, null);
  assert.equal(log.length, 4);
});

test('the time budget stops the gateway walk', async () => {
  let t = 0;
  const log: string[] = [];
  const logo = await fetchLogo(`https://ipfs.io/ipfs/${CID}`, {
    now: () => (t += 7000),
    budgetMs: 12_000,
    fetch: fakeFetch({ 'pump.mypinata.cloud': () => new Response('slow', { status: 504 }) }, log),
  });
  assert.equal(logo, null);
  assert.equal(log.length, 1);
});

class FakeKv implements KVLike {
  store = new Map<string, { value: string | ArrayBuffer; metadata?: Record<string, unknown> }>();
  async get(key: string): Promise<unknown> {
    const v = this.store.get(key)?.value;
    return typeof v === 'string' ? JSON.parse(v) : null;
  }
  async getWithMetadata(key: string): Promise<{ value: ArrayBuffer | null; metadata: unknown }> {
    const e = this.store.get(key);
    if (!e) return { value: null, metadata: null };
    return { value: typeof e.value === 'string' ? new TextEncoder().encode(e.value).buffer : e.value, metadata: e.metadata ?? null };
  }
  async put(key: string, value: string | ArrayBuffer, opts?: { expirationTtl?: number; metadata?: Record<string, unknown> }): Promise<void> {
    this.store.set(key, { value, metadata: opts?.metadata });
  }
}

test('logos are remembered in KV under one key per content id', async () => {
  const kv = new FakeKv();
  const pending: Promise<unknown>[] = [];
  const defer = (p: Promise<unknown>) => void pending.push(p);
  const log: string[] = [];
  const ok = fakeFetch({ 'pump.mypinata.cloud': () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }) }, log);

  const first = await loadLogo(`https://ipfs.io/ipfs/${CID}`, kv, defer, { fetch: ok });
  await Promise.all(pending);
  assert.equal(first?.type, 'image/png');
  assert.equal(log.length, 1);

  const second = await loadLogo(`https://dweb.link/ipfs/${CID}`, kv, defer, { fetch: ok });
  assert.equal(second?.type, 'image/png');
  assert.equal(second?.bytes.byteLength, 16);
  assert.equal(log.length, 1, 'served from KV, no fetch');
  assert.equal(await logoKey(`ipfs://${CID}`), await logoKey(`https://ipfs.io/ipfs/${CID}`));
  assert.notEqual(await logoKey(`ipfs://${CID}`), await logoKey(`ipfs://${CID}/logo.png`));
});

test('a logo no gateway serves is marked missing for a while', async () => {
  const kv = new FakeKv();
  const pending: Promise<unknown>[] = [];
  const defer = (p: Promise<unknown>) => void pending.push(p);
  const log: string[] = [];
  const down = fakeFetch({}, log);
  assert.equal(await loadLogo('https://cdn.example.com/gone.png', kv, defer, { fetch: down }), null);
  await Promise.all(pending);
  const calls = log.length;
  assert.equal(await loadLogo('https://cdn.example.com/gone.png', kv, defer, { fetch: down }), null);
  assert.equal(log.length, calls, 'the miss marker spares the gateways');
});
