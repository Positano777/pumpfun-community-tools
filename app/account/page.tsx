import type { Metadata } from 'next';
import { AccountView } from '@/components/AccountView';

export const metadata: Metadata = {
  title: 'Account',
  description: 'Your RugHawk plan, API key and Watchtower alerts, tied to your Solana wallet.',
};

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-8 max-w-2xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Account</div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Your plan, your key, your alerts.</h1>
        <p className="mt-3 text-muted">Billing runs on Stripe. Your wallet signs in; nothing about it beyond the public key is stored.</p>
      </div>
      <AccountView />
    </div>
  );
}
