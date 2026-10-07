import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { WalletReportView } from '@/components/WalletReportView';
import { isAddress } from '@/lib/solana/address';

export async function generateMetadata(props: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await props.params;
  return {
    title: `Wallet scan ${address.slice(0, 4)}…${address.slice(-4)}`,
    description: `RugHawk forensic profile of Solana address ${address}: type, funding trail, approvals, poisoning and AI verdict.`,
  };
}

export default async function WalletPage(props: { params: Promise<{ address: string }> }) {
  const { address } = await props.params;
  if (!isAddress(address)) notFound();
  return <WalletReportView address={address} />;
}
