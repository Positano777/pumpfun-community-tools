import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppEnv, D1Like, D1Statement, KVLike } from '../lib/env';
import { checkWallet, walletEligibility, type EligibilityRpc } from '../lib/eligibility';
import { deepCheckGate, freeIdentity, scanGate, type Access } from '../lib/access';
import { HttpError } from '../lib/errors';

const WALLET = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const OTHER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

/** Counters only: the one table the free tier touches. */
class CounterD1 implements D1Like {
  counters = new Map<string, number>();
  prepare(sql: string): D1Statement {
    let args: unknown[] = [];
    const stmt: D1Statement = {
      bind: (...a: unknown[]) => {
        args = a;
        return stmt;
      },
      first: async <T,>() => {
        if (!sql.includes('INSERT INTO usage_counters')) throw new Error(`unexpected sql: ${sql}`);
        const k = `${args[0]}|${args[1]}`;
        const n = (this.counters.get(k) ?? 0) + 1;
        this.counters.set(k, n);
        return { n } as T;
      },
      all: async <T,>() => ({ results: [] as T[] }),
      run: async () => undefined,
    };
    return stmt;
  }
  async batch() {
    return [];
  }
}

class MemoryKV implements KVLike {
  store = new Map<string, string>();
  async get(key: string) {
    const v = this.store.get(key);
    return v === undefined ? null : JSON.parse(v);
  }
  async put(key: string, value: string | ArrayBuffer) {
    this.store.set(key, String(value));
  }
}

function rpcWith(balanceSol: number, txs: number, fail = false): EligibilityRpc & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call<T>(method: string, params: unknown[] = []): Promise<T> {
      calls.push(method);
      if (fail) throw new Error('rpc down');
      if (method === 'getBalance') return { value: Math.round(balanceSol * 1e9) } as T;
      if (method === 'getSignaturesForAddress') {
        const limit = Number((params[1] as { limit?: number })?.limit ?? 50);
        return Array.from({ length: Math.min(txs, limit) }, (_, i) => ({ signature: `s${i}` })) as T;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

const env = (db: D1Like, kv?: KVLike, vars: Record<string, string> = {}): AppEnv => ({ DB: db, CACHE: kv, FREE_SCANS_PER_DAY: '2', FREE_DEEP_CHECKS_PER_DAY: '1', ...vars });
const anon = (ip: string): Access => ({ wallet: null, plan: 'free', via: 'anon', keyHash: null, ip });
const session = (wallet: string, ip: string): Access => ({ wallet, plan: 'free', via: 'session', keyHash: null, ip });

test('free tier: a wallet qualifies for its own allowance only when funded and used', async () => {
  assert.deepEqual(await checkWallet(rpcWith(0.5, 20), WALLET, 0.01, 5), { eligible: true, reason: 'funded-and-used', balanceSol: 0.5, txs: 5 });
  assert.equal((await checkWallet(rpcWith(0.001, 20), WALLET, 0.01, 5)).reason, 'unfunded');
  assert.equal((await checkWallet(rpcWith(1, 2), WALLET, 0.01, 5)).reason, 'unused');
  assert.equal((await checkWallet(rpcWith(1, 2, true), WALLET, 0.01, 5)).reason, 'unknown');
  const kv = new MemoryKV();
  const rpc = rpcWith(1, 10);
  const e = env(new CounterD1(), kv);
  assert.equal((await walletEligibility(e, WALLET, rpc)).eligible, true);
  assert.equal((await walletEligibility(e, WALLET, rpcWith(0, 0))).eligible, true, 'cached for a day: the second look does not hit the chain');
  assert.equal(rpc.calls.length, 2);
  const down = rpcWith(1, 10, true);
  assert.equal((await walletEligibility(e, OTHER, down)).reason, 'unknown');
  assert.equal(kv.store.has(`eligible:v1:${OTHER}`), false, 'an RPC failure is not remembered');
});

test('free tier: the allowance follows a funded wallet, and an empty wallet is just its address', async () => {
  const e = env(new CounterD1(), new MemoryKV());
  assert.deepEqual(await freeIdentity(e, anon('1.1.1.1')), { key: 'ip:1.1.1.1', identity: 'ip' });
  assert.deepEqual(await freeIdentity(e, session(WALLET, '1.1.1.1'), rpcWith(1, 10)), { key: `wallet:${WALLET}`, identity: 'wallet' });
  assert.deepEqual(await freeIdentity(e, session(OTHER, '1.1.1.1'), rpcWith(0, 0)), { key: 'ip:1.1.1.1', identity: 'ip' });
  const apiKeyUser: Access = { wallet: WALLET, plan: 'free', via: 'apikey', keyHash: 'h', ip: '1.1.1.1' };
  assert.equal((await freeIdentity(e, apiKeyUser, rpcWith(1, 10))).identity, 'ip', 'only a signed session carries the wallet identity');
});

test('free tier: scans are metered per wallet for funded wallets, per address otherwise, with an address ceiling', async () => {
  const db = new CounterD1();
  const e = env(db, new MemoryKV());
  const funded = rpcWith(1, 10);
  const a = scanGate(e, session(WALLET, '9.9.9.9'), funded)!;
  await a();
  await a();
  await assert.rejects(a, (err: unknown) => err instanceof HttpError && err.status === 402 && /2 free scans/.test(err.message));
  // A second funded wallet from the same address has its own two...
  const b = scanGate(e, session(OTHER, '9.9.9.9'), funded)!;
  await b();
  await b();
  // ...until the address ceiling (2 x 4 = 8 runs) is reached by a third and a fourth wallet.
  const c = scanGate(e, session('So11111111111111111111111111111111111111112', '9.9.9.9'), funded)!;
  await c();
  await c();
  const d = scanGate(e, session('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', '9.9.9.9'), funded)!;
  await d();
  await d();
  const fifth = scanGate(e, session('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', '9.9.9.9'), funded)!;
  await assert.rejects(fifth, (err: unknown) => err instanceof HttpError && err.status === 402 && /network address/.test(err.message));
  // Empty wallets and anonymous visitors on one address share one counter.
  const empty = scanGate(e, session('JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', '7.7.7.7'), rpcWith(0, 0))!;
  await empty();
  const nobody = scanGate(e, anon('7.7.7.7'))!;
  await nobody();
  await assert.rejects(empty, (err: unknown) => err instanceof HttpError && err.status === 402);
  assert.equal(scanGate({ ...e }, { ...session(WALLET, '1.1.1.1'), plan: 'pro' }), undefined);
});

test('free tier: deep checks need a signed-in wallet and follow the same identity rules', async () => {
  const db = new CounterD1();
  const e = env(db, new MemoryKV());
  await assert.rejects(
    () => deepCheckGate(e, anon('3.3.3.3'), 'Website forensics'),
    (err: unknown) => err instanceof HttpError && err.status === 401 && err.extra.signIn === true,
  );
  const funded = rpcWith(1, 10);
  await deepCheckGate(e, session(WALLET, '3.3.3.3'), 'Website forensics', funded);
  await assert.rejects(
    () => deepCheckGate(e, session(WALLET, '3.3.3.3'), 'Website forensics', funded),
    (err: unknown) => err instanceof HttpError && err.status === 402 && err.extra.identity === 'wallet' && /Website forensics: your 1 free/.test(err.message),
  );
  // An empty wallet shares the address allowance and is told why.
  await deepCheckGate(e, session(OTHER, '4.4.4.4'), 'Logo forensics', rpcWith(0, 0));
  await assert.rejects(
    () => deepCheckGate(e, session('So11111111111111111111111111111111111111112', '4.4.4.4'), 'Logo forensics', rpcWith(0, 0)),
    (err: unknown) => err instanceof HttpError && err.status === 402 && err.extra.identity === 'ip' && /new or unfunded/.test(err.message),
  );
  // The address ceiling (1 x 3) stops cycling funded wallets through one connection.
  await deepCheckGate(e, session('JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', '5.5.5.5'), 'Logo forensics', funded);
  await deepCheckGate(e, session('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', '5.5.5.5'), 'Logo forensics', funded);
  await deepCheckGate(e, session('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', '5.5.5.5'), 'Logo forensics', funded);
  await assert.rejects(
    () => deepCheckGate(e, session('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', '5.5.5.5'), 'Logo forensics', funded),
    (err: unknown) => err instanceof HttpError && err.status === 402 && /network address/.test(err.message),
  );
  await deepCheckGate(e, { ...session(WALLET, '3.3.3.3'), plan: 'pro' }, 'Website forensics');
  await assert.rejects(() => deepCheckGate({ ...e, FREE_DEEP_CHECKS_PER_DAY: '0' }, session(WALLET, '3.3.3.3'), 'Website forensics', funded), (err: unknown) => err instanceof HttpError && err.status === 402 && /Pro feature/.test(err.message));
});
