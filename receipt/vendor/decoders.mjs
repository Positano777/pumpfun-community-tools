// src/errors.ts
var SolanaExplainError = class extends Error {
  code;
  cause;
  /** Optional, CLI-friendly remediation hint. */
  hint;
  constructor(code, message, options = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.cause !== void 0) this.cause = options.cause;
    if (options.hint !== void 0) this.hint = options.hint;
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var DecodeError = class extends SolanaExplainError {
};
var InputError = class extends SolanaExplainError {
};

// node_modules/base-x/src/esm/index.js
function base(ALPHABET2) {
  if (ALPHABET2.length >= 255) {
    throw new TypeError("Alphabet too long");
  }
  const BASE_MAP = new Uint8Array(256);
  for (let j = 0; j < BASE_MAP.length; j++) {
    BASE_MAP[j] = 255;
  }
  for (let i = 0; i < ALPHABET2.length; i++) {
    const x = ALPHABET2.charAt(i);
    const xc = x.charCodeAt(0);
    if (BASE_MAP[xc] !== 255) {
      throw new TypeError(x + " is ambiguous");
    }
    BASE_MAP[xc] = i;
  }
  const BASE = ALPHABET2.length;
  const LEADER = ALPHABET2.charAt(0);
  const FACTOR = Math.log(BASE) / Math.log(256);
  const iFACTOR = Math.log(256) / Math.log(BASE);
  function encode(source) {
    if (source instanceof Uint8Array) {
    } else if (ArrayBuffer.isView(source)) {
      source = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    } else if (Array.isArray(source)) {
      source = Uint8Array.from(source);
    }
    if (!(source instanceof Uint8Array)) {
      throw new TypeError("Expected Uint8Array");
    }
    if (source.length === 0) {
      return "";
    }
    let zeroes = 0;
    let length = 0;
    let pbegin = 0;
    const pend = source.length;
    while (pbegin !== pend && source[pbegin] === 0) {
      pbegin++;
      zeroes++;
    }
    const size = (pend - pbegin) * iFACTOR + 1 >>> 0;
    const b58 = new Uint8Array(size);
    while (pbegin !== pend) {
      let carry = source[pbegin];
      let i = 0;
      for (let it1 = size - 1; (carry !== 0 || i < length) && it1 !== -1; it1--, i++) {
        carry += 256 * b58[it1] >>> 0;
        b58[it1] = carry % BASE >>> 0;
        carry = carry / BASE >>> 0;
      }
      if (carry !== 0) {
        throw new Error("Non-zero carry");
      }
      length = i;
      pbegin++;
    }
    let it2 = size - length;
    while (it2 !== size && b58[it2] === 0) {
      it2++;
    }
    let str = LEADER.repeat(zeroes);
    for (; it2 < size; ++it2) {
      str += ALPHABET2.charAt(b58[it2]);
    }
    return str;
  }
  function decodeUnsafe(source) {
    if (typeof source !== "string") {
      throw new TypeError("Expected String");
    }
    if (source.length === 0) {
      return new Uint8Array();
    }
    let psz = 0;
    let zeroes = 0;
    let length = 0;
    while (source[psz] === LEADER) {
      zeroes++;
      psz++;
    }
    const size = (source.length - psz) * FACTOR + 1 >>> 0;
    const b256 = new Uint8Array(size);
    while (psz < source.length) {
      const charCode = source.charCodeAt(psz);
      if (charCode > 255) {
        return;
      }
      let carry = BASE_MAP[charCode];
      if (carry === 255) {
        return;
      }
      let i = 0;
      for (let it3 = size - 1; (carry !== 0 || i < length) && it3 !== -1; it3--, i++) {
        carry += BASE * b256[it3] >>> 0;
        b256[it3] = carry % 256 >>> 0;
        carry = carry / 256 >>> 0;
      }
      if (carry !== 0) {
        throw new Error("Non-zero carry");
      }
      length = i;
      psz++;
    }
    let it4 = size - length;
    while (it4 !== size && b256[it4] === 0) {
      it4++;
    }
    const vch = new Uint8Array(zeroes + (size - it4));
    let j = zeroes;
    while (it4 !== size) {
      vch[j++] = b256[it4++];
    }
    return vch;
  }
  function decode(string) {
    const buffer = decodeUnsafe(string);
    if (buffer) {
      return buffer;
    }
    throw new Error("Non-base" + BASE + " character");
  }
  return {
    encode,
    decodeUnsafe,
    decode
  };
}
var esm_default = base;

// node_modules/bs58/src/esm/index.js
var ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var esm_default2 = esm_default(ALPHABET);

// src/input/encoding.ts
function decodeBase58(input) {
  try {
    return esm_default2.decode(input);
  } catch (err) {
    throw new InputError("INVALID_ENCODING", "Input is not valid base58.", { cause: err });
  }
}
function encodeBase58(bytes) {
  return esm_default2.encode(bytes);
}

// src/decode/reader.ts
var Reader = class {
  view;
  bytes;
  offset = 0;
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining() {
    return this.bytes.length - this.offset;
  }
  ensure(n, field) {
    if (this.offset + n > this.bytes.length) {
      throw new DecodeError(
        "DECODE_FAILED",
        `unexpected end while reading ${field} (need ${n} bytes at offset ${this.offset}, have ${this.remaining})`
      );
    }
  }
  u8(field = "u8") {
    this.ensure(1, field);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }
  u16(field = "u16") {
    this.ensure(2, field);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32(field = "u32") {
    this.ensure(4, field);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  u64(field = "u64") {
    this.ensure(8, field);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }
  i64(field = "i64") {
    this.ensure(8, field);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }
  bytes_(n, field = "bytes") {
    this.ensure(n, field);
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  /** Read a 32-byte pubkey and return base58. */
  pubkey(field = "pubkey") {
    return encodeBase58(this.bytes_(32, field));
  }
  /**
   * Solana compact-u16 (a.k.a. ShortVec) length prefix. 1–3 bytes, 7 bits each.
   */
  compactU16(field = "compact-u16") {
    let value = 0;
    let shift = 0;
    for (let i = 0; i < 3; i++) {
      const byte = this.u8(`${field} length byte`);
      value |= (byte & 127) << shift;
      if ((byte & 128) === 0) return value >>> 0;
      shift += 7;
    }
    return value >>> 0;
  }
  /** Remaining bytes (no copy). */
  rest() {
    const out = this.bytes.subarray(this.offset);
    this.offset = this.bytes.length;
    return out;
  }
};

// src/decode/known-programs.ts
var SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
var TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
var TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
var ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
var MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
var MEMO_V1_PROGRAM_ID = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";
var COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
var KNOWN_PROGRAMS = Object.freeze({
  // Core / decoded
  [SYSTEM_PROGRAM_ID]: { name: "System", kind: "system" },
  [TOKEN_PROGRAM_ID]: { name: "SPL Token", kind: "token" },
  [TOKEN_2022_PROGRAM_ID]: { name: "Token-2022", kind: "token-2022" },
  [ASSOCIATED_TOKEN_PROGRAM_ID]: { name: "Associated Token Account", kind: "ata" },
  [MEMO_PROGRAM_ID]: { name: "Memo", kind: "memo" },
  [MEMO_V1_PROGRAM_ID]: { name: "Memo (v1)", kind: "memo" },
  [COMPUTE_BUDGET_PROGRAM_ID]: { name: "Compute Budget", kind: "compute-budget" },
  // Native
  Stake11111111111111111111111111111111111111: { name: "Stake", kind: "stake" },
  Vote111111111111111111111111111111111111111: { name: "Vote", kind: "vote" },
  BPFLoaderUpgradeab1e11111111111111111111111: { name: "BPF Upgradeable Loader", kind: "loader" },
  BPFLoader2111111111111111111111111111111111: { name: "BPF Loader 2", kind: "loader" },
  AddressLookupTab1e1111111111111111111111111: {
    name: "Address Lookup Table",
    kind: "other"
  },
  // Metaplex
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: {
    name: "Metaplex Token Metadata",
    kind: "nft"
  },
  BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY: {
    name: "Metaplex Bubblegum",
    kind: "nft"
  },
  cndy3Z4yxLzowg4ZTHTHJYjBmtkk3vd6yMJ4r8x7q3o: {
    name: "Metaplex Candy Machine",
    kind: "nft"
  },
  // Aggregators / DEX
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: { name: "Jupiter v6", kind: "aggregator" },
  JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WconZX: { name: "Jupiter v4", kind: "aggregator" },
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": { name: "Raydium AMM v4", kind: "amm" },
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: { name: "Raydium CLMM", kind: "amm" },
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: { name: "Orca Whirlpool", kind: "amm" },
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP": { name: "Orca v2", kind: "amm" },
  PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY: { name: "Phoenix", kind: "amm" },
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: { name: "Meteora DLMM", kind: "amm" }
});

// src/decode/programs/system.ts
function acc(ix, i) {
  return ix.accounts[i]?.pubkey;
}
function decodeSystem(ix) {
  if (ix.data.length < 4) {
    return { decoded: false, program: "System", warning: "instruction data too short" };
  }
  const r = new Reader(ix.data);
  const disc = r.u32("discriminator");
  try {
    switch (disc) {
      case 0: {
        const lamports = r.u64("lamports");
        const space = r.u64("space");
        const owner = r.pubkey("owner");
        const newAccount = acc(ix, 1) ?? "";
        return {
          program: "System",
          type: "createAccount",
          decoded: true,
          args: { lamports: lamports.toString(), space: space.toString(), owner },
          accountNames: ["funding", "new"],
          effects: [
            {
              kind: "account-created",
              address: newAccount,
              owner,
              lamports,
              space: Number(space),
              as: "system"
            }
          ]
        };
      }
      case 1: {
        const owner = r.pubkey("owner");
        return {
          program: "System",
          type: "assign",
          decoded: true,
          args: { owner },
          accountNames: ["account"]
        };
      }
      case 2: {
        const lamports = r.u64("lamports");
        const from = acc(ix, 0) ?? "";
        const to = acc(ix, 1) ?? "";
        return {
          program: "System",
          type: "transfer",
          decoded: true,
          args: { lamports: lamports.toString() },
          accountNames: ["from", "to"],
          effects: [{ kind: "sol-transfer", from, to, lamports }]
        };
      }
      case 3: {
        const base2 = r.pubkey("base");
        const seedLen = Number(r.u64("seed length"));
        const seed = new TextDecoder().decode(r.bytes_(seedLen, "seed"));
        const lamports = r.u64("lamports");
        const space = r.u64("space");
        const owner = r.pubkey("owner");
        const newAccount = acc(ix, 1) ?? "";
        return {
          program: "System",
          type: "createAccountWithSeed",
          decoded: true,
          args: { base: base2, seed, lamports: lamports.toString(), space: space.toString(), owner },
          accountNames: ["funding", "new", "base"],
          effects: [
            {
              kind: "account-created",
              address: newAccount,
              owner,
              lamports,
              space: Number(space),
              as: "system"
            }
          ]
        };
      }
      case 8: {
        const space = r.u64("space");
        return {
          program: "System",
          type: "allocate",
          decoded: true,
          args: { space: space.toString() },
          accountNames: ["account"]
        };
      }
      case 9: {
        const base2 = r.pubkey("base");
        const seedLen = Number(r.u64("seed length"));
        const seed = new TextDecoder().decode(r.bytes_(seedLen, "seed"));
        const space = r.u64("space");
        const owner = r.pubkey("owner");
        return {
          program: "System",
          type: "allocateWithSeed",
          decoded: true,
          args: { base: base2, seed, space: space.toString(), owner },
          accountNames: ["account", "base"]
        };
      }
      case 10: {
        const base2 = r.pubkey("base");
        const seedLen = Number(r.u64("seed length"));
        const seed = new TextDecoder().decode(r.bytes_(seedLen, "seed"));
        const owner = r.pubkey("owner");
        return {
          program: "System",
          type: "assignWithSeed",
          decoded: true,
          args: { base: base2, seed, owner },
          accountNames: ["account", "base"]
        };
      }
      case 11: {
        const lamports = r.u64("lamports");
        const seedLen = Number(r.u64("seed length"));
        const fromSeed = new TextDecoder().decode(r.bytes_(seedLen, "fromSeed"));
        const fromOwner = r.pubkey("fromOwner");
        const from = acc(ix, 0) ?? "";
        const to = acc(ix, 2) ?? "";
        return {
          program: "System",
          type: "transferWithSeed",
          decoded: true,
          args: { lamports: lamports.toString(), fromSeed, fromOwner },
          accountNames: ["from", "base", "to"],
          effects: [{ kind: "sol-transfer", from, to, lamports }]
        };
      }
      default: {
        const names = {
          4: "advanceNonceAccount",
          5: "withdrawNonceAccount",
          6: "initializeNonceAccount",
          7: "authorizeNonceAccount"
        };
        return {
          program: "System",
          type: names[disc] ?? `unknown(${disc})`,
          decoded: disc in names
        };
      }
    }
  } catch (err) {
    return {
      program: "System",
      decoded: false,
      warning: err instanceof Error ? err.message : "system decode failed",
      warningCode: "partial-decode"
    };
  }
}
var systemDecoder = {
  programId: SYSTEM_PROGRAM_ID,
  name: "System",
  kind: "system",
  decode: decodeSystem
};
export {
  decodeBase58,
  encodeBase58,
  systemDecoder
};
