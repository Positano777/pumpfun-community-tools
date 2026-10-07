import type { Metadata } from 'next';
import { ShieldView } from '@/components/ShieldView';

export const metadata: Metadata = {
  title: 'Wallet Shield',
  description: 'Revoke Solana token approvals, see tokens your issuer can seize, and reclaim rent from empty token accounts.',
};

export default function ShieldPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-8 max-w-2xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Wallet Shield</div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Close every door a drainer could use.</h1>
        <p className="mt-3 text-muted">Approvals you signed months ago still let someone move your tokens. Shield finds them, revokes them, and reclaims the SOL locked in empty token accounts. You sign everything in your own wallet.</p>
      </div>
      <ShieldView />
    </div>
  );
}
