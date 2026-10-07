import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-graphite/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-muted md:grid-cols-3">
        <div>
          <div className="font-bold text-bone">RugHawk</div>
          <p className="mt-2 max-w-xs">Solana forensic intelligence. Built by RaptorLabs, the team behind Solmint.dev.</p>
        </div>
        <div className="space-y-1.5">
          <div className="font-semibold text-bone">Product</div>
          <Link href="/#scan" className="block hover:text-bone">Token X-Ray</Link>
          <Link href="/shield" className="block hover:text-bone">Wallet Shield</Link>
          <Link href="/ask" className="block hover:text-bone">Ask the Hawk</Link>
        </div>
        <div className="space-y-1.5">
          <div className="font-semibold text-bone">Trust</div>
          <p>Read-only scans. RugHawk never asks for a seed phrase and never moves funds without your signature.</p>
          <p>Not financial advice. A low score is not a guarantee.</p>
        </div>
      </div>
    </footer>
  );
}
