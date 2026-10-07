import { PublicKey } from '@solana/web3.js';
import { ATA_PROGRAM, METAPLEX_METADATA_PROGRAM } from './known';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** True for a syntactically valid 32-byte base58 Solana address. */
export function isAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !BASE58.test(value)) return false;
  try {
    return new PublicKey(value).toBytes().length === 32;
  } catch {
    return false;
  }
}

/** Off-curve addresses are PDAs: no private key exists, a program controls them. */
export function isPda(address: string): boolean {
  try {
    return !PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

/** The associated token account of `owner` for `mint` under `tokenProgram`. */
export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBytes(), new PublicKey(tokenProgram).toBytes(), new PublicKey(mint).toBytes()],
    new PublicKey(ATA_PROGRAM),
  );
  return ata.toBase58();
}

export function metaplexMetadataPda(mint: string): string {
  const program = new PublicKey(METAPLEX_METADATA_PROGRAM);
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('metadata'), program.toBytes(), new PublicKey(mint).toBytes()],
    program,
  );
  return pda.toBase58();
}

export function bytesToAddress(bytes: Uint8Array): string {
  return new PublicKey(bytes).toBase58();
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function shortAddress(a: string | null | undefined, n = 4): string {
  if (!a) return '';
  return a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

/** Extract every plausible Solana address from free text (used by the copilot). */
export function extractAddresses(text: string, max = 3): string[] {
  const found = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? [];
  const out: string[] = [];
  for (const f of found) {
    if (isAddress(f) && !out.includes(f)) out.push(f);
    if (out.length >= max) break;
  }
  return out;
}
