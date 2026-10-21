import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../examples/launch-synthetic.json', import.meta.url));
test('standalone CLI exports qualified evidence without dependencies', () => {
  const out = JSON.parse(execFileSync(process.execPath, [cli, fixture], {encoding: 'utf8'}));
  assert.equal(out.coverage.creation, 'located');
  assert.equal(out.coverage.launchBlock, 'unknown');
  assert.equal(out.launchSlotObservations.purchasesVerified, false);
  assert.equal(out.feePayerOutflows[0].kind, 'transfer');
});
test('invalid JSON fails and an existing destination is never overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'launch-evidence-'));
  const invalid = join(dir, 'invalid.json');
  const destination = join(dir, 'existing.json');
  writeFileSync(invalid, '{}');
  writeFileSync(destination, 'preserve me');
  assert.equal(spawnSync(process.execPath, [cli, invalid]).status, 1);
  assert.equal(spawnSync(process.execPath, [cli, fixture, destination]).status, 1);
  assert.equal(readFileSync(destination, 'utf8'), 'preserve me');
});

test('JSON syntax errors do not echo malformed input contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'launch-evidence-json-'));
  const invalid = join(dir, 'invalid.json');
  writeFileSync(invalid, 'synthetic-sensitive-value is not JSON');
  const out = spawnSync(process.execPath, [cli, invalid], {encoding: 'utf8'});
  assert.equal(out.status, 1);
  assert.ok(!out.stderr.includes('synthetic-sensitive-value'));
  assert.match(out.stderr, /Invalid scan JSON/);
});
