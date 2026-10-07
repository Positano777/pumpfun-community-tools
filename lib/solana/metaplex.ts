import { base64ToBytes, bytesToAddress } from './address';

export interface MetaplexMetadata {
  updateAuthority: string;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
  creators: { address: string; verified: boolean; share: number }[];
  primarySaleHappened: boolean;
  isMutable: boolean;
}

/**
 * Decode a Metaplex Token Metadata account (Borsh). Only the prefix the
 * scanner needs is read: authority, mint, name/symbol/uri, creators and the
 * two flags that follow them. Strings are null-padded on chain.
 */
export function decodeMetaplexMetadata(base64Data: string): MetaplexMetadata | null {
  try {
    const buf = base64ToBytes(base64Data);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let o = 0;
    const key = buf[o];
    o += 1;
    if (key !== 4) return null; // Key::MetadataV1
    const updateAuthority = bytesToAddress(buf.slice(o, o + 32));
    o += 32;
    const mint = bytesToAddress(buf.slice(o, o + 32));
    o += 32;
    const readString = (): string => {
      const len = view.getUint32(o, true);
      o += 4;
      if (len > 1000 || o + len > buf.length) throw new Error('bad string');
      const s = new TextDecoder().decode(buf.slice(o, o + len));
      o += len;
      return s.replace(/\0/g, '').trim();
    };
    const name = readString();
    const symbol = readString();
    const uri = readString();
    const sellerFeeBasisPoints = view.getUint16(o, true);
    o += 2;
    const creators: MetaplexMetadata['creators'] = [];
    const hasCreators = buf[o];
    o += 1;
    if (hasCreators === 1) {
      const count = view.getUint32(o, true);
      o += 4;
      for (let i = 0; i < count && i < 10; i++) {
        creators.push({ address: bytesToAddress(buf.slice(o, o + 32)), verified: buf[o + 32] === 1, share: buf[o + 33] });
        o += 34;
      }
    }
    const primarySaleHappened = buf[o] === 1;
    o += 1;
    const isMutable = buf[o] === 1;
    return { updateAuthority, mint, name, symbol, uri, sellerFeeBasisPoints, creators, primarySaleHappened, isMutable };
  } catch {
    return null;
  }
}
