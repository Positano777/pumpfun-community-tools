/**
 * Tolerant JSON extraction for LLM output (reused from Solmint, lib/ai-json.ts).
 *
 * Models are asked for strict JSON and mostly comply, but not reliably. The
 * first live incident lost its AI triage to
 * "Bad escaped character in JSON at position 594": a stray backslash inside a
 * generated sentence. A naive JSON.parse throws away an otherwise perfectly good
 * analysis, which is the wrong trade for narration: the numbers are already on
 * screen, so imperfect prose beats no prose.
 *
 * Strategy, cheapest first:
 *   1. parse the braces span as-is
 *   2. parse again after repairing the failure modes actually observed in
 *      production: markdown fences, invalid escapes, raw control characters and
 *      newlines inside strings, trailing commas, smart quotes
 *   3. return null and let the caller fall back, never throw
 */
export function parseLooseJson<T = Record<string, unknown>>(raw: string): T | null {
  if (!raw) return null;

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const span = raw.slice(start, end + 1);

  try {
    return JSON.parse(span) as T;
  } catch {
    // fall through to repair
  }

  // eslint-disable-next-line no-control-regex
  const CONTROL_CHARS = new RegExp('[\u0000-\u001f]', 'g');

  const repaired = span
    // markdown fences the model was told not to emit
    .replace(/```json|```/g, '')
    // invalid escape sequences: keep the ones JSON allows, drop the backslash
    .replace(/\\(?!["\\/bfnrtu])/g, '')
    // raw control characters are illegal inside JSON strings
    .replace(CONTROL_CHARS, ' ')
    // trailing commas before a close
    .replace(/,\s*([}\]])/g, '$1')
    // smart quotes used for the JSON syntax itself
    .replace(/[“”]/g, '"');

  try {
    return JSON.parse(repaired) as T;
  } catch {
    return null;
  }
}
