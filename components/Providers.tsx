'use client';

import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

/**
 * Wallets (Phantom, Solflare, Backpack, ...) register through the Wallet
 * Standard, so no adapter list is needed. RPC goes through the same-origin
 * relay so endpoint tokens never reach the browser.
 */
export function Providers({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => {
    if (typeof window !== 'undefined') return `${window.location.origin}/api/rpc`;
    return `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://rughawk.com'}/api/rpc`;
  }, []);
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
