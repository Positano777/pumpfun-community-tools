'use client';

import { useState } from 'react';
import type { SharePost } from '@/lib/ai/share';

/**
 * Share a report. The plain buttons carry the deterministic one-liner; "Write
 * a warning" asks Predator AI for a post built from the findings, which the
 * trader can edit before it goes out.
 */
export function ShareBar({ path, text, ai }: { path: string; text: string; ai?: { kind: 'token' | 'wallet'; address: string } }) {
  const [copied, setCopied] = useState<'link' | 'post' | null>(null);
  const [post, setPost] = useState<SharePost | null>(null);
  const [draft, setDraft] = useState('');
  const [channel, setChannel] = useState<'x' | 'telegram'>('x');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
  const xHref = (t: string) => `https://x.com/intent/post?text=${encodeURIComponent(t)}&url=${encodeURIComponent(url)}`;
  const tgHref = (t: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(t)}`;

  function copy(value: string, what: 'link' | 'post') {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  async function write() {
    if (!ai) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch('/api/ai/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ai) });
      const d = (await r.json()) as { post?: SharePost; generated?: boolean; error?: string };
      if (!r.ok || !d.post) throw new Error(d.error ?? 'The hawk could not write the post.');
      setPost(d.post);
      setDraft(d.post.x);
      setChannel('x');
      if (!d.generated) setNote('Predator AI was unavailable; this is the engine wording.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'The hawk could not write the post.');
    } finally {
      setBusy(false);
    }
  }

  function pick(next: 'x' | 'telegram') {
    if (!post) return;
    setChannel(next);
    setDraft(next === 'x' ? post.x : post.telegram);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <a href={xHref(text)} target="_blank" rel="noreferrer noopener" className="btn-ghost !py-2 text-xs">Share on X</a>
        <a href={tgHref(text)} target="_blank" rel="noreferrer noopener" className="btn-ghost !py-2 text-xs">Telegram</a>
        <button type="button" className="btn-ghost !py-2 text-xs" onClick={() => copy(url, 'link')}>
          {copied === 'link' ? 'Link copied' : 'Copy link'}
        </button>
        {ai && !post ? (
          <button type="button" className="btn-primary !py-2 text-xs" disabled={busy} onClick={() => void write()} title="Predator AI writes a warning post from the findings">
            {busy ? 'Writing...' : 'Write a warning'}
          </button>
        ) : null}
      </div>
      {note && !post ? <p className="mt-2 text-xs text-signal">{note}</p> : null}
      {post ? (
        <div className="mt-3 rounded-xl border border-signal/30 bg-coal/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Warning post · Predator AI</div>
            <div className="flex gap-1 text-[11px]">
              <button type="button" onClick={() => pick('x')} className={`rounded-md border px-2 py-0.5 font-semibold ${channel === 'x' ? 'border-signal text-signal' : 'border-graphite text-muted'}`}>For X</button>
              <button type="button" onClick={() => pick('telegram')} className={`rounded-md border px-2 py-0.5 font-semibold ${channel === 'telegram' ? 'border-signal text-signal' : 'border-graphite text-muted'}`}>For Telegram</button>
            </div>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={channel === 'x' ? 4 : 7}
            maxLength={800}
            className="mt-2 w-full resize-y rounded-lg border border-graphite bg-ink/60 px-3 py-2 text-sm leading-relaxed text-bone focus:border-signal/60 focus:outline-none"
            aria-label="Warning post text"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {channel === 'x' ? (
              <a href={xHref(draft)} target="_blank" rel="noreferrer noopener" className="btn-primary !py-1.5 text-xs">Post on X</a>
            ) : (
              <a href={tgHref(draft)} target="_blank" rel="noreferrer noopener" className="btn-primary !py-1.5 text-xs">Send on Telegram</a>
            )}
            <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => copy(`${draft}\n${url}`, 'post')}>
              {copied === 'post' ? 'Copied' : 'Copy text'}
            </button>
            <span className="text-[11px] text-muted">{draft.length} characters · facts from the scan, edit freely · the report link is added</span>
          </div>
          {note ? <p className="mt-2 text-[11px] text-muted">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
