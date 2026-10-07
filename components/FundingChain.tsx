import type { FundingHop } from '@/lib/scan/types';
import { Address } from './ui';

const KIND_STYLE: Record<FundingHop['kind'], string> = {
  wallet: 'border-graphite text-bone',
  'exchange-like': 'border-caution/50 text-caution',
  program: 'border-safe/40 text-safe',
  pda: 'border-safe/40 text-safe',
  unknown: 'border-graphite text-muted',
};

export function FundingChain({ chain, startLabel }: { chain: FundingHop[]; startLabel: string }) {
  if (!chain.length) return <p className="text-sm text-muted">No funding trail could be reconstructed.</p>;
  return (
    <ol className="relative space-y-3 border-l border-graphite/70 pl-5">
      {chain.map((h, i) => (
        <li key={h.address + i} className="relative">
          <span className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 bg-ink ${i === 0 ? 'border-signal' : 'border-graphite'}`} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">{i === 0 ? startLabel : `Funder ${i}`}</span>
            <span className={`chip ${KIND_STYLE[h.kind]}`}>{h.kind}</span>
          </div>
          <div className="mt-1"><Address value={h.address} href={`/wallet/${h.address}`} /></div>
          <div className="mt-0.5 text-xs text-muted">
            {h.balanceSol !== null ? `${h.balanceSol.toLocaleString('en-US', { maximumFractionDigits: 2 })} SOL now` : null}
            {h.amountSol !== null && h.fundedBy ? ` · first funded with ${h.amountSol.toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL` : null}
            {h.time ? ` · ${new Date(h.time * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC` : null}
            {h.note ? ` · ${h.note}` : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
