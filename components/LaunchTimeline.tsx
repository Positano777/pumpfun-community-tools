import type { LaunchForensics } from '@/lib/scan/types';
import { launchTimeline, sinceLaunch, type TimelineTone } from '@/lib/scan/timeline';

const DOT: Record<TimelineTone, string> = {
  signal: 'border-signal bg-signal/30 shadow-[0_0_10px_rgba(196,43,43,0.45)]',
  caution: 'border-caution bg-caution/30',
  safe: 'border-safe bg-safe/30',
  muted: 'border-graphite bg-ink',
};

const TEXT: Record<TimelineTone, string> = { signal: 'text-signal', caution: 'text-caution', safe: 'text-safe', muted: 'text-muted' };

/** The launch, second by second: what the engine read in the creation block and in the deployer's bag afterwards. */
export function LaunchTimeline({ launch }: { launch: LaunchForensics }) {
  const events = launchTimeline(launch);
  if (!events.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Timeline</div>
      <ol className="relative mt-2 space-y-3 border-l border-graphite/70 pl-5">
        {events.map((e, i) => (
          <li key={`${e.label}-${i}`} className="relative">
            <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 ${DOT[e.tone]}`} />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={`font-mono text-xs ${TEXT[e.tone]}`}>{e.at === null && i === events.length - 1 ? 'now' : sinceLaunch(e.at)}</span>
              {e.href ? (
                <a href={e.href} target="_blank" rel="noreferrer noopener" className="text-sm font-semibold underline decoration-graphite underline-offset-4 hover:decoration-signal">{e.label}</a>
              ) : (
                <span className="text-sm font-semibold">{e.label}</span>
              )}
            </div>
            <div className="text-xs text-muted">{e.detail}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
