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
  // Copy only known fields. Saved scan extensions may contain private diagnostics.
  const observation = (x: {signature: string; secondsAfterLaunch: number | null; pctOfSupply: number}, kind: string) => ({
    signature: x.signature, secondsAfterLaunch: x.secondsAfterLaunch, pctOfSupply: x.pctOfSupply, kind, source: txLink(x.signature),
  });
  const outflows = located && l ? [
    ...l.devSells.map(x => observation(x, 'sale')),
    ...l.devTransfers.map(x => ({...observation(x, 'transfer'), recipients: x.recipients})),
    ...l.devLocks.map(x => ({...observation(x, 'lock'), locker: x.locker})),
    ...l.devBurns.map(x => observation(x, 'burn')),
  ] : [];
  const block = located ? l?.blockCoverage : undefined;
  const safeModules = new Set(['metadata', 'market', 'launch', 'holders', 'deployer', 'website']);
  const warnings = input.partial.map(w => {
    const module = w.split(':', 1)[0];
    return `${safeModules.has(module) ? module : 'scan'} warning (raw diagnostic omitted)`;
  });
  return {
    schema: 'positano.launch-evidence.v1',
    mint: input.mint,
    scannedAt: input.scannedAt,
    sourceEngine: 'RugHawk community fork',
    coverage: {
      creation: located ? 'located' : 'unavailable',
      launchBlock: block?.status ?? 'unknown',
      launchBlockDetails: block ? {
        slot: block.slot, source: block.source, relevantTransactions: block.relevantTransactions,
        inspectedTransactions: block.inspectedTransactions, reasons: [...block.reasons],
      } : null,
      warnings,
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
      transactions: (l.launchSlotEvidence ?? []).map(x => ({
        source: txLink(x.signature), wallet: x.wallet, positiveDeltaPctOfSupply: x.positiveDeltaPctOfSupply,
      })),
      purchasesVerified: false,
      coordination: 'unverified',
      jitoBundleMembership: 'unverified',
    } : null,
    feePayerOutflows: outflows,
    limitations: [
      'Export of supplied scan data, not independent blockchain verification.',
      'Creation located does not establish complete launch-block or outflow coverage.',
      'Coverage describes the RPC response, not independent blockchain verification. Legacy reports may lack coverage metadata.',
      'Upstream may sample or omit transactions; missing block data can resemble no activity.',
      'Raw warning diagnostics and unknown outflow fields are deliberately omitted to reduce credential disclosure.',
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
    if (!(l.devTransfers as Record<string, unknown>[]).every(x => Number.isSafeInteger(x.recipients) && nonnegative(x.recipients))) return fail();
    if (!(l.devLocks as Record<string, unknown>[]).every(x => typeof x.locker === 'string')) return fail();
    const c = l.blockCoverage;
    if (c !== undefined) {
      const reasons = ['block_unavailable', 'block_fetch_failed', 'creation_missing_from_block', 'token_balance_metadata_missing', 'sample_limit', 'transaction_metadata_missing'];
      if (!record(c) || !['complete','incomplete','unavailable'].includes(String(c.status)) || c.source !== 'getBlock' || c.slot !== l.slot || !Number.isSafeInteger(c.inspectedTransactions) || !nonnegative(c.inspectedTransactions) || !strings(c.reasons) || c.reasons.some(r => !reasons.includes(r))) return fail();
      if (c.relevantTransactions !== null && (!Number.isSafeInteger(c.relevantTransactions) || !nonnegative(c.relevantTransactions))) return fail();
      if (typeof c.relevantTransactions === 'number' && c.inspectedTransactions > c.relevantTransactions) return fail();
      if (c.status === 'complete' && (c.relevantTransactions === null || c.inspectedTransactions !== c.relevantTransactions || c.reasons.length)) return fail();
      if (c.status !== 'complete' && c.reasons.length === 0) return fail();
      if (c.status === 'unavailable' && (c.relevantTransactions !== null || c.inspectedTransactions !== 0)) return fail();
    }
    if (l.launchSlotEvidence !== undefined && (!Array.isArray(l.launchSlotEvidence) || !l.launchSlotEvidence.every(x => record(x) && typeof x.signature === 'string' && typeof x.wallet === 'string' && nonnegative(x.positiveDeltaPctOfSupply)))) return fail();
  }
  return value as unknown as EvidenceInput;
}
