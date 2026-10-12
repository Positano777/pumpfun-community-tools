import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AskHawk } from '@/components/AskHawk';

export const metadata: Metadata = {
  title: 'Ask the Hawk',
  description: 'A Solana security copilot powered by Predator AI, grounded in deterministic scans and the Hawk Playbook, guarded by an injection screen and a content safety filter.',
};

export default function AskPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Ask the Hawk</div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Your on-chain forensic analyst.</h1>
        <p className="mt-2 text-sm text-muted">Answers are grounded in live scans and the Hawk Playbook. Not financial advice.</p>
      </div>
      <Suspense>
        <AskHawk />
      </Suspense>
    </div>
  );
}
