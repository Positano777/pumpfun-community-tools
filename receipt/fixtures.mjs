import { encodeBase58 } from './vendor/decoders.mjs';
export const WALLET=encodeBase58(new Uint8Array(32).fill(2));
export const OTHER=encodeBase58(new Uint8Array(32).fill(3));
export const MINT=encodeBase58(new Uint8Array(32).fill(4));
export const SIG=encodeBase58(new Uint8Array(64).fill(1));
export function transfer(from=0,to=1,lamports=100000000n) {
  const bytes=new Uint8Array(12); const view=new DataView(bytes.buffer);
  view.setUint32(0,2,true); view.setBigUint64(4,lamports,true);
  return {programIdIndex:2,accounts:[from,to],data:encodeBase58(bytes)};
}
export function fixture() {
  return {jsonrpc:'2.0',id:1,result:{slot:100,version:'legacy',transaction:{signatures:[SIG],message:{accountKeys:[WALLET,OTHER,'11111111111111111111111111111111'],instructions:[transfer()]}},meta:{err:null,fee:5000,preBalances:[1000000000,0,1],postBalances:[899995000,100000000,1],innerInstructions:[],preTokenBalances:[],postTokenBalances:[]}}};
}
