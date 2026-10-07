import Link from 'next/link';
import { SearchBox } from '@/components/SearchBox';
import { Feed } from '@/components/Feed';

const FEATURES = [
  { k: 'Launch forensics', t: 'Reads the creation block itself', d: 'Dev buy at creation, every wallet that bought in the launch block, and how many seconds after launch the deployer started dumping.' },
  { k: 'Deployer dossier', t: 'Who launched it, really', d: 'Wallet age at launch, serial-launcher detection, and the funding trail back to an exchange or a chain of burner wallets.' },
  { k: 'Authority audit', t: 'Every power the issuer still holds', d: 'Mint and freeze authority, mutable metadata and all Token-2022 traps: permanent delegate, transfer hooks, fee hikes, default-frozen, pausable.' },
  { k: 'Holder intelligence', t: 'Concentration without the noise', d: 'Top holders classified as pools, bonding curves, burns, lockers, exchange custody or plain wallets before any percentage is computed.' },
  { k: 'Scam DNA', t: 'Same scam, new mint', d: 'Every token identity is embedded with Workers AI and stored in Vectorize, so the 40th copy of a flagged narrative lights up instantly.' },
  { k: 'Site & logo forensics', t: 'What the website really shows', d: 'Browser Run renders the token website, Llama 4 Scout reviews it for drainer lures and checks the logo for brand impersonation.' },
];

const TIERS = [
  { name: 'Free', price: '$0', per: '', items: ['25 scans a day', 'AI verdicts', 'Wallet Shield (revoke & reclaim)', 'Shareable risk cards'], cta: 'Start scanning', href: '#scan' },
  { name: 'Pro', price: '$19', per: '/month', items: ['Unlimited scans', 'Watchtower alerts on Telegram', 'Deep site & logo forensics', 'Copilot with web intel'], cta: 'Go Pro', href: '#scan', hot: true },
  { name: 'API', price: '$99', per: '/month', items: ['50,000 scan calls', 'For trading bots, launchpads, wallets', 'Webhook alerts', 'SLA on request'], cta: 'Get API access', href: 'mailto:security@raptorlabs.dev?subject=RugHawk%20API' },
];

export default function Home() {
  return (
    <div>
      <section id="scan" className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 grid-bg" />
        <div className="pointer-events-none absolute inset-0 glow-top" />
        <div className="relative mx-auto max-w-4xl px-4 pb-16 pt-20 text-center md:pt-28">
          <div className="chip mx-auto border-signal/40 bg-signal/10 text-signal">Solana forensic intelligence</div>
          <h1 className="mt-5 text-4xl font-extrabold tracking-tight md:text-6xl">
            Spot the rug <span className="text-signal">before</span> it&apos;s pulled.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-bone/75 md:text-lg">
            RugHawk reads the launch block, traces the deployer and audits every authority in seconds. Then Cloudflare Workers AI tells you what it means.
          </p>
          <div className="mx-auto mt-8 max-w-2xl">
            <SearchBox autoFocus />
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-muted">
            <span>Try:</span>
            <Link className="underline underline-offset-4 hover:text-bone" href="/token/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263">BONK</Link>
            <Link className="underline underline-offset-4 hover:text-bone" href="/token/2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo">PYUSD (Token-2022)</Link>
            <Link className="underline underline-offset-4 hover:text-bone" href="/wallet/JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4">Jupiter program</Link>
          </div>
          <div className="mt-10 text-[11px] uppercase tracking-[0.2em] text-muted">Cloudflare Workers AI · AI Gateway · Vectorize · Browser Run · QuickNode</div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4">
        <Feed />
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4">
        <div className="max-w-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">What the hawk sees</div>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Scanners show you a score. RugHawk shows you the operator.</h2>
          <p className="mt-3 text-muted">Most rug checkers stop at authorities and holder percentages. The money is lost in the first minutes of a launch, so that is where RugHawk looks hardest.</p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.k} className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">{f.k}</div>
              <div className="mt-2 font-bold">{f.t}</div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-20 grid max-w-6xl gap-4 px-4 md:grid-cols-2">
        <div className="card p-6 md:p-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Wallet Shield</div>
          <h3 className="mt-2 text-2xl font-extrabold">Kill drainer approvals. Get your rent back.</h3>
          <p className="mt-3 text-sm text-muted">Connect a wallet to see every live token approval, every token its issuer can seize, and every empty account holding your SOL deposit. Revoke and reclaim in one signed transaction.</p>
          <Link href="/shield" className="btn-primary mt-6">Open Shield</Link>
        </div>
        <div className="card p-6 md:p-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Ask the Hawk</div>
          <h3 className="mt-2 text-2xl font-extrabold">A forensic copilot that cannot be talked into lying.</h3>
          <p className="mt-3 text-sm text-muted">Paste an address and ask anything. The deterministic engine decides what is dangerous; Workers AI explains it, grounded in AI Search, behind Prompt Guard and Llama Guard.</p>
          <Link href="/ask" className="btn-ghost mt-6">Ask a question</Link>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4">
        <div className="card grid gap-6 p-6 md:grid-cols-4 md:p-8">
          <div className="md:col-span-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Field-tested</div>
            <h3 className="mt-2 text-xl font-extrabold">Rules from measured data, not vibes.</h3>
            <p className="mt-2 text-xs text-muted">RaptorLabs mainnet study, September 2026: 13 trending tokens, 70 control launches.</p>
          </div>
          {[
            ['13 / 13', 'dead control launches where the creator exited, median 7 seconds after launch'],
            ['10 / 13', 'trending tokens dead or dying within hours'],
            ['90', 'launches in 36.7 hours from a single serial-launcher wallet'],
          ].map(([n, t]) => (
            <div key={n} className="rounded-xl border border-graphite/60 bg-ink/40 p-5">
              <div className="font-mono text-3xl font-extrabold text-signal">{n}</div>
              <p className="mt-2 text-sm text-muted">{t}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto mt-20 max-w-6xl px-4">
        <div className="text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Pricing</div>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Free for traders. Built for platforms.</h2>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.name} className={`card p-6 ${t.hot ? 'border-signal/60 shadow-glow' : ''}`}>
              <div className="font-bold">{t.name}</div>
              <div className="mt-3"><span className="text-4xl font-extrabold">{t.price}</span><span className="text-muted">{t.per}</span></div>
              <ul className="mt-5 space-y-2 text-sm">
                {t.items.map((i) => (
                  <li key={i} className="flex gap-2"><span className="text-signal">▸</span>{i}</li>
                ))}
              </ul>
              <a href={t.href} className={`${t.hot ? 'btn-primary' : 'btn-ghost'} mt-6 w-full`}>{t.cta}</a>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
