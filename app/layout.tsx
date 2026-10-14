import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Backdrop } from '@/components/Backdrop';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://rughawk.xyz';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: 'RugHawk: spot the rug before it is pulled', template: '%s | RugHawk' },
  description:
    'Solana forensic scanner. Token X-Ray traces the deployer, the launch block and every authority; Wallet Shield revokes drainer approvals in one click. Powered by Predator AI.',
  openGraph: { siteName: 'RugHawk', type: 'website' },
  twitter: { card: 'summary_large_image' },
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { themeColor: '#05060A', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">
        <Backdrop />
        <Providers>
          <Header />
          <main>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
