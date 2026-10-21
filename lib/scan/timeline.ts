/**
 * The launch as a sequence of events: creation, the launch-block buys, and
 * every classified move of the deployer's bag (sale, transfer, lock, burn)
 * with seconds after launch. Pure data for the timeline on the token page.
 */
import type { LaunchForensics } from './types';
import { pctText, plural } from '../format';

export type TimelineTone = 'signal' | 'caution' | 'safe' | 'muted';

export interface TimelineEvent {
  /** Seconds after launch; null when the engine could not time it. */
  at: number | null;
  label: string;
  detail: string;
  tone: TimelineTone;
  href?: string;
}

/** "+7s", "+2m 16s", "+3h 5m", "+5d". */
export function sinceLaunch(seconds: number | null): string {
  if (seconds === null) return 'time unknown';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `+${s}s`;
  if (s < 3600) return `+${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
  if (s < 86_400) return `+${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)}m` : ''}`;
  return `+${Math.floor(s / 86_400)}d`;
}

const tx = (sig: string | null | undefined) => (sig ? `https://solscan.io/tx/${sig}` : undefined);

export function launchTimeline(l: LaunchForensics): TimelineEvent[] {
  if (!l.reached) return [];
  const events: TimelineEvent[] = [];
  const dev = l.devInitialPct;
  events.push({
    at: 0,
    label: `Token created${l.launchpad ? ` on ${l.launchpad}` : ''}`,
    detail: dev !== null && dev > 0 ? `Deployer bought ${pctText(dev)} of supply in the creation transaction.` : 'No deployer buy in the creation transaction.',
    tone: dev !== null && dev >= 10 ? 'caution' : 'muted',
    href: tx(l.creationSignature),
  });
  if (l.bundled.wallets.length) {
    events.push({
      at: 0,
      label: `${plural(l.bundled.wallets.length, 'wallet')} gained tokens in the launch block`,
      detail: `${pctText(l.bundled.pctOfSupply)} of supply in summed positive token deltas (not necessarily distinct holdings)${l.bundled.txCount > 1 ? `, across ${plural(l.bundled.txCount, 'transaction')}` : ''}. Transfers may be included; coordination and bundle membership are unverified.`,
      tone: 'signal',
    });
  }
  for (const s of l.devSells) events.push({ at: s.secondsAfterLaunch, label: `Deployer sold ${pctText(s.pctOfSupply)} of supply`, detail: 'Tokens went to a trading venue or came back as SOL.', tone: 'signal', href: tx(s.signature) });
  for (const t of l.devTransfers ?? []) events.push({ at: t.secondsAfterLaunch, label: `Deployer moved ${pctText(t.pctOfSupply)} to ${plural(t.recipients, 'wallet')}`, detail: t.recipients >= 10 ? 'Many fresh wallets at once: a holder count being manufactured.' : 'A bag spread across wallets that holder checks do not link to the deployer.', tone: 'caution', href: tx(t.signature) });
  for (const k of l.devLocks ?? []) events.push({ at: k.secondsAfterLaunch, label: `Deployer locked ${pctText(k.pctOfSupply)} in ${k.locker}`, detail: 'Locked tokens cannot be sold until the lock releases; check the unlock schedule on the locker.', tone: 'safe', href: tx(k.signature) });
  for (const b of l.devBurns ?? []) events.push({ at: b.secondsAfterLaunch, label: `Deployer burned ${pctText(b.pctOfSupply)} of supply`, detail: 'Burned tokens are destroyed and can never be sold.', tone: 'safe', href: tx(b.signature) });
  // Creation first, then by time; untimed events last.
  const timed = events.slice(0, l.bundled.wallets.length ? 2 : 1);
  const rest = events.slice(timed.length).sort((a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER));
  const out = [...timed, ...rest];
  if (l.devCurrentPct !== null) {
    out.push({
      at: null,
      label: `Deployer holds ${pctText(l.devCurrentPct)} of supply now`,
      detail: l.devCurrentPct === 0 ? 'The launch bag is gone from the deployer wallet.' : 'What the deployer can still sell into buyers.',
      tone: l.devCurrentPct >= 10 ? 'caution' : 'muted',
    });
  }
  return out;
}
