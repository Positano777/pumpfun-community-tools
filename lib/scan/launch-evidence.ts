import type { LaunchForensics } from './types';

export interface EvidenceInput {
  mint: string;
  scannedAt: number;
  launch: LaunchForensics | null;
  partial: string[];
}

/** An observation export, not an independent verification or risk score. */
export function launchEvidence(input: EvidenceInput) {
  const l = input.launch;
  const located = Boolean(l?.reached && l.creationSignature && l.slot !== null);
  const txLink = (signature: string) => ({ signature, url: `https://solscan.io/tx/${encodeURIComponent(signature)}` });
  const outflows = located && l ? [
    ...l.devSells.map(x => ({ ...x, kind: 'sale' as const })),
    ...l.devTransfers.map(x => ({ ...x, kind: 'transfer' as const })),
    ...l.devLocks.map(x => ({ ...x, kind: 'lock' as const })),
    ...l.devBurns.map(x => ({ ...x, kind: 'burn' as const })),
  ].map(x => ({ ...x, source: txLink(x.signature) })) : [];
  return {
    schema: 'positano.launch-evidence.v1',
    mint: input.mint,
    scannedAt: input.scannedAt,
    sourceEngine: 'RugHawk community fork',
    coverage: {
      creation: located ? 'located' : 'unavailable',
      launchBlock: 'unknown',
      warnings: [...input.partial],
    },
    creation: located && l ? {
      slot: l.slot,
      blockTime: l.createdAt,
      source: txLink(l.creationSignature!),
      feePayer: l.deployer,
      feePayerIsCreator: 'unverified',
    } : null,
    launchSlotObservations: located && l ? {
      netAcquiringFeePayers: [...new Set(l.bundled.wallets)],
      summedPositiveDeltasPctOfSupply: l.bundled.pctOfSupply,
      transactionCount: l.bundled.txCount,
      purchasesVerified: false,
      coordination: 'unverified',
      jitoBundleMembership: 'unverified',
    } : null,
    feePayerOutflows: outflows,
    limitations: [
      'Export of supplied scan data, not independent blockchain verification.',
      'Creation located does not establish complete launch-block or outflow coverage.',
      'Upstream may sample or omit transactions; missing block data can resemble no activity.',
      'Positive fee-payer token deltas can include transfers and repeated circulation of the same supply.',
      'Same-slot activity does not prove purchases, shared control, insider access, or Jito membership.',
      'Creation fee payer may be a service rather than the token creator.',
      'Outflow kinds are upstream heuristics; timestamps are block-level seconds.',
    ],
  };
}

/** Validate the fields consumed by the offline exporter. No network access. */
export function parseEvidenceInput(value: unknown): EvidenceInput {
  const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
  const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const nullableNumber = (v: unknown) => v === null || nonnegative(v);
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  const fail = (): never => { throw new Error('Invalid scan JSON: expected mint, scannedAt, partial, and a valid launch object or null.'); };
  if (!record(value) || typeof value.mint !== 'string' || !value.mint.trim() || !nonnegative(value.scannedAt) || !strings(value.partial)) return fail();
  if (value.kind !== undefined && value.kind !== 'token') return fail();
  const l = value.launch;
  if (l !== null) {
    if (!record(l) || typeof l.reached !== 'boolean' || !nullableString(l.creationSignature) || !nullableNumber(l.slot) || !nullableNumber(l.createdAt) || !nullableString(l.deployer)) return fail();
    if (l.reached && (!l.creationSignature || !Number.isSafeInteger(l.slot))) return fail();
    if (!record(l.bundled) || !strings(l.bundled.wallets) || !nonnegative(l.bundled.pctOfSupply) || !Number.isSafeInteger(l.bundled.txCount) || !nonnegative(l.bundled.txCount)) return fail();
    for (const field of ['devSells', 'devTransfers', 'devLocks', 'devBurns']) {
      const xs = l[field];
      if (!Array.isArray(xs) || !xs.every(x => record(x) && typeof x.signature === 'string' && x.signature.length > 0 && nullableNumber(x.secondsAfterLaunch) && nonnegative(x.pctOfSupply))) return fail();
    }
  }
  return value as unknown as EvidenceInput;
}
