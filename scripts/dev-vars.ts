import { readFileSync } from 'node:fs';

/** KEY=value pairs from the gitignored .dev.vars: local secrets for the terminal tools. */
export function loadDevVars(path = '.dev.vars'): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}
