import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFindings, gradeFor } from '../lib/scan/score';
import { fold, impersonationFindings } from '../lib/scan/impersonation';
import { registrableDomain } from '../lib/scan/website';
import { analyzeMint } from '../lib/scan/mint';
import { isAddress, isPda, extractAddresses } from '../lib/solana/address';
import { gatewayUrls } from '../lib/scan/metadata';
import { localRetrieve } from '../lib/ai/playbook';
import type { Finding } from '../lib/scan/types';

const f = (severity: Finding['severity'], weight: number): Finding => ({ id: `${severity}${weight}`, severity, category: 'intel', title: '', detail: '', weight });

test('noisy-OR score never exceeds 100 and critical floors at 70', () => {
  assert.equal(scoreFindings([]).score, 0);
  assert.equal(scoreFindings([f('critical', 10)]).score, 70);
  assert.equal(scoreFindings([f('high', 5)]).score, 45);
  const many = scoreFindings(Array.from({ length: 30 }, () => f('medium', 30)));
  assert.ok(many.score <= 100 && many.score >= 99);
  assert.equal(gradeFor(19), 'LOW');
  assert.equal(gradeFor(20), 'ELEVATED');
  assert.equal(gradeFor(45), 'HIGH');
  assert.equal(gradeFor(70), 'CRITICAL');
});

test('homoglyph folding catches Cyrillic USDC impersonation', () => {
  const r = fold('USDС'); // last char is Cyrillic Es
  assert.equal(r.folded, 'USDC');
  assert.equal(r.hadConfusables, true);
  const findings = impersonationFindings('So11111111111111111111111111111111111111112', 'USD Coin', 'USDС');
  assert.ok(findings.some((x) => x.id === 'HOMOGLYPHS'));
  assert.ok(findings.some((x) => x.id === 'IMPERSONATES_BLUECHIP'));
});

test('the real USDC mint is not flagged as an impersonation of itself', () => {
  const findings = impersonationFindings('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USD Coin', 'USDC');
  assert.equal(findings.length, 0);
});

test('mint audit: permanent delegate is critical except for regulated issuers', () => {
  const ext = [{ extension: 'permanentDelegate', state: { delegate: '2apBGMsS6ti9RyF5TwQTDswXBWskiJP2LD4cUEDqYJjk' } }];
  const anon = analyzeMint('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', { program: 'spl-token-2022', decimals: 6, supply: '1', mintAuthority: null, freezeAuthority: null, extensions: ext });
  assert.equal(anon.findings.find((x) => x.id === 'PERMANENT_DELEGATE')?.severity, 'critical');
  const pyusd = analyzeMint('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', { program: 'spl-token-2022', decimals: 6, supply: '1', mintAuthority: 'x', freezeAuthority: 'x', extensions: ext });
  assert.equal(pyusd.findings.find((x) => x.id === 'PERMANENT_DELEGATE')?.severity, 'info');
});

test('transfer fee severity scales with basis points', () => {
  const mk = (bps: number) =>
    analyzeMint('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', {
      program: 'spl-token-2022', decimals: 6, supply: '1', mintAuthority: null, freezeAuthority: null,
      extensions: [{ extension: 'transferFeeConfig', state: { newerTransferFee: { transferFeeBasisPoints: bps }, olderTransferFee: { transferFeeBasisPoints: bps } } }],
    }).findings.find((x) => x.id === 'TRANSFER_FEE')?.severity;
  assert.equal(mk(50), 'low');
  assert.equal(mk(300), 'medium');
  assert.equal(mk(700), 'high');
  assert.equal(mk(2500), 'critical');
});

test('address helpers', () => {
  assert.equal(isAddress('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'), true);
  assert.equal(isAddress('not-an-address'), false);
  assert.equal(isPda('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'), true); // Raydium authority
  assert.equal(isPda('7uibUZA4cMiS6EdPEiBzSj6dbJGBYG3wif8RrHBHwvg6'), false); // a deployer wallet
  assert.deepEqual(extractAddresses('is DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 safe?'), ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263']);
});

test('domains and metadata URIs normalise', () => {
  assert.equal(registrableDomain('www.app.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('sub.rughawk.com'), 'rughawk.com');
  assert.ok(gatewayUrls('ipfs://bafyabc').every((u) => u.endsWith('/ipfs/bafyabc')));
  assert.deepEqual(gatewayUrls('ar://xyz'), ['https://arweave.net/xyz']);
});

test('playbook retrieval finds the relevant section', () => {
  const hits = localRetrieve('what is a permanent delegate token-2022');
  assert.ok(hits.length > 0);
  assert.ok(hits.some((h) => /permanent delegate/i.test(h.text)));
});
