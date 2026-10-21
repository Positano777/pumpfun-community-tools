import type { ScanContext } from './context';
import type { LaunchBlockCoverage } from './types';
import type { ParsedTx } from '../rpc';

interface BlockTransaction {
  transaction: { signatures: string[]; accountKeys: { pubkey: string; signer: boolean }[] };
  meta: ParsedTx['meta'];
}

export interface LaunchBlockSample {
  transactions: ParsedTx[];
  coverage: LaunchBlockCoverage;
}

/** Sample exact-slot token activity. Coverage describes the provider response, not consensus verification. */
export async function readLaunchBlock(ctx: ScanContext, mint: string, slot: number, creationSig: string, limit = 40): Promise<LaunchBlockSample> {
  const unavailable = (reason: string): LaunchBlockSample => ({
    transactions: [],
    coverage: { status: 'unavailable', slot, source: 'getBlock', relevantTransactions: null, inspectedTransactions: 0, reasons: [reason] },
  });
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Launch block sample limit must be a positive integer');
  try {
    const block = await ctx.rpc.call<{blockTime: number | null; transactions: BlockTransaction[]} | null>('getBlock', [slot, {
      encoding: 'jsonParsed', transactionDetails: 'accounts', maxSupportedTransactionVersion: 1, rewards: false, commitment: 'confirmed',
    }]);
    if (!block || !Array.isArray(block.transactions)) return unavailable('block_unavailable');
    const creationIndex = block.transactions.findIndex(t => t.transaction.signatures.includes(creationSig));
    const reasons: string[] = [];
    if (creationIndex < 0) reasons.push('creation_missing_from_block');
    const relevant = block.transactions.filter(t => {
      if (t.transaction.signatures.includes(creationSig) || t.meta?.err) return false;
      return t.transaction.accountKeys.some(k => k.pubkey === mint) ||
        [...(t.meta?.preTokenBalances ?? []), ...(t.meta?.postTokenBalances ?? [])].some(b => b.mint === mint);
    });
    if (relevant.some(t => !t.meta || !t.meta.preTokenBalances || !t.meta.postTokenBalances)) reasons.push('token_balance_metadata_missing');
    if (relevant.length > limit) reasons.push('sample_limit');
    // Missing metadata in any successful-looking transaction can hide mint relevance.
    if (block.transactions.some(t => !t.meta)) reasons.push('transaction_metadata_missing');
    const inspected = relevant.slice(0, limit);
    return {
      transactions: inspected.map(t => ({
        slot, blockTime: block.blockTime, meta: t.meta,
        transaction: { signatures: t.transaction.signatures, message: {
          accountKeys: t.transaction.accountKeys.map(k => ({...k, writable: false})), instructions: [],
        } },
      })),
      coverage: {
        status: reasons.length ? 'incomplete' : 'complete', slot, source: 'getBlock',
        relevantTransactions: relevant.length, inspectedTransactions: inspected.length, reasons,
      },
    };
  } catch {
    // Provider messages can contain credential-bearing URLs; expose a fixed code only.
    return unavailable('block_fetch_failed');
  }
}
