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
  assert.doesNotMatch(`${text.headline}${text.body}${text.watch}`, /\u2014/);
  assert.match(fallbackPulse(pulseStats([], now)).headline, /Quiet skies/);
});

test('ai: only the supported verdict languages pass validation', () => {
  assert.equal(isLanguage('hr'), true);
  assert.equal(isLanguage('ja'), true);
  assert.equal(isLanguage('en'), false);
  assert.equal(isLanguage('constructor'), false);
  assert.equal(isLanguage(42), false);
});

import { sseTextStream } from '../lib/ai/workers-ai';
import { sseResponse } from '../lib/ai/sse';

function bytes(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

async function drain(stream: ReadableStream<string>): Promise<string[]> {
  const out: string[] = [];
  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

test('ai: model events split across chunks become text deltas and stop at [DONE]', async () => {
  const src = bytes(['data: {"response":"Hel"}\n\ndata: {"resp', 'onse":"lo"}\n\ndata: [DONE]\n\ndata: {"response":"ignored"}\n\n']);
  assert.deepEqual(await drain(sseTextStream(src)), ['Hel', 'lo']);
  const noDone = bytes(['data: {"response":"a"}\n\ndata: {"response":"b"}\n']);
  assert.deepEqual(await drain(sseTextStream(noDone)), ['a', 'b']);
  // The native final event ends the answer even without [DONE].
  const usage = parseSse('data: {"response":"z"}\n\ndata: {"response":"","usage":{"prompt_tokens":1}}\n\ndata: {"response":"late"}\n\n');
  assert.deepEqual(usage, { texts: ['z'], rest: '', done: true });
  // Chat-style chunks carry usage on every event: only a finish reason ends them.
  const chat = parseSse(
    'data: {"choices":[{"delta":{"content":"","role":"assistant"},"finish_reason":null}],"usage":{"prompt_tokens":0}}\n\n' +
      'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}],"usage":{"prompt_tokens":0}}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":0}}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":0}}\n\n',
  );
  assert.deepEqual(chat, { texts: ['Hi'], rest: '', done: true });
});

test('ai: a model stream that never closes still ends after a short idle gap', async () => {
  const enc = new TextEncoder();
  const stuck = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('data: {"response":"only"}\n\n'));
      // never closes, never sends [DONE]
    },
  });
  const started = Date.now();
  assert.deepEqual(await drain(sseTextStream(stuck, { idleMs: 60, firstMs: 500 })), ['only']);
  assert.ok(Date.now() - started < 450, 'finished on the idle timer, not the first-token timer');
  const silent = new ReadableStream<Uint8Array>({ start() {} });
  assert.deepEqual(await drain(sseTextStream(silent, { idleMs: 60, firstMs: 80 })), []);
});

test('ai: the streamed answer ends with a done event after every delta', async () => {
  const stream = new ReadableStream<string>({
    start(c) {
      c.enqueue('one \u2014 ');
      c.enqueue('two');
      c.close();
    },
  });
  const res = sseResponse({ generated: true }, stream, (t) => t.replace(/\u2014/g, ', '));
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const text = await res.text();
  const events = text.split('\n\n').filter(Boolean);
  assert.equal(events[0], 'event: meta\ndata: {"generated":true}');
  assert.equal(events[1], 'event: delta\ndata: {"t":"one ,  "}');
  assert.equal(events[2], 'event: delta\ndata: {"t":"two"}');
  assert.equal(events[3], 'event: done\ndata: {}');
  assert.equal(events.length, 4);
});

import { pulseBrief, tidy } from '../lib/ai/pulse';

test('ai: the pulse brief uses plain labels and the output is tidied', () => {
  const s = pulseStats([
    row({ address: '1', symbol: 'DUCK', top_flags: JSON.stringify(['Deployer wallet was minutes old at launch', 'Deployer dumped 100% of its bag 6 minutes after launch']), updated_at: 999_000 }),
  ], 1_000_000);
  const brief = pulseBrief(s) as { behavioursSeenAmongFlaggedTokens: Record<string, number>; mostRecent: string[] };
  assert.deepEqual(brief.behavioursSeenAmongFlaggedTokens, { 'deployer exits': 1, 'fresh deployer wallets': 1 });
  assert.equal(brief.mostRecent[0], '$DUCK (CRITICAL 80/100, 0 minutes ago)');
  assert.equal(tidy('Market Pulse: Fresh wallets, early exits'), 'Fresh wallets, early exits');
  assert.equal(tidy('  Three launches \u2014 two exits  '), 'Three launches , two exits');
});

test('ai: an empty model stream still answers with the fallback text', async () => {
  const empty = new ReadableStream<string>({ start(c) { c.close(); } });
  const text = await sseResponse({ generated: true }, empty, (t) => t, 'Ask again in a moment.').text();
  const events = text.split('\n\n').filter(Boolean);
  assert.equal(events[1], 'event: delta\ndata: {"t":"Ask again in a moment."}');
  assert.equal(events[2], 'event: done\ndata: {}');
});
