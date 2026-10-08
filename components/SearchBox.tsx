'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function SearchBox({ autoFocus = false, compact = false }: { autoFocus?: boolean; compact?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = value.trim().replace(/^.*\/(token|address|account)\//, '').replace(/[?#].*$/, '');
    if (!BASE58.test(address)) {
      const question = value.trim();
      if (question.length >= 8 && /\s/.test(question)) {
        router.push(`/ask?q=${encodeURIComponent(question)}`);
        return;
      }
      setError('Paste a Solana token mint or wallet address, or ask a question in plain words.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/scan?address=${address}`);
      const data = (await res.json()) as { kind?: 'token' | 'wallet'; error?: string };
      if (!res.ok || !data.kind) throw new Error(data.error ?? 'Scan failed');
      router.push(`/${data.kind}/${address}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div className={`edge-light flex flex-col gap-2 rounded-2xl border border-graphite bg-coal/80 p-2 shadow-glow sm:flex-row ${busy ? 'scan-line' : ''}`}>
        <input
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a token mint, wallet or program address, or ask Predator AI a question"
          spellCheck={false}
          autoComplete="off"
          className={`min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-bone placeholder:font-sans placeholder:text-muted focus:outline-none ${compact ? 'py-2' : 'py-3'}`}
        />
        <button type="submit" disabled={busy} className="btn-primary sm:w-40">
          {busy ? 'Scanning...' : 'Scan it'}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-signal">{error}</p> : null}
    </form>
  );
}
