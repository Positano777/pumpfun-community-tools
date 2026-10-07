import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TokenReportView } from '@/components/TokenReportView';
import { isAddress } from '@/lib/solana/address';

export async function generateMetadata(props: { params: Promise<{ mint: string }> }): Promise<Metadata> {
  const { mint } = await props.params;
  const short = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const image = `/api/og/token/${mint}`;
  return {
    title: `Token scan ${short}`,
    description: `RugHawk forensic scan of Solana token ${mint}: launch block, deployer, authorities, holders and AI verdict.`,
    openGraph: { images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', images: [image] },
  };
}

export default async function TokenPage(props: { params: Promise<{ mint: string }> }) {
  const { mint } = await props.params;
  if (!isAddress(mint)) notFound();
  return <TokenReportView mint={mint} />;
}
