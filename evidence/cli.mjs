import { readFileSync, writeFileSync } from 'node:fs';
import { launchEvidence, parseEvidenceInput } from './launch-evidence.mjs';

const [source, destination, ...extra] = process.argv.slice(2);
try {
  if (!source || extra.length) throw new Error('Usage: node evidence/cli.mjs scan.json [evidence.json]');
  const input = parseEvidenceInput(JSON.parse(readFileSync(source, 'utf8')));
  const output = JSON.stringify(launchEvidence(input), null, 2) + '\n';
  if (destination) writeFileSync(destination, output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Evidence export failed');
  process.exitCode = 1;
}
