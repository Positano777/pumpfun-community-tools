import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
// Run from the repository root with development dependencies installed.
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--outDir', '.evidence-build', 'lib/scan/launch-evidence.ts'], { stdio: 'inherit' });
writeFileSync('evidence/launch-evidence.mjs', '// Generated from lib/scan/launch-evidence.ts. Run node scripts/build-evidence.mjs.\n' + readFileSync('.evidence-build/launch-evidence.js', 'utf8'));
