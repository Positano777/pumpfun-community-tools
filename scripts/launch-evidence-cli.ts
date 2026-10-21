import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { launchEvidence, parseEvidenceInput } from '../lib/scan/launch-evidence';

const [source, destination, ...extra] = process.argv.slice(2);
try {
  if (!source || extra.length) throw new Error('Usage: npm run evidence -- scan.json [evidence.json]');
  if (statSync(source).size > 5_000_000) throw new Error('Scan exceeds the 5 MB input limit');
  const input = parseEvidenceInput(JSON.parse(readFileSync(source, 'utf8')));
  const output = JSON.stringify(launchEvidence(input), null, 2) + '\n';
  if (destination) writeFileSync(destination, output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Invalid scan JSON' : error instanceof Error ? error.message : 'Evidence export failed');
  process.exitCode = 1;
}
