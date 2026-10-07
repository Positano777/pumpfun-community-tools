'use client';

import { useState } from 'react';

export function ShareBar({ path, text }: { path: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
  const x = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  return (
    <div className="flex flex-wrap gap-2">
      <a href={x} target="_blank" rel="noreferrer noopener" className="btn-ghost !py-2 text-xs">Share on X</a>
      <a href={tg} target="_blank" rel="noreferrer noopener" className="btn-ghost !py-2 text-xs">Telegram</a>
      <button
        type="button"
        className="btn-ghost !py-2 text-xs"
        onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>
    </div>
  );
}
