import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-graphite/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-muted md:grid-cols-4">
        <div>
          <div className="font-bold text-bone">RugHawk</div>
          <p className="mt-2 max-w-xs">Solana forensic intelligence. Built by <a href="https://raptorlabs.dev" target="_blank" rel="noreferrer noopener" className="text-bone underline decoration-graphite underline-offset-4 hover:decoration-signal">RaptorLabs</a>, the team behind Solmint.dev.</p>
          <p className="mt-2 max-w-xs">An entry in the Colosseum Crypto World&apos;s Fair, Solana track.</p>
        </div>
        <div className="space-y-1.5">
          <div className="font-semibold text-bone">Product</div>
          <Link href="/#scan" className="block hover:text-bone">Token X-Ray</Link>
          <Link href="/shield" className="block hover:text-bone">Wallet Shield</Link>
          <Link href="/ask" className="block hover:text-bone">Ask the Hawk</Link>
          <Link href="/#pricing" className="block hover:text-bone">Pricing and API</Link>
        </div>
        <div className="space-y-1.5">
          <div className="font-semibold text-bone">Open source</div>
          <a href="https://github.com/bobvasic/rughawk" target="_blank" rel="noreferrer noopener" className="block hover:text-bone">Source on GitHub</a>
          <p>One Cloudflare Worker: Workers AI, Vectorize, Browser Run, AI Search, D1, KV, R2. RPC by QuickNode and Ankr.</p>
          <a href="mailto:security@raptorlabs.dev" className="block hover:text-bone">Report a security issue</a>
        </div>
        <div className="space-y-1.5">
          <div className="font-semibold text-bone">Trust</div>
          <p>Read-only scans. RugHawk never asks for a seed phrase and never moves funds without your signature.</p>
          <p>The engine decides; the AI explains. No model output can change a score.</p>
          <p>Not financial advice. A low score is not a guarantee.</p>
        </div>
      </div>
    </footer>
  );
}
