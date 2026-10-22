import { systemDecoder, decodeBase58 } from './vendor/decoders.mjs';

export const LIMIT = 5 * 1024 * 1024;
const SYSTEM = '11111111111111111111111111111111';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
export class ReceiptError extends Error {}
function fail(message) { throw new ReceiptError(message); }
export function address(value) {
  if (typeof value !== 'string' || value.length > 44) fail('Invalid public wallet address.');
  try { if (decodeBase58(value).length === 32) return value; } catch {}
  fail('Invalid public wallet address.');
}
export function signature(value) {
  if (typeof value !== 'string' || value.length > 88) fail('Invalid transaction signature.');
  try { if (decodeBase58(value).length === 64) return value; } catch {}
  fail('Invalid transaction signature.');
}
function integer(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,29})$/.test(value)) return BigInt(value);
  fail('Missing or imprecise integer in transaction data.');
}
export function parseRpcJson(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMIT) fail('Input exceeds the 5 MB limit.');
  try {
    return JSON.parse(text, (_key, value, context) => {
      if (typeof value === 'number' && !Number.isSafeInteger(value) && Number.isInteger(value)) {
        if (context?.source && /^-?[0-9]+$/.test(context.source)) return context.source;
        fail('This runtime cannot preserve large RPC integers. Use Node.js 22 or a current browser.');
      }
      return value;
    });
  } catch (error) {
    if (error instanceof ReceiptError) throw error;
    fail('Input is not valid JSON.');
  }
}
export function sol(value) {
  const n = BigInt(value), abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${abs / 1000000000n}.${(abs % 1000000000n).toString().padStart(9, '0')}`;
}

// Decode only exact known layouts. Unsupported instructions stay unsupported.
function nativeFlow(ix, keys) {
  if (!ix || !Number.isInteger(ix.programIdIndex) || !keys[ix.programIdIndex]) fail('Malformed compiled instruction. Use RPC encoding json.');
  if (!Array.isArray(ix.accounts) || ix.accounts.some(i => !Number.isInteger(i) || !keys[i])) fail('Unresolved instruction account.');
  if (keys[ix.programIdIndex] !== SYSTEM) return null;
  if (typeof ix.data !== 'string' || ix.data.length > 2000) return null;
  let bytes;
  try { bytes = decodeBase58(ix.data); } catch { return null; }
  const disc = bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) : -1;
  if (!((disc === 2 && bytes.length === 12 && ix.accounts.length === 2) || (disc === 0 && bytes.length === 52 && ix.accounts.length === 2))) return null;
  const decoded = systemDecoder.decode({ programId:SYSTEM, accounts:ix.accounts.map(i => ({pubkey:keys[i]})), data:bytes });
  if (!decoded.decoded) return null;
  return { from:keys[ix.accounts[0]], to:keys[ix.accounts[1]], lamports:integer(decoded.args.lamports), category:disc === 0 ? 'account_funding' : 'native_transfer' };
}
export function makeReceipt(input, wallet) {
  address(wallet);
  if (!input || typeof input !== 'object') fail('Missing transaction result.');
  if (Object.hasOwn(input, 'error')) fail('RPC returned an error. Provider details were omitted.');
  const tx = Object.hasOwn(input, 'result') ? input.result : input;
  if (!tx || typeof tx !== 'object') fail('Transaction not found or unavailable at the requested commitment.');
  const meta = tx.meta, message = tx.transaction?.message;
  if (!meta || !Object.hasOwn(meta,'err') || !message || !Array.isArray(message.accountKeys) || !Array.isArray(message.instructions)) fail('Need a confirmed getTransaction result with encoding json and metadata.');
  if (tx.version !== undefined && tx.version !== 'legacy' && tx.version !== 0) fail('Unsupported transaction version.');
  const loaded = meta.loadedAddresses;
  const lookups = message.addressTableLookups;
  if (lookups?.length && (!loaded || !Array.isArray(loaded.writable) || !Array.isArray(loaded.readonly))) fail('Address lookup accounts are missing.');
  const keys = [...message.accountKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])].map(address);
  if (!keys.length || keys.length > 256 || new Set(keys).size !== keys.length) fail('Missing or duplicate account keys, or unsupported account count.');
  const w = keys.indexOf(wallet);
  if (w < 0) fail('Wallet is not an account in this transaction.');
  if (!Array.isArray(meta.preBalances) || !Array.isArray(meta.postBalances) || meta.preBalances.length !== keys.length || meta.postBalances.length !== keys.length) fail('Account balance coverage is incomplete.');
  const before = meta.preBalances.map(integer), after = meta.postBalances.map(integer);
  const fee = integer(meta.fee), sig = signature(tx.transaction.signatures?.[0]);
  const slot = integer(tx.slot).toString();
  const succeeded = meta.err === null;
  const journal = [];
  if (w === 0) journal.push({category:'network_fee', walletLamportsDelta:(-fee).toString()});
  let unsupported = 0, observed = 0;
  const innerKnown = Array.isArray(meta.innerInstructions);
  const groups = new Map();
  for (const group of meta.innerInstructions ?? []) {
    if (!Number.isInteger(group.index) || group.index < 0 || group.index >= message.instructions.length || !Array.isArray(group.instructions) || groups.has(group.index)) fail('Malformed inner instruction coverage.');
    groups.set(group.index, group.instructions);
  }
  if (message.instructions.length + [...groups.values()].reduce((n,g)=>n+g.length,0) > 10000) fail('Instruction count exceeds preview limits.');
  if (succeeded) for (let i=0; i<message.instructions.length; i++) {
    for (const ix of [message.instructions[i], ...(groups.get(i) ?? [])]) {
      const flow = nativeFlow(ix,keys);
      if (!flow) {
        let computeSetting=false;
        if (keys[ix.programIdIndex] === COMPUTE && ix.accounts.length === 0 && typeof ix.data === 'string' && ix.data.length < 30) {
          try { const data=decodeBase58(ix.data);computeSetting=([1,2,4].includes(data[0]) && data.length===5) || (data[0]===3 && data.length===9); } catch {}
        }
        if (!computeSetting) unsupported++; continue;
      }
      observed++;
      const delta = (flow.to === wallet ? flow.lamports : 0n) - (flow.from === wallet ? flow.lamports : 0n);
      if (flow.from === wallet || flow.to === wallet) journal.push({category:flow.category,from:flow.from,to:flow.to,lamports:flow.lamports.toString(),walletLamportsDelta:delta.toString()});
    }
  }
  const delta = after[w]-before[w], explained = journal.reduce((n,j)=>n+BigInt(j.walletLamportsDelta),0n);
  const residual = delta-explained;
  const tokens = new Map(); let unattributedTokenEntries=0;
  const tokenMetadataPresent = Array.isArray(meta.preTokenBalances) && Array.isArray(meta.postTokenBalances);
  for (const [side, rows] of [['pre',meta.preTokenBalances],['post',meta.postTokenBalances]]) {
    for (const row of rows ?? []) {
      if (!Number.isInteger(row.accountIndex) || !keys[row.accountIndex]) fail('Unresolved token account.');
      if (!row.owner) unattributedTokenEntries++;
      if (row.owner !== wallet) continue;
      const mint = address(row.mint), decimals=row.uiTokenAmount?.decimals;
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) fail('Invalid token decimals.');
      const key=`${row.accountIndex}:${mint}`;
      const record=tokens.get(key) ?? {account:keys[row.accountIndex],mint,decimals,pre:0n,post:0n};
      if (record.decimals !== decimals || record[side+'Seen']) fail('Conflicting token metadata.');
      record[side]=integer(row.uiTokenAmount.amount); record[side+'Seen']=true; tokens.set(key,record);
    }
  }
  return {
    schemaVersion:1, tool:'Positano transaction receipt preview', wallet, signature:sig, slot,
    source:{kind:'supplied_rpc_snapshot',independentlyVerified:false}, status:succeeded?'succeeded':'failed',
    native:{beforeLamports:before[w].toString(),afterLamports:after[w].toString(),deltaLamports:delta.toString(),transactionFeeLamports:fee.toString(),walletFeeLamports:(w===0?fee:0n).toString(),feePayer:keys[0],journal,unexplainedLamports:residual.toString()},
    tokens:[...tokens.values()].map(t=>({account:t.account,mint:t.mint,decimals:t.decimals,beforeRaw:Array.isArray(meta.preTokenBalances)?t.pre.toString():null,afterRaw:Array.isArray(meta.postTokenBalances)?t.post.toString():null,deltaRaw:tokenMetadataPresent && !unattributedTokenEntries ? (t.post-t.pre).toString() : null})),
    coverage:{native:residual===0n?'balance_reconciled':'unexplained_balance_change',instructionAttribution:unsupported||!innerKnown?'partial':'supported_layouts_only',observedNativeInstructions:observed,unsupportedInstructions:unsupported,innerInstructions:innerKnown?'supplied':'missing',tokenMetadata:tokenMetadataPresent?'supplied':'missing',unattributedTokenEntries},
    limits:[
      'A single transaction receipt is not trading PnL or a safety verdict.',
      'Network fee includes any priority fee; compute budget settings are not an extra charge.',
      'Native transfers are not automatically tips, swap principal, or protocol fees.',
      'Account funding may include a recoverable rent reserve and other funds; it is not all a fee.',
      'Token deltas use supplied owner metadata and do not establish a trade or valuation.',
      'Close-account refunds, wrapped SOL movements, and unsupported program effects remain unexplained unless reflected in supported transfers.',
      'Zero unexplained balance does not prove complete attribution. Missing instructions may hide offsetting flows.',
      'The supplied RPC snapshot is not independently verified; confirmation and network are not proven by this file.'
    ]
  };
}
