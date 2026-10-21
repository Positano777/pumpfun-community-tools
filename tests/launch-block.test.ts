import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLaunchBlock } from '../lib/scan/launch-block';
import { launchEvidence, parseEvidenceInput } from '../lib/scan/launch-evidence';
import { launchFindings, analyzeLaunch } from '../lib/scan/launch';
import type { ScanContext } from '../lib/scan/context';
import { readFileSync } from 'node:fs';
import { guarded } from '../lib/scan/context';

const mint = 'Mint';
const tx = (sig: string, amount = 1, failed = false) => ({
  transaction: {signatures: [sig], accountKeys: [{pubkey: mint, signer: false}, {pubkey: 'Wallet', signer: true}]},
  meta: {err: failed ? {InstructionError: [0, 'failed']} : null, fee: 1, preBalances: [], postBalances: [],
    preTokenBalances: [], postTokenBalances: [{mint, owner: 'Wallet', accountIndex: 1, uiTokenAmount: {uiAmount: amount, uiAmountString: String(amount), decimals: 0}}]},
});
const context = (block: unknown, fail = false) => ({rpc: {call: async (_method: string, params: unknown[]) => {
  assert.equal(params[0], 100);
  if (fail) throw new Error('https://rpc.invalid/?api-key=synthetic-secret-do-not-export');
  return block;
}}}) as unknown as ScanContext;
const block = (transactions: unknown[]) => ({blockTime: 123, transactions});
const fixture = () => JSON.parse(readFileSync(new URL('../examples/launch-synthetic.json', import.meta.url), 'utf8'));

test('exact-slot block coverage includes token-balance matches and excludes failures/creation', async () => {
  const transfer = tx('gain');
  transfer.transaction.accountKeys = [{pubkey: 'Wallet', signer: true}];
  const out = await readLaunchBlock(context(block([tx('create'), transfer, tx('failed', 1, true)])), mint, 100, 'create');
  assert.equal(out.coverage.status, 'complete');
  assert.equal(out.coverage.inspectedTransactions, 1);
  assert.equal(out.transactions[0].slot, 100);
  assert.equal(out.transactions[0].transaction.signatures[0], 'gain');
});

test('sample cap is explicit; a complete empty block differs from a failed fetch', async () => {
  const out = await readLaunchBlock(context(block([tx('create'), tx('a'), tx('b')])), mint, 100, 'create', 1);
  assert.equal(out.coverage.status, 'incomplete');
  assert.equal(out.coverage.relevantTransactions, 2);
  assert.deepEqual(out.coverage.reasons, ['sample_limit']);
  const empty = await readLaunchBlock(context(block([tx('create')])), mint, 100, 'create');
  assert.equal(empty.coverage.status, 'complete');
  assert.equal(empty.coverage.relevantTransactions, 0);
  const failed = await readLaunchBlock(context(null, true), mint, 100, 'create');
  assert.equal(failed.coverage.status, 'unavailable');
  assert.equal(failed.coverage.relevantTransactions, null);
  assert.ok(!JSON.stringify(failed).includes('synthetic-secret'));
});

test('missing creation, null blocks and absent token metadata cannot claim complete coverage', async () => {
  const missing = tx('gain') as any;
  missing.meta = null;
  for (const value of [null, {}, block([tx('other')]), block([tx('create'), missing])]) {
    const out = await readLaunchBlock(context(value), mint, 100, 'create');
    assert.notEqual(out.coverage.status, 'complete');
  }
  await assert.rejects(() => readLaunchBlock(context(null), mint, 100, 'create', 0));
});

test('export retains validated coverage and per-transaction observations', () => {
  const f = fixture();
  f.launch.blockCoverage = {status: 'incomplete', slot: 123, source: 'getBlock', relevantTransactions: 41, inspectedTransactions: 40, reasons: ['sample_limit']};
  f.launch.launchSlotEvidence = [{signature: 'sig', wallet: 'wallet', positiveDeltaPctOfSupply: 2}];
  const out = launchEvidence(parseEvidenceInput(f));
  assert.equal(out.coverage.launchBlock, 'incomplete');
  assert.equal(out.launchSlotObservations?.transactions[0].source.signature, 'sig');
  assert.ok(launchFindings(f.launch, f.scannedAt).some(x => x.id === 'LAUNCH_BLOCK_INCOMPLETE'));
  f.launch.blockCoverage.status = 'complete';
  assert.throws(() => parseEvidenceInput(f), /Invalid scan/);
});

test('export never forwards unknown outflow properties or raw diagnostic credentials', () => {
  const f = fixture();
  f.partial = ['holders: https://rpc.invalid/?api-key=synthetic-sensitive-value'];
  f.launch.devTransfers[0].privateDiagnostic = 'synthetic-sensitive-value';
  const out = JSON.stringify(launchEvidence(parseEvidenceInput(f)));
  assert.ok(!out.includes('synthetic-sensitive-value'));
  assert.ok(!out.includes('privateDiagnostic'));
  assert.ok(out.includes('holders warning (raw diagnostic omitted)'));
});

test('partial scan errors do not expose provider credential text', async () => {
  const partial: string[] = [];
  const out = await guarded(partial, 'holders', async () => { throw new Error('synthetic-sensitive-value'); }, null);
  assert.equal(out, null);
  assert.deepEqual(partial, ['holders: unavailable']);
});

test('an unavailable creation transaction yields an unverified finding rather than an empty clean result', async () => {
  let calls = 0;
  const ctx = { now: () => 1_000_000, rpc: {
    signatureHistory: async () => ({reachedStart: true, sigs: calls++ ? [] : [{signature: 'creation', slot: 1, blockTime: 999, err: null}]}),
    getTransaction: async () => null,
  }} as unknown as ScanContext;
  const out = await analyzeLaunch(ctx, {mint:'Mint', uiSupply:100, decimals:0, tokenProgram:'Token'}, async () => ({candidates:[], approxTime:null}));
  assert.equal(out.launch.reached, false);
  assert.ok(out.findings.some(x => x.id === 'LAUNCH_NOT_LOCATED'));
});
