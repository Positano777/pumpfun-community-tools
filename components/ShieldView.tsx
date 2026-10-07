'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Buffer } from 'buffer';
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { ShieldAccount, ShieldReport } from '@/lib/scan/shield';
import { Address, Section, Stat } from './ui';

const WalletButton = dynamic(() => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton), { ssr: false });

// SPL Token / Token-2022 instruction tags (identical in both programs).
const IX_REVOKE = 5;
const IX_CLOSE_ACCOUNT = 9;

// Optional transparent platform fee on reclaimed rent. Fails closed: with no
// treasury configured at build time, no fee instruction is ever added.
const TREASURY = process.env.NEXT_PUBLIC_RUGHAWK_TREASURY ?? '';
const FEE_BPS = Math.min(Number(process.env.NEXT_PUBLIC_RECLAIM_FEE_BPS ?? 0) || 0, 2000);

function revokeIx(account: ShieldAccount, owner: PublicKey) {
  return new TransactionInstruction({
    programId: new PublicKey(account.programId),
    keys: [
      { pubkey: new PublicKey(account.address), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([IX_REVOKE]),
  });
}

function closeIx(account: ShieldAccount, owner: PublicKey) {
  return new TransactionInstruction({
    programId: new PublicKey(account.programId),
    keys: [
      { pubkey: new PublicKey(account.address), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([IX_CLOSE_ACCOUNT]),
  });
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function ShieldView() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [report, setReport] = useState<ShieldReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/shield?owner=${publicKey.toBase58()}`);
      const d = (await r.json()) as ShieldReport;
      setReport(d);
      setSelected(new Set(d.delegated.map((a) => a.address)));
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (connected) void load();
    else setReport(null);
  }, [connected, load]);

  const fee = useMemo(() => {
    if (!report || !TREASURY || FEE_BPS <= 0) return 0;
    return Math.floor((report.closable.reduce((s, a) => s + a.lamports, 0) * FEE_BPS) / 10_000);
  }, [report]);

  async function confirm(sig: string) {
    for (let i = 0; i < 40; i++) {
      const { value } = await connection.getSignatureStatuses([sig]);
      const s = value[0];
      if (s?.err) throw new Error('Transaction failed on chain');
      if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error('Not confirmed in time; check the signature on Solscan.');
  }

  async function send(label: string, batches: TransactionInstruction[][], extra?: (i: number) => TransactionInstruction[]) {
    if (!publicKey) return;
    setBusy(label);
    try {
      for (let i = 0; i < batches.length; i++) {
        const ixs = batches[i];
        const tx = new Transaction();
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 30_000 + ixs.length * 6_000 }));
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
        ixs.forEach((ix) => tx.add(ix));
        extra?.(i).forEach((ix) => tx.add(ix));
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        tx.feePayer = publicKey;
        const sig = await sendTransaction(tx, connection, { skipPreflight: false });
        setLog((l) => [`${label} ${i + 1}/${batches.length}: ${sig}`, ...l]);
        await confirm(sig);
      }
      setLog((l) => [`${label}: done`, ...l]);
      await load();
    } catch (e) {
      setLog((l) => [`${label} stopped: ${e instanceof Error ? e.message : 'failed'}`, ...l]);
    } finally {
      setBusy(null);
    }
  }

  const revokeSelected = () => {
    if (!report || !publicKey) return;
    const targets = report.delegated.filter((a) => selected.has(a.address));
    void send('Revoke', chunk(targets.map((a) => revokeIx(a, publicKey)), 10));
  };

  const closeEmpty = () => {
    if (!report || !publicKey) return;
    const batches = chunk(report.closable, 8);
    void send(
      'Reclaim',
      batches.map((b) => b.map((a) => closeIx(a, publicKey))),
      (i) => {
        if (!fee || !TREASURY) return [];
        const lamports = Math.floor((batches[i].reduce((s, a) => s + a.lamports, 0) * FEE_BPS) / 10_000);
        return lamports > 0 ? [SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(TREASURY), lamports })] : [];
      },
    );
  };

  if (!connected) {
    return (
      <div className="card mx-auto max-w-xl p-8 text-center">
        <h2 className="text-xl font-bold">Connect the wallet you want to protect</h2>
        <p className="mt-2 text-sm text-muted">Shield reads your token accounts and prepares fixes. Nothing moves unless you sign it in your wallet.</p>
        <div className="mt-6 flex justify-center"><WalletButton /></div>
      </div>
    );
  }
  if (loading && !report) return <div className="card scan-line mx-auto max-w-xl p-8 text-center text-sm text-muted">Reading your token accounts...</div>;
  if (!report) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Token accounts" value={report.accounts.length} />
        <Stat label="Live approvals" value={report.delegated.length} tone={report.delegated.length ? 'text-signal' : 'text-safe'} />
        <Stat label="Seizable holdings" value={report.permanentDelegateExposure.length} tone={report.permanentDelegateExposure.length ? 'text-caution' : ''} />
        <Stat label="Reclaimable rent" value={`${report.reclaimableSol.toFixed(4)} SOL`} hint={`${report.closable.length} empty accounts`} tone="text-safe" />
      </div>

      <Section
        title="Live approvals"
        kicker="Delegates that can move your tokens"
        right={report.delegated.length ? <button type="button" className="btn-primary !py-2 text-xs" disabled={!!busy || selected.size === 0} onClick={revokeSelected}>{busy === 'Revoke' ? 'Revoking...' : `Revoke ${selected.size}`}</button> : null}
      >
        {report.delegated.length ? (
          <ul className="space-y-2">
            {report.delegated.map((a) => (
              <li key={a.address} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-graphite/60 bg-ink/40 p-3 text-sm">
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={selected.has(a.address)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(a.address); else n.delete(a.address); return n; })} className="accent-[#D63B3B]" />
                  <span>Mint <Address value={a.mint} href={`/token/${a.mint}`} /></span>
                </label>
                <span className="text-xs text-muted">delegate <Address value={a.delegate!} href={`/wallet/${a.delegate}`} /> · {a.delegatedUi.toLocaleString('en-US')} allowed of {a.uiAmount.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-safe">No live approvals. Nobody can move your tokens without a new signature.</p>
        )}
      </Section>

      <Section
        title="Reclaim rent from empty accounts"
        kicker="Each empty token account holds a refundable deposit"
        right={report.closable.length ? <button type="button" className="btn-primary !py-2 text-xs" disabled={!!busy} onClick={closeEmpty}>{busy === 'Reclaim' ? 'Closing...' : `Reclaim ${report.reclaimableSol.toFixed(4)} SOL`}</button> : null}
      >
        <p className="text-sm text-muted">
          Closing an empty token account returns its rent to you. Only accounts with a zero balance, not frozen and with no withheld fees are included.
          {fee ? ` RugHawk keeps ${(FEE_BPS / 100).toFixed(1)}% of the reclaimed rent (${(fee / 1e9).toFixed(5)} SOL), shown in your wallet before you sign.` : ''}
        </p>
        <div className="mt-3 text-xs text-muted">{report.closable.length} closable · {report.frozen.length} frozen (cannot be closed)</div>
      </Section>

      {report.permanentDelegateExposure.length ? (
        <Section title="Tokens your issuer can seize" kicker="Token-2022 permanent delegate">
          <ul className="space-y-1.5 text-sm">
            {report.permanentDelegateExposure.map((a) => (
              <li key={a.address} className="flex justify-between gap-2">
                <Address value={a.mint} href={`/token/${a.mint}`} />
                <span className="text-xs text-caution">{a.uiAmount.toLocaleString('en-US')} at risk · delegate <Address value={a.permanentDelegate!} /></span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {log.length ? (
        <div className="card p-4 font-mono text-xs text-muted">
          {log.map((l) => (
            <div key={l} className="truncate">{l}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
