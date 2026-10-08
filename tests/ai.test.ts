import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSse } from '../lib/ai/workers-ai';
import { fallbackPulse, pulseStats } from '../lib/ai/pulse-stats';
import { isLanguage } from '../lib/ai/languages';
import type { FeedRow } from '../lib/db';

test('ai: server-sent events from the model turn into text deltas', () => {
  const full = 'data: {"response":"Hel"}\n\ndata: {"response":"lo"}\n\n: keep-alive\n\ndata: [DONE]\n\n';
  assert.deepEqual(parseSse(full), { texts: ['Hel', 'lo'], rest: '', done: true });
  const partial = 'data: {"response":"A"}\n\ndata: {"respo';
  const p = parseSse(partial);
  assert.deepEqual(p.texts, ['A']);
  assert.equal(p.rest, 'data: {"respo');
  assert.equal(p.done, false);
  const openai = 'data: {"choices":[{"delta":{"content":"x"}}]}\n';
  assert.deepEqual(parseSse(openai).texts, ['x']);
});

const row = (over: Partial<FeedRow>): FeedRow => ({
  address: 'A', kind: 'token', name: null, symbol: 'T', image: null, risk: 80, grade: 'CRITICAL', launchpad: 'pump.fun', top_flags: '[]', scan_count: 1, updated_at: 0, ...over,
});

test('ai: market pulse counts patterns from the engine findings inside the window only', () => {
  const now = 1_000_000_000_000;
  const rows: FeedRow[] = [
    row({ address: '1', top_flags: JSON.stringify(['6 wallets bought in the launch block (81% of supply)', 'Deployer sprayed dust into at least 72 wallets 1m after launch']), updated_at: now - 60_000 }),
    row({ address: '2', grade: 'HIGH', risk: 50, top_flags: JSON.stringify(['Deployer minted 2 other tokens in its last 16 transactions', 'Top 10 wallets hold 100.0% of supply']), updated_at: now - 3_600_000, launchpad: 'meteora-dbc' }),
    row({ address: '3', top_flags: JSON.stringify(['Deployer dumped 100% of its bag 6 minutes after launch']), updated_at: now - 48 * 3_600_000 }), // outside 24h
    row({ address: '4', grade: 'LOW', risk: 0, top_flags: JSON.stringify(['6 wallets bought in the launch block']), updated_at: now }), // not flagged
    row({ address: '5', kind: 'wallet', top_flags: 'not json', updated_at: now }), // wallet, ignored
  ];
  const s = pulseStats(rows, now);
  assert.equal(s.flagged, 2);
  assert.equal(s.critical, 1);
  assert.equal(s.high, 1);
  assert.equal(s.patterns.bundled, 1);
  assert.equal(s.patterns.spray, 1);
  assert.equal(s.patterns.serial, 1);
  assert.equal(s.patterns.concentration, 1);
  assert.equal(s.patterns.devExit, 0);
  assert.deepEqual(s.launchpads, { 'pump.fun': 1, 'meteora-dbc': 1 });
  assert.equal(s.latest.length, 2);
  assert.equal(s.latest[0].minutesAgo, 1);
  const text = fallbackPulse(s);
  assert.match(text.headline, /2 launches flagged/);
  assert.match(text.body, /1 graded CRITICAL and 1 HIGH/);
  assert.doesNotMatch(`${text.headline}${text.body}${text.watch}`, /—/);
  assert.match(fallbackPulse(pulseStats([], now)).headline, /Quiet skies/);
});

test('ai: only the supported verdict languages pass validation', () => {
  assert.equal(isLanguage('hr'), true);
  assert.equal(isLanguage('ja'), true);
  assert.equal(isLanguage('en'), false);
  assert.equal(isLanguage('constructor'), false);
  assert.equal(isLanguage(42), false);
});
