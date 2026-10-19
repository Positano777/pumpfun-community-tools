'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { WalletReadyState } from '@solana/wallet-adapter-base';

/** The adapter wallet-adapter adds by itself on Android. */
const MOBILE_WALLET_ADAPTER = 'Mobile Wallet Adapter';

/**
 * When no wallet is injected into this browser (phones in Chrome or Safari,
 * desktops without an extension) the adapter modal is a dead end, or worse:
 * on Android, wallet-adapter offers Mobile Wallet Adapter, which hands the
 * connection to the wallet app over an intent. Chrome then asks for local
 * network access and Phantom shows "This app's identity could not be
 * verified", because that check is a Digital Asset Links lookup for native
 * Android apps and a web page can never pass it. The clean path on a phone
 * is the wallet's own in-app browser, reached by a deep link: this page opens
 * inside Phantom or Solflare, whose injected provider connects like a desktop
 * extension. Same approach as Solmint's NoWalletDialog.
 *
 * Watches the adapter modal open with no injected wallet, closes it and
 * offers the deep links (and the install links) instead. Mounted once inside
 * WalletModalProvider, so every connect button gets it without changes.
 */
export function NoWalletDialog() {
  const { wallets, select } = useWallet();
  const { visible, setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);

  const mwa = wallets.find((w) => (w.adapter.name as string) === MOBILE_WALLET_ADAPTER) ?? null;
  const injected = wallets.some(
    (w) =>
      (w.adapter.name as string) !== MOBILE_WALLET_ADAPTER &&
      (w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable),
  );

  useEffect(() => {
    if (visible && !injected) {
      setVisible(false);
      setOpen(true);
    }
  }, [visible, injected, setVisible]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const phone = /android|iphone|ipad/i.test(navigator.userAgent);
  const here = encodeURIComponent(window.location.href);
  const ref = encodeURIComponent(window.location.origin);

  return (
    <div className="fixed inset-0 z-[1060] flex items-center justify-center bg-ink/80 p-4 backdrop-blur-md" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="no-wallet-title" className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 id="no-wallet-title" className="text-base font-semibold text-bone">{phone ? 'Open RugHawk in your wallet' : 'No wallet found'}</h3>
        <p className="mt-2 text-sm text-muted">
          {phone
            ? 'On a phone the wallet connects from its own browser. Open this page in Phantom or Solflare and connect there: no extra permissions, no warnings.'
            : 'Install a Solana wallet extension such as Phantom or Solflare, then try again.'}
        </p>
        <div className="mt-4 grid gap-2">
          {phone ? (
            <>
              <a className="btn-primary" href={`https://phantom.app/ul/browse/${here}?ref=${ref}`}>Open in Phantom</a>
              <a className="btn-ghost" href={`https://solflare.com/ul/v1/browse/${here}?ref=${ref}`}>Open in Solflare</a>
            </>
          ) : null}
          <a className="btn-ghost" href="https://phantom.com/download" target="_blank" rel="noopener">Get Phantom</a>
          <a className="btn-ghost" href="https://solflare.com/download" target="_blank" rel="noopener">Get Solflare</a>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          {mwa ? (
            <button
              type="button"
              className="underline underline-offset-2 hover:text-bone"
              onClick={() => {
                setOpen(false);
                select(mwa.adapter.name);
              }}
            >
              Use Mobile Wallet Adapter instead
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="hover:text-bone" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
