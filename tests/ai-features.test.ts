import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakable, transcriptOf, voiceFor } from '../lib/ai/voice';
import { acceptTranslation } from '../lib/ai/translate';
import { LANGUAGES, LANGUAGE_COUNT, isLanguage } from '../lib/ai/languages';
import { acceptPost, clampText, fallbackPost, X_MAX } from '../lib/ai/share';
import { mergeHits, normaliseQuery, MIN_SIMILARITY } from '../lib/ai/memory';
import { acceptBrief, fallbackBrief, shieldDigest } from '../lib/ai/shield-brief';
import { explainPrompt, teeText } from '../lib/ai/explain';
import { launchTimeline, sinceLaunch } from '../lib/scan/timeline';
import type { ShieldReport, ShieldAccount } from '../lib/scan/shield';
import type { LaunchForensics, PublicAiVerdict, TokenReport } from '../lib/scan/types';
import { MODELS } from '../lib/ai/workers-ai';

const NO_DASH = /\u2014/;

test('voice: prose is tidied for the speaker and cut at a sentence', () => {
  const text = '## Verdict\n- **Deployer** dumped 100% at +6s \u2014 see 7wN1fXJnjhFuToy5VuXHPsgqoXufJkTkkMH6B2VTCRrU.\n- Second point.';
  const spoken = speakable(text);
  assert.equal(spoken, 'Verdict Deployer dumped 100% at +6s , see 7wN1 CRrU. Second point.');
  const long = speakable(`${'A sentence that goes on. '.repeat(40)}Tail`, 120);
  assert.ok(long.length <= 120);
  assert.ok(long.endsWith('.'));
  assert.doesNotMatch(spoken, NO_DASH);
});

test('voice: transcripts are read from Nova-3 and Whisper shapes', () => {
  assert.deepEqual(transcriptOf({ results: { channels: [{ alternatives: [{ transcript: ' is this a rug ', confidence: 0.97 }] }] } }), { text: 'is this a rug', confidence: 0.97 });
  assert.deepEqual(transcriptOf({ text: 'who deployed it' }), { text: 'who deployed it', confidence: null });
  assert.deepEqual(transcriptOf({ result: { results: { channels: [{ alternatives: [{ transcript: 'wrapped' }] }] } } }), { text: 'wrapped', confidence: null });
  assert.equal(transcriptOf({ results: { channels: [{ alternatives: [{ transcript: '   ' }] }] } }), null);
  assert.equal(transcriptOf(null), null);
  assert.equal(voiceFor('es'), 'es');
  assert.equal(voiceFor('en'), 'en');
  assert.equal(voiceFor('hr'), null);
});

test('models: one model per job, the Scam DNA index keeps its embedding model', () => {
  assert.equal(MODELS.embed, '@cf/baai/bge-base-en-v1.5');
  assert.match(MODELS.transcribe, /nova-3/);
  assert.match(MODELS.tts, /aura-2/);
  assert.match(MODELS.multilingual, /gemma-4/);
  assert.notEqual(MODELS.text, MODELS.textFallback);
});

const verdict: PublicAiVerdict = { headline: 'Dev dumped', summary: 'Sold fast.', topRisks: ['a', 'b'], watch: ['c'], confidence: 'high' };

test('translate: a structured translation is accepted only when every field and list length matches', () => {
  const ok = acceptTranslation({ headline: 'Dev je prodao', summary: 'Prodano brzo \u2014 odmah.', topRisks: ['x', 'y'], watch: ['z'] }, verdict);
  assert.ok(ok);
  assert.equal(ok.summary, 'Prodano brzo, odmah.');
  assert.equal(ok.confidence, 'high');
  assert.equal(acceptTranslation({ headline: 'h', summary: 's', topRisks: ['x'], watch: ['z'] }, verdict), null);
  assert.equal(acceptTranslation({ headline: '', summary: 's', topRisks: ['x', 'y'], watch: ['z'] }, verdict), null);
  assert.equal(acceptTranslation('nope', verdict), null);
  assert.equal(LANGUAGE_COUNT, Object.keys(LANGUAGES).length + 1);
  assert.equal(isLanguage('ko'), true);
  assert.equal(isLanguage('vi'), true);
});

const token = (over: Partial<TokenReport> = {}): TokenReport =>
  ({
    kind: 'token',
    version: 1,
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    scannedAt: 0,
    durationMs: 1,
    rpcCalls: 1,
    program: 'spl-token',
    token: { name: 'Duck', symbol: 'DUCK', image: null, description: null, decimals: 6, supply: '1', uiSupply: 1, uri: null, isMutable: false, updateAuthority: null, metadataSource: 'metaplex' },
    authorities: { mint: null, freeze: null },
    extensions: [],
    holders: null,
    market: null,
    launch: null,
    deployer: null,
    socials: { website: null, twitter: null, telegram: null, domain: null, domainRegisteredAt: null, domainAgeDays: null },
    findings: [
      { id: 'DEV_SOLD', severity: 'critical', category: 'launch', title: 'Deployer dumped 100% of its bag 6s after launch', detail: 'Dev-buy-and-dump.', weight: 70, evidence: [{ label: 'Sell tx', value: 'abc' }] },
      { id: 'MINT_REVOKED', severity: 'good', category: 'authority', title: 'Mint authority revoked', detail: 'ok', weight: 0 },
    ],
    risk: { score: 84, grade: 'CRITICAL', counts: { critical: 1, high: 0, medium: 0, low: 0, info: 0, good: 1 } },
    ai: null,
    dna: [],
    partial: [],
    ...over,
  }) as TokenReport;

test('share: the fallback post carries the top finding and the grade, and model posts are clamped', () => {
  const fb = fallbackPost(token());
  assert.match(fb.x, /\$DUCK/);
  assert.match(fb.x, /CRITICAL 84\/100/);
  assert.match(fb.x, /Verify it yourself:$/);
  assert.ok(fb.x.length <= X_MAX);
  assert.match(fb.telegram, /- Deployer dumped/);
  const accepted = acceptPost({ x: `⚠️ $DUCK: deployer dumped its whole bag 6 seconds after launch. RugHawk grade CRITICAL 84/100. ${'x'.repeat(300)}`, telegram: 'A warning for the group that is long enough to count as a message.' }, fb);
  assert.equal(accepted.generated, true);
  assert.ok(accepted.post.x.length <= X_MAX);
  assert.match(accepted.post.x, /Verify it yourself:$/);
  assert.deepEqual(acceptPost({ x: 'too short', telegram: 'short' }, fb), { post: fb, generated: false });
  assert.equal(clampText('one two three four', 9), 'one two');
  assert.doesNotMatch(clampText('a \u2014 b', 20), NO_DASH);
});

test('memory: hits below the similarity floor drop, rows enrich the rest, metadata fills the gaps', () => {
  const matches = [
    { id: 'A', score: 0.91, metadata: { symbol: 'TRUMP', name: 'Official Trump', risk: 87, grade: 'CRITICAL' } },
    { id: 'B', score: 0.3, metadata: { symbol: 'X' } },
    { id: 'C', score: 0.7, metadata: { symbol: 'DOGE2', risk: 50, grade: 'HIGH' } },
  ];
  const rows = [{ address: 'A', symbol: 'TRUMP', name: 'Official Trump', image: 'https://i/x.png', risk: 87, grade: 'CRITICAL', launchpad: 'pump.fun', top_flags: JSON.stringify(['Impersonates TRUMP']) }];
  const hits = mergeHits(matches, rows, 8);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].address, 'A');
  assert.equal(hits[0].flag, 'Impersonates TRUMP');
  assert.equal(hits[0].image, 'https://i/x.png');
  assert.equal(hits[1].symbol, 'DOGE2');
  assert.equal(hits[1].flag, null);
  assert.ok(hits.every((h) => h.similarity >= MIN_SIMILARITY));
  assert.equal(normaliseQuery('  fake   trump \n coin '), 'fake trump coin');
  assert.equal(normaliseQuery(42), '');
});

const acct = (over: Partial<ShieldAccount>): ShieldAccount => ({
  address: 'acc', mint: 'So11111111111111111111111111111111111111112', programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', amountRaw: '0', uiAmount: 0, decimals: 6, lamports: 2_039_280, delegate: null, delegatedUi: 0, frozen: false, closeAuthority: null, withheld: false, permanentDelegate: null, closable: false, ...over,
});

test('shield brief: the fallback names every open door and the digest shortens addresses', () => {
  const delegated = acct({ address: 'd1', delegate: 'De1egate1111111111111111111111111111111111', delegatedUi: 500, uiAmount: 1000 });
  const seizable = acct({ address: 's1', permanentDelegate: 'Perm1111111111111111111111111111111111111111', uiAmount: 42 });
  const empty = acct({ address: 'e1', closable: true });
  const report: ShieldReport = { owner: 'Own', scannedAt: 0, accounts: [delegated, seizable, empty], delegated: [delegated], closable: [empty], frozen: [], permanentDelegateExposure: [seizable], reclaimableSol: 0.0020393 };
  const fb = fallbackBrief(report);
  assert.match(fb.headline, /1 open door, 1 seizable holding/);
  assert.equal(fb.actions.length, 3);
  assert.match(fb.actions[0], /^Revoke/);
  assert.match(fb.actions[2], /0\.0020 SOL/);
  const d = shieldDigest(report) as { approvals: { delegate: string }[]; reclaimableSol: number };
  assert.equal(d.approvals[0].delegate, 'De1e...1111');
  assert.equal(d.reclaimableSol, 0.002);
  const clean = fallbackBrief({ ...report, delegated: [], permanentDelegateExposure: [], closable: [], reclaimableSol: 0 });
  assert.equal(clean.headline, 'Clean wallet, nothing to fix');
  assert.equal(acceptBrief({ headline: 'Two doors open', summary: 'A delegate can still move your tokens.', actions: [] }, fb).brief.actions, fb.actions);
  assert.equal(acceptBrief({ headline: 'x' }, fb).generated, false);
});

test('explain: the prompt carries the finding, its evidence, the digest and a playbook note', () => {
  const r = token();
  const msgs = explainPrompt(r, r.findings[0]);
  assert.equal(msgs.length, 2);
  assert.match(msgs[1].content, /FINDING \(CRITICAL, launch\): Deployer dumped/);
  assert.match(msgs[1].content, /EVIDENCE: Sell tx: abc/);
  assert.match(msgs[1].content, /SCAN DIGEST: \{"kind":"token"/);
  assert.match(msgs[1].content, /PLAYBOOK NOTES:/);
  assert.doesNotMatch(msgs[0].content, NO_DASH);
});

test('explain: the tee hands the finished text over once the stream closes', async () => {
  let finished = '';
  const src = new ReadableStream<string>({
    start(c) {
      c.enqueue('Hel');
      c.enqueue('lo');
      c.close();
    },
  });
  const reader = teeText(src, (t) => (finished = t)).getReader();
  const out: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out.push(value);
  }
  assert.deepEqual(out, ['Hel', 'lo']);
  assert.equal(finished, 'Hello');
});

test('timeline: creation and launch-block buys lead, the bag moves follow by time, the holding closes', () => {
  const launch: LaunchForensics = {
    reached: true,
    signaturesScanned: 10,
    creationSignature: 'sig0',
    createdAt: 1_700_000_000,
    slot: 1,
    launchpad: 'pump.fun',
    deployer: 'Dep',
    devInitialPct: 25.9,
    bundled: { wallets: ['a', 'b', 'c'], pctOfSupply: 31.61, txCount: 3 },
    devSells: [{ signature: 'sell', secondsAfterLaunch: 76, pctOfSupply: 1.9 }],
    devTransfers: [{ signature: 'move', secondsAfterLaunch: 300, pctOfSupply: 4.5, recipients: 2 }],
    devCurrentPct: 0,
    devLocks: [{ signature: 'lock', secondsAfterLaunch: 99, pctOfSupply: 25.9, locker: 'Streamflow' }],
    devBurns: [],
  };
  const t = launchTimeline(launch);
  assert.deepEqual(t.map((e) => e.label), [
    'Token created on pump.fun',
    '3 wallets bought in the launch block',
    'Deployer sold 1.9% of supply',
    'Deployer locked 26% in Streamflow',
    'Deployer moved 4.5% to 2 wallets',
    'Deployer holds 0% of supply now',
  ]);
  assert.equal(t[0].href, 'https://solscan.io/tx/sig0');
  assert.equal(t[0].tone, 'caution');
  assert.equal(t[1].tone, 'signal');
  assert.equal(t[3].tone, 'safe');
  assert.equal(launchTimeline({ ...launch, reached: false }).length, 0);
  assert.equal(sinceLaunch(7), '+7s');
  assert.equal(sinceLaunch(136), '+2m 16s');
  assert.equal(sinceLaunch(3600 * 3 + 300), '+3h 5m');
  assert.equal(sinceLaunch(90_000), '+1d');
  assert.equal(sinceLaunch(null), 'time unknown');
});
