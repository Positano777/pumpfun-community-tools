import type { ScanContext } from './context';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM, REGULATED_ISSUER_MINTS } from '../solana/known';

export interface ShieldAccount {
  address: string;
  mint: string;
  programId: string;
  amountRaw: string;
  uiAmount: number;
  decimals: number;
  lamports: number;
  delegate: string | null;
  delegatedUi: number;
  frozen: boolean;
  closeAuthority: string | null;
  /** Token-2022 transfer-fee balance withheld in this account; blocks closing until harvested. */
  withheld: boolean;
  /** The mint lets a third party move this balance at will. */
  permanentDelegate: string | null;
  /** Safe to close with a plain CloseAccount: empty, not frozen, nothing withheld. */
  closable: boolean;
}

export interface ShieldReport {
  owner: string;
  scannedAt: number;
  accounts: ShieldAccount[];
  delegated: ShieldAccount[];
  closable: ShieldAccount[];
  frozen: ShieldAccount[];
  permanentDelegateExposure: ShieldAccount[];
  reclaimableSol: number;
}

interface ParsedTokenAccount {
  pubkey: string;
  account: {
    lamports: number;
    data: {
      parsed: {
        info: {
          mint: string;
          owner: string;
          state: string;
          tokenAmount: { amount: string; decimals: number; uiAmount: number | null; uiAmountString: string };
          delegate?: string;
          delegatedAmount?: { uiAmount: number | null; uiAmountString: string };
          closeAuthority?: string;
          extensions?: { extension: string; state?: Record<string, unknown> }[];
        };
      };
    };
  };
}

/**
 * Everything a wallet owner needs to know about the token accounts it holds:
 * live approvals (delegates that can move tokens without asking), frozen
 * accounts, tokens whose issuer can seize them, and empty accounts locking up
 * rent that can be reclaimed.
 */
export async function loadShield(ctx: ScanContext, owner: string): Promise<ShieldReport> {
  const [classic, t22] = await Promise.all(
    [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((programId) =>
      ctx.rpc
        .call<{ value: ParsedTokenAccount[] }>('getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }])
        .then((r) => r.value.map((a) => ({ ...a, programId })))
        .catch(() => [] as (ParsedTokenAccount & { programId: string })[]),
    ),
  );
  const raw = [...classic, ...t22];

  // Permanent-delegate exposure needs the mint accounts of non-empty holdings.
  const heldMints = [...new Set(raw.filter((a) => a.account.data.parsed.info.tokenAmount.amount !== '0').map((a) => a.account.data.parsed.info.mint))].slice(0, 200);
  const mintAccts = heldMints.length
    ? await ctx.rpc
        .getMultipleAccounts<{ data: { parsed?: { info?: { extensions?: { extension: string; state?: Record<string, unknown> }[] } } } }>(heldMints, { encoding: 'jsonParsed' })
        .catch(() => [])
    : [];
  const permDelegate = new Map<string, string>();
  heldMints.forEach((m, i) => {
    const ext = mintAccts[i]?.data?.parsed?.info?.extensions?.find((e) => e.extension === 'permanentDelegate');
    const d = ext?.state?.delegate as string | undefined;
    if (d && !REGULATED_ISSUER_MINTS.has(m)) permDelegate.set(m, d);
  });

  const accounts: ShieldAccount[] = raw.map((a) => {
    const info = a.account.data.parsed.info;
    const withheld = (info.extensions ?? []).some(
      (e) => e.extension === 'transferFeeAmount' && Number((e.state as { withheldAmount?: number } | undefined)?.withheldAmount ?? 0) > 0,
    );
    const frozen = info.state === 'frozen';
    const empty = info.tokenAmount.amount === '0';
    return {
      address: a.pubkey,
      mint: info.mint,
      programId: a.programId,
      amountRaw: info.tokenAmount.amount,
      uiAmount: info.tokenAmount.uiAmount ?? Number(info.tokenAmount.uiAmountString ?? 0),
      decimals: info.tokenAmount.decimals,
      lamports: a.account.lamports,
      delegate: info.delegate ?? null,
      delegatedUi: info.delegatedAmount ? info.delegatedAmount.uiAmount ?? Number(info.delegatedAmount.uiAmountString ?? 0) : 0,
      frozen,
      closeAuthority: info.closeAuthority ?? null,
      withheld,
      permanentDelegate: permDelegate.get(info.mint) ?? null,
      closable: empty && !frozen && !withheld && (!info.closeAuthority || info.closeAuthority === owner),
    };
  });

  const closable = accounts.filter((a) => a.closable);
  return {
    owner,
    scannedAt: ctx.now(),
    accounts,
    delegated: accounts.filter((a) => a.delegate),
    closable,
    frozen: accounts.filter((a) => a.frozen),
    permanentDelegateExposure: accounts.filter((a) => a.permanentDelegate && a.uiAmount > 0),
    reclaimableSol: closable.reduce((s, a) => s + a.lamports, 0) / 1e9,
  };
}
