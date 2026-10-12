import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { SolanaRpc, methodClass, providerRole, publicRpcDetail, relayOrder, resetRpcState, rpcUpstreams } from '../lib/rpc';

const QN = 'https://qn.example/';
const AN = 'https://ankr.example/';
const env = { QUICKNODE_RPC_URL: QN, ANKR_RPC_URL: AN, QUICKNODE_RPC_RPS: '1000', ANKR_RPC_RPS: '1000' };

type Reply = { result?: unknown; error?: { code: number; message: string }; status?: number };
type Handler = (method: string, params: unknown[]) => Reply;
type LogEntry = { url: string; method: string };

function fakeFetch(handlers: Record<string, Handler>, log: LogEntry[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[]; id: number };
    log.push({ url: String(url), method: body.method });
    const out = handlers[String(url)]?.(body.method, body.params) ?? { result: null };
    if (out.status && out.status !== 200) return new Response('', { status: out.status });
    const payload = out.error ? { error: out.error } : { result: out.result ?? null };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...payload }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

/** A hot provider: answers the retention probe, then whatever `rest` says. */
const hot = (firstSlot: number, rest: Handler = () => ({ result: 'ankr' })): Handler => (method, params) =>
  method === 'getFirstAvailableBlock' ? { result: firstSlot } : rest(method, params);

const tx = (slot: number) => ({ slot, blockTime: null, meta: null, transaction: { signatures: ['s'], message: { accountKeys: [], instructions: [] } } });
const of = (log: LogEntry[], url: string, method: string) => log.filter((l) => l.url === url && l.method === method).length;

beforeEach(() => resetRpcState());

test('rpc: method classes', () => {
  assert.equal(methodClass('getAccountInfo'), 'state');
  assert.equal(methodClass('getLatestBlockhash'), 'state');
  assert.equal(methodClass('getSignaturesForAddress'), 'history');
  assert.equal(methodClass('getTransaction'), 'recent');
  assert.equal(methodClass('getBlock'), 'recent');
  assert.equal(methodClass('getTokenLargestAccounts'), 'heavy');
  assert.equal(methodClass('sendTransaction'), 'submit');
});

test('rpc: QuickNode is the archive provider, Ankr the hot one, both weighted; public is failover only', () => {
  const ups = rpcUpstreams(env);
  assert.deepEqual(ups.map((u) => [u.name, u.archive, u.weight]), [['quicknode', true, 1], ['ankr', false, 1], ['public', false, 0]]);
  assert.equal(ups[0].rate, 1000);
  assert.equal(rpcUpstreams({ QUICKNODE_RPC_URL: QN }).find((u) => u.name === 'quicknode')?.rate, 20);
  assert.deepEqual(rpcUpstreams({}).map((u) => u.name), ['public']);
});

test('rpc: state reads are split evenly between QuickNode and Ankr', async () => {
  const log: LogEntry[] = [];
  const rpc = new SolanaRpc(rpcUpstreams(env), { fetchImpl: fakeFetch({ [QN]: () => ({ result: 'qn' }), [AN]: () => ({ result: 'ankr' }) }, log) });
  for (let i = 0; i < 20; i++) await rpc.call('getAccountInfo', ['x']);
  assert.equal(rpc.callsByProvider.quicknode, 10);
  assert.equal(rpc.callsByProvider.ankr, 10);
  assert.equal(rpc.calls, 20);
  assert.deepEqual(rpc.since({ quicknode: 4 }), { quicknode: 6, ankr: 10 });
  assert.deepEqual(rpc.rolesSince({ quicknode: 4 }), { archive: 6, hot: 10 });
});

test('rpc: public output names roles, never providers or endpoints', () => {
  assert.deepEqual(rpcUpstreams(env).map(providerRole), ['archive', 'hot', 'failover']);
  assert.equal(publicRpcDetail(`quicknode rate limited at ${QN}abc`), 'rpc rate limited at [endpoint]');
  assert.equal(publicRpcDetail('Ankr: block cleaned up'), 'rpc: block cleaned up');
});

test('rpc: history walks never touch the hot provider', async () => {
  const log: LogEntry[] = [];
  const rpc = new SolanaRpc(rpcUpstreams(env), { fetchImpl: fakeFetch({ [QN]: () => ({ result: [] }), [AN]: () => ({ result: [] }) }, log) });
  for (let i = 0; i < 6; i++) await rpc.signatureHistory('wallet', 1);
  assert.equal(rpc.callsByProvider.quicknode, 6);
  assert.equal(rpc.callsByProvider.ankr, undefined);
});

test('rpc: heavy methods go to QuickNode first and fail over to Ankr; a 5xx cools the provider', async () => {
  const log: LogEntry[] = [];
  let qnFails = true;
  const rpc = new SolanaRpc(rpcUpstreams(env), {
    fetchImpl: fakeFetch({ [QN]: () => (qnFails ? { status: 502 } : { result: 'qn' }), [AN]: () => ({ result: 'ankr' }) }, log),
  });
  assert.equal(await rpc.call('getTokenLargestAccounts', ['mint']), 'ankr');
  assert.deepEqual(log.map((l) => l.url), [QN, AN]);
  qnFails = false;
  assert.equal(await rpc.call('getAccountInfo', ['x']), 'ankr');
  assert.equal(await rpc.call('getAccountInfo', ['x']), 'ankr');
});

test('rpc: recent transactions are balanced only inside the hot provider retention window', async () => {
  const log: LogEntry[] = [];
  const rpc = new SolanaRpc(rpcUpstreams(env), {
    fetchImpl: fakeFetch(
      { [QN]: (m) => ({ result: m === 'getTransaction' ? tx(0) : 'qn' }), [AN]: hot(10_000, (m) => ({ result: m === 'getTransaction' ? tx(1) : 'ankr' })) },
      log,
    ),
  });
  for (let i = 0; i < 4; i++) await rpc.getTransaction('old', 5_000); // below the window: archive only
  assert.equal(of(log, AN, 'getTransaction'), 0);
  assert.equal(of(log, AN, 'getFirstAvailableBlock'), 1);
  await rpc.getTransaction('unknown'); // no slot: archive only
  assert.equal(of(log, AN, 'getTransaction'), 0);
  for (let i = 0; i < 6; i++) await rpc.getTransaction('recent', 50_000); // inside the window: balanced
  assert.equal(of(log, AN, 'getTransaction'), 3);
  assert.equal(of(log, QN, 'getTransaction'), 8);
  log.length = 0;
  const out = await rpc.getTransactions([{ signature: 'a', slot: 50_000 }, { signature: 'b', slot: 50_001 }, 'c'], 1);
  assert.equal(out.length, 3);
  assert.equal(of(log, AN, 'getTransaction'), 1);
  assert.equal(of(log, QN, 'getTransaction'), 2);
});

test('rpc: a null transaction from the hot provider is re-checked on the archive provider', async () => {
  const log: LogEntry[] = [];
  const rpc = new SolanaRpc(rpcUpstreams(env), {
    fetchImpl: fakeFetch({ [QN]: () => ({ result: tx(50_000) }), [AN]: hot(10_000, () => ({ result: null })) }, log),
  });
  await rpc.call('getAccountInfo', ['x']); // round robin now points at Ankr
  assert.deepEqual(await rpc.getTransaction('sig', 50_000), tx(50_000));
  assert.deepEqual(log.filter((l) => l.method === 'getTransaction').map((l) => l.url), [AN, QN]);
});

test('rpc: a pruned-block error from the hot provider falls over to the archive provider', async () => {
  const log: LogEntry[] = [];
  const rpc = new SolanaRpc(rpcUpstreams(env), {
    fetchImpl: fakeFetch(
      { [QN]: () => ({ result: { blockhash: 'qn' } }), [AN]: hot(10_000, () => ({ error: { code: -32001, message: 'Block 50000 cleaned up, does not exist on node. First available block: 60000' } })) },
      log,
    ),
  });
  await rpc.call('getAccountInfo', ['x']);
  const block = await rpc.call<{ blockhash: string }>('getBlock', [50_000, { encoding: 'json' }]);
  assert.equal(block.blockhash, 'qn');
  assert.deepEqual(log.filter((l) => l.method === 'getBlock').map((l) => l.url), [AN, QN]);
});

test('rpc: a genuine JSON-RPC error is not retried on the other provider', async () => {
  const log: LogEntry[] = [];
  const bad: Handler = () => ({ error: { code: -32602, message: 'Invalid params' } });
  const rpc = new SolanaRpc(rpcUpstreams(env), { fetchImpl: fakeFetch({ [QN]: bad, [AN]: bad }, log) });
  await assert.rejects(() => rpc.call('getAccountInfo', ['bad']), /Invalid params/);
  assert.equal(log.length, 1);
});

test('rpc: 429 backs off and retries the same provider before rolling over', async () => {
  const log: LogEntry[] = [];
  let n = 0;
  const rpc = new SolanaRpc(rpcUpstreams(env), {
    fetchImpl: fakeFetch({ [QN]: () => (n++ === 0 ? { status: 429 } : { result: 'qn' }), [AN]: () => ({ result: 'ankr' }) }, log),
  });
  assert.equal(await rpc.call('getTokenLargestAccounts', ['mint']), 'qn');
  assert.deepEqual(log.map((l) => l.url), [QN, QN]);
});

test('rpc: relay order alternates state batches and pins history and submission', () => {
  const ups = rpcUpstreams(env);
  assert.deepEqual(Array.from({ length: 4 }, () => relayOrder(ups, ['getLatestBlockhash'])[0].name), ['quicknode', 'ankr', 'quicknode', 'ankr']);
  assert.equal(relayOrder(ups, ['getLatestBlockhash', 'sendTransaction'])[0].name, 'quicknode');
  assert.deepEqual(relayOrder(ups, ['getSignaturesForAddress']).map((u) => u.name), ['quicknode']);
  assert.deepEqual(relayOrder(ups, ['getBalance']).map((u) => u.name), ['quicknode', 'ankr', 'public']);
});
