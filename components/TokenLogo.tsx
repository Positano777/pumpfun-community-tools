'use client';

import { useState } from 'react';

const SIZES = {
  sm: 'h-9 w-9 rounded-lg text-[11px]',
  md: 'h-12 w-12 rounded-xl text-sm',
} as const;

/** Up to two characters of the ticker or name, for the monogram tile. */
export function monogram(label: string | null | undefined): string {
  const clean = (label ?? '').replace(/^\$+/, '').replace(/[^\p{L}\p{N}]+/gu, '');
  return clean.slice(0, 2).toUpperCase() || '?';
}

/**
 * Token avatar: the logo through the image proxy, or a monogram tile when
 * the token has no logo or no gateway could serve it, so a row never shows
 * a broken image.
 */
export function TokenLogo({
  src,
  label,
  size = 'sm',
  className = '',
}: {
  src: string | null | undefined;
  label: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const box = `${SIZES[size]} shrink-0 border border-graphite ${className}`;
  if (src && failedSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/img?u=${encodeURIComponent(src)}`}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onError={() => setFailedSrc(src)}
        className={`${box} bg-ink object-cover`}
      />
    );
  }
  return (
    <div aria-hidden className={`${box} flex items-center justify-center bg-gradient-to-br from-graphite/80 to-ink font-bold tracking-wide text-bone/80`}>
      {monogram(label)}
    </div>
  );
}
