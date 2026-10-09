'use client';

import { useEffect, useState } from 'react';
import { useAccount } from './useAccount';
import type { PaidPlan } from '@/lib/billing/stripe';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * The Pro and API buttons: connect the wallet if needed, sign in, then hand
 * the wallet to Stripe. A wallet already on the plan goes to its account.
 */
export function PricingCta({ plan, label, hot = false }: { plan: PaidPlan; label: string; hot?: boolean }) {
  const { me, signedIn, signIn, busy, error } = useAccount();
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [intent, setIntent] = useState(false);
  const current = me?.plan === plan;
  const covered = plan === 'pro' && me?.plan === 'api';

  async function checkout() {
    setWorking(true);
    setNote(null);
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ plan }) });
      const d = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !d.url) {
        setNote(d.error ?? 'Checkout is unavailable right now.');
        return;
      }
      window.location.assign(d.url);
    } catch {
      setNote('Checkout is unavailable right now.');
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (intent && signedIn) {
      setIntent(false);
      void checkout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, signedIn]);

  useEffect(() => {
    if (error) setIntent(false);
  }, [error]);

  async function go() {
    setNote(null);
    if (current || covered) {
      window.location.assign('/account');
      return;
    }
    if (signedIn) {
      await checkout();
      return;
    }
    setIntent(true);
    const result = await signIn();
    if (result === 'failed') setIntent(false);
  }

  const text = current ? 'Current plan · open account' : covered ? 'Included in your API plan' : working ? 'Opening Stripe...' : busy ? 'Check your wallet...' : label;
  return (
    <div className="mt-6">
      <button type="button" onClick={() => void go()} disabled={working || busy} className={`${hot ? 'btn-primary' : 'btn-ghost'} w-full`}>
        {text}
      </button>
      {note || error ? <p className="mt-2 text-center text-xs text-signal">{note ?? error}</p> : null}
    </div>
  );
}
