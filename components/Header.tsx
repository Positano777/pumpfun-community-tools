'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';

const WalletButton = dynamic(() => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton), { ssr: false });

const NAV = [
  { href: '/#scan', label: 'Scan' },
  { href: '/shield', label: 'Shield' },
  { href: '/ask', label: 'Ask the Hawk' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/account', label: 'Account' },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // A navigation closes the menu; so does Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-graphite/60 bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <Logo />
          <span className="text-lg font-extrabold tracking-tight">
            Rug<span className="text-signal">Hawk</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted md:flex" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-bone">{n.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <WalletButton />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-graphite bg-coal text-bone md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? (
                <>
                  <path d="M3 3l12 12" />
                  <path d="M15 3L3 15" />
                </>
              ) : (
                <>
                  <path d="M2 4.5h14" />
                  <path d="M2 9h14" />
                  <path d="M2 13.5h14" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="Primary" className="border-t border-graphite/60 bg-ink/95 px-4 py-3 md:hidden">
          <ul className="grid gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-bone hover:bg-coal">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
