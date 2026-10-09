'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import type { Me } from '@/lib/me';

/**
 * The signed-in account, shared by every component on the page. The wallet
 * is the identity: signing in means signing a plain message (no transaction,
 * no fee) that the server checks before it sets the session cookie.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const store = {
  me: null as Me | null,
  loaded: false,
  listeners: new Set<() => void>(),
};

function emit() {
  store.listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  store.listeners.add(l);
  return () => {
    store.listeners.delete(l);
  };
}

let inflight: Promise<void> | null = null;

export function currentMe(): Me | null {
  return store.me;
}

export function refreshMe(): Promise<void> {
  if (!inflight) {
    inflight = fetch('/api/me', { cache: 'no-store' })
      .then(async (r) => {
        store.me = r.ok ? ((await r.json()) as Me) : null;
      })
      .catch(() => {
        store.me = null;
      })
      .finally(() => {
        store.loaded = true;
        inflight = null;
        emit();
      });
  }
  return inflight;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export type SignInResult = 'ok' | 'connecting' | 'failed';

export function useAccount() {
  const { publicKey, signMessage, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const me = useSyncExternalStore(subscribe, () => store.me, () => null);
  const loaded = useSyncExternalStore(subscribe, () => store.loaded, () => false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!loaded) void refreshMe();
  }, [loaded]);

  const signIn = useCallback(async (): Promise<SignInResult> => {
    if (!publicKey) {
      setPending(true);
      setVisible(true);
      return 'connecting';
    }
    if (!signMessage) {
      setError('This wallet cannot sign messages. Use Phantom, Solflare or Backpack.');
      return 'failed';
    }
    setBusy(true);
    setError(null);
    try {
      const wallet = publicKey.toBase58();
      const n = await fetch('/api/auth/nonce', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ wallet }) });
      const nd = (await n.json()) as { message?: string; error?: string };
      if (!n.ok || !nd.message) throw new Error(nd.error ?? 'Sign-in failed');
      const signature = await signMessage(new TextEncoder().encode(nd.message));
      const v = await fetch('/api/auth/verify', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ wallet, signature: toBase64(signature) }) });
      const vd = (await v.json()) as { error?: string };
      if (!v.ok) throw new Error(vd.error ?? 'Sign-in failed');
      await refreshMe();
      return 'ok';
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(/reject|declin|cancel|denied/i.test(msg) ? 'Sign-in was cancelled in the wallet.' : msg || 'Sign-in failed');
      return 'failed';
    } finally {
      setBusy(false);
    }
  }, [publicKey, signMessage, setVisible]);

  // Finish a sign-in that was waiting for the wallet modal.
  useEffect(() => {
    if (pending && publicKey) {
      setPending(false);
      void signIn();
    }
  }, [pending, publicKey, signIn]);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    await refreshMe();
  }, []);

  const signedIn = Boolean(me?.wallet);
  const mismatch = Boolean(me?.wallet && publicKey && me.wallet !== publicKey.toBase58());
  return { me, loaded, busy, error, signedIn, connected, mismatch, signIn, signOut, refresh: refreshMe };
}
