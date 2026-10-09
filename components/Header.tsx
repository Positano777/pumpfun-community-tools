'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Logo } from './Logo';

const WalletButton = dynamic(() => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton), { ssr: false });

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-graphite/60 bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-lg font-extrabold tracking-tight">
            Rug<span className="text-signal">Hawk</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
          <Link href="/#scan" className="hover:text-bone">Scan</Link>
          <Link href="/shield" className="hover:text-bone">Shield</Link>
          <Link href="/ask" className="hover:text-bone">Ask the Hawk</Link>
          <Link href="/#pricing" className="hover:text-bone">Pricing</Link>
          <Link href="/account" className="hover:text-bone">Account</Link>
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
