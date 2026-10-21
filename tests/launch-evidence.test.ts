import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchEvidence, parseEvidenceInput } from '../lib/scan/launch-evidence';
import { launchFindings } from '../lib/scan/launch';
import { launchTimeline } from '../lib/scan/timeline';

const fixture = () => JSON.parse(readFileSync(new URL('../examples/launch-synthetic.json', import.meta.url), 'utf8'));

test('a located launch with token gains never establishes purchases, coordination or full coverage', () => {
  const out = launchEvidence(parseEvidenceInput(fixture()));
  assert.equal(out.coverage.creation, 'located');
  assert.equal(out.coverage.launchBlock, 'unknown');
  assert.equal(out.launchSlotObservations?.purchasesVerified, false);
  assert.equal(out.launchSlotObservations?.jitoBundleMembership, 'unverified');
  assert.equal(out.launchSlotObservations?.coordination, 'unverified');
  assert.equal(out.feePayerOutflows[0].kind, 'transfer');
  assert.equal(out.feePayerOutflows[0].source.signature, 'SYNTHETIC_TRANSFER');
});

test('zero observed gains and no warnings still do not mean a complete or safe launch', () => {
  const f = fixture();
  f.partial = [];
  f.launch.bundled = {wallets: [], pctOfSupply: 0, txCount: 0};
  const out = launchEvidence(parseEvidenceInput(f));
  assert.equal(out.coverage.launchBlock, 'unknown');
  assert.equal('safe' in out, false);
  assert.ok(out.limitations.some(x => x.includes('missing block data')));
});

test('missing or unreached launch emits no positive observations', () => {
  for (const launch of [null, {...fixture().launch, reached: false}]) {
    const out = launchEvidence(parseEvidenceInput({...fixture(), launch}));
    assert.equal(out.creation, null);
    assert.equal(out.launchSlotObservations, null);
    assert.deepEqual(out.feePayerOutflows, []);
  }
});

test('invalid exported input is rejected, including non-token reports and malformed outflows', () => {
  for (const v of [null, [], {}, {...fixture(), kind: 'wallet'}, {...fixture(), scannedAt: 'today'}, {...fixture(), launch: {...fixture().launch, devSells: [{}]}}]) {
    assert.throws(() => parseEvidenceInput(v), /Invalid scan JSON/);
  }
});

test('both launch finding branches and timeline qualify token gains', () => {
  for (const wallets of [['a'], ['a', 'b', 'c']]) {
    const l = fixture().launch;
    l.bundled.wallets = wallets;
    const finding = launchFindings(l, 1792540800000).find(x => ['BUNDLED_LAUNCH', 'LAUNCH_SNIPERS'].includes(x.id));
    assert.ok(finding);
    assert.match(finding.detail, /transfers/i);
    assert.match(finding.detail, /unverified|does not prove/);
    assert.ok(finding.evidence?.every(x => x.label === 'Launch-slot wallet'));
    const timeline = launchTimeline(l);
    assert.match(timeline[1].detail, /bundle membership are unverified/);
  }
});
