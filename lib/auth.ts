import { PublicKey } from '@solana/web3.js';
import type { AppEnv, KVLike } from './env';

/**
 * Identity is a Solana wallet. Sign-in follows the Sign In With Solana
 * message shape: the server issues a nonce, the wallet signs a plain-text
 * message containing it, and the server checks the Ed25519 signature with
 * WebCrypto. The result is an HMAC-signed session cookie; nothing about the
 * wallet beyond its public key is stored.
 */

export const SESSION_COOKIE = 'rh_session';
const SESSION_TTL = 30 * 86_400;
const NONCE_TTL = 300;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const enc = new TextEncoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Random token from an unbiased draw over [0-9A-Za-z]. */
export function randomToken(length = 32): string {
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < 248 && out.length < length) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Sessions

export async function signSession(secret: string, wallet: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const payload = b64url(enc.encode(JSON.stringify({ w: wallet, iat, exp: iat + SESSION_TTL })));
  return `${payload}.${b64url(await hmacSha256(secret, payload))}`;
}

export async function verifySession(secret: string, token: string, now = Date.now()): Promise<string | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(await hmacSha256(secret, payload));
  if (!timingSafeEqual(enc.encode(expected), enc.encode(sig))) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(base64ToBytes(payload))) as { w?: unknown; exp?: unknown };
    if (typeof body.w !== 'string' || typeof body.exp !== 'number') return null;
    if (body.exp * 1000 < now) return null;
    return body.w;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/** The signed-in wallet behind a request, or null. */
export async function sessionWallet(req: Request, env: AppEnv): Promise<string | null> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token || !env.SESSION_SECRET) return null;
  return verifySession(env.SESSION_SECRET, token);
}

// Sign in with Solana

export function signInMessage(wallet: string, nonce: string, issuedAt: string, host = 'rughawk.xyz'): string {
  return [
    `${host} wants you to sign in with your Solana account:`,
    wallet,
    '',
    'This signature proves you own this wallet. It does not move funds and costs nothing.',
    '',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

interface Nonce {
  nonce: string;
  issuedAt: string;
}

/** Fallback for environments without KV (dev, tests): one process, short lived. */
const memoryNonces = new Map<string, Nonce & { expires: number }>();

export async function issueNonce(kv: KVLike | undefined, wallet: string, now = Date.now()): Promise<Nonce> {
  const value = { nonce: randomToken(24), issuedAt: new Date(now).toISOString() };
  if (kv) await kv.put(`auth:nonce:${wallet}`, JSON.stringify(value), { expirationTtl: NONCE_TTL });
  else memoryNonces.set(wallet, { ...value, expires: now + NONCE_TTL * 1000 });
  return value;
}

/** The pending nonce for a wallet, consumed so it cannot be replayed. */
export async function takeNonce(kv: KVLike | undefined, wallet: string, now = Date.now()): Promise<Nonce | null> {
  if (kv) {
    const key = `auth:nonce:${wallet}`;
    const hit = (await kv.get(key, 'json').catch(() => null)) as Nonce | null;
    if (!hit) return null;
    if (kv.delete) await kv.delete(key).catch(() => undefined);
    else await kv.put(key, JSON.stringify({ used: true }), { expirationTtl: 60 }).catch(() => undefined);
    return typeof hit.nonce === 'string' && typeof hit.issuedAt === 'string' ? hit : null;
  }
  const hit = memoryNonces.get(wallet);
  memoryNonces.delete(wallet);
  if (!hit || hit.expires < now) return null;
  return { nonce: hit.nonce, issuedAt: hit.issuedAt };
}

/** Ed25519 check of a wallet's detached signature over a UTF-8 message. */
export async function verifyWalletSignature(wallet: string, message: string, signature: Uint8Array): Promise<boolean> {
  let pub: Uint8Array;
  try {
    pub = new PublicKey(wallet).toBytes();
  } catch {
    return false;
  }
  if (signature.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(pub), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, Uint8Array.from(signature), enc.encode(message));
  } catch {
    return false;
  }
}
