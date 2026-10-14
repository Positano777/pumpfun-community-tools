'use client';

import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';

/**
 * Wallets (Phantom, Solflare, Backpack, ...) register through the Wallet
 * Standard, so no adapter list is needed. RPC goes through the same-origin
 * relay so endpoint tokens never reach the browser. The adapter UI is styled
 * in app/globals.css; its stock stylesheet is deliberately not imported.
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
