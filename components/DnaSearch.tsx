'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DnaHit } from '@/lib/ai/memory';
import type { Grade } from '@/lib/scan/types';
import { GradeBadge } from './ui';
import { TokenLogo } from './TokenLogo';

const EXAMPLES = ['fake TRUMP token', 'AI agent skins', 'duck meme on USDC', 'gold rush narrative'];

/** Search the Scam DNA index by description: embeddings on Workers AI against everything the hawk has scanned. */
export function DnaSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DnaHit[] | null>(null);
  const [asked, setAsked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(query: string) {
    const text = query.trim();
    if (text.length < 2) return;
    setBusy(true);
    setError(null);
    setAsked(text);
    try {
      const r = await fetch(`/api/ai/memory?q=${encodeURIComponent(text)}`);
      const d = (await r.json()) as { hits?: DnaHit[]; error?: string; available?: boolean };
      if (!r.ok) throw new Error(d.error ?? 'Search failed');
      if (d.available === false) throw new Error('Scam DNA search is not available right now.');
      setHits(d.hits ?? []);
    } catch (e) {
      setHits(null);
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-6 p-5 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Scam DNA · Predator AI</div>
          <h2 className="text-lg font-bold">Describe a token. See whether the hawk has already flagged that narrative.</h2>
          <p className="mt-1 text-sm text-muted">Every scanned identity is embedded with Predator AI. Same scam, new mint: the copies light up.</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
        className="mt-4 flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={200}
          placeholder="A name, a ticker, a narrative: 'Trump coin with a claim site'"
          className="min-w-0 flex-1 rounded-xl border border-graphite bg-ink/60 px-4 py-2.5 text-sm placeholder:text-muted focus:border-signal/60 focus:outline-none"
        />
        <button type="submit" disabled={busy || q.trim().length < 2} className="btn-ghost sm:w-40">{busy ? 'Searching...' : 'Search DNA'}</button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setQ(ex);
              void search(ex);
            }}
            className="underline underline-offset-4 hover:text-bone"
          >
            {ex}
          </button>
        ))}
      </div>
      {error ? <p className="mt-3 text-sm text-signal">{error}</p> : null}
      {hits ? (
        hits.length ? (
          <div className="mt-4 divide-y divide-graphite/50">
            {hits.map((h) => (
              <Link key={h.address} href={`/token/${h.address}`} className="flex items-center gap-3 py-3 hover:bg-ink/40">
                <TokenLogo src={h.image} label={h.symbol ?? h.name ?? h.address} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {h.symbol ? `$${h.symbol}` : h.name ?? `${h.address.slice(0, 6)}…`} <span className="font-normal text-muted">{h.name && h.symbol ? h.name : h.launchpad ?? ''}</span>
                  </div>
                  <div className="truncate text-xs text-muted">{h.flag ?? 'No risk findings'}</div>
                </div>
                <span className="hidden font-mono text-xs text-muted sm:inline">{Math.round(h.similarity * 100)}% match</span>
                <GradeBadge grade={h.grade as Grade} score={h.risk} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">Nothing in the index resembles &quot;{asked}&quot;. Scan a mint and it joins the DNA.</p>
        )
      ) : null}
    </div>
  );
}
