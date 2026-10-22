#!/usr/bin/env node
import { readFile, writeFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { LIMIT, ReceiptError, address, signature, parseRpcJson, makeReceipt } from './core.mjs';
import { receiptHtml } from './report.mjs';

export async function fetchTransaction(sig, endpoint, fetcher=fetch) {
  signature(sig);
  let url;
  try { url=new URL(endpoint); } catch { throw new ReceiptError('Invalid RPC endpoint.'); }
  if (url.protocol !== 'https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new ReceiptError('RPC requires HTTPS or local loopback HTTP.');
  try {
    const response=await fetcher(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',params:[sig,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]}),signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error();
    if (Number(response.headers.get('content-length'))>LIMIT) throw new Error();
    const reader=response.body.getReader(); const chunks=[]; let size=0;
    while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>LIMIT) { await reader.cancel(); throw new Error(); } chunks.push(value); }
    const bytes=new Uint8Array(size); let p=0; for(const chunk of chunks){bytes.set(chunk,p);p+=chunk.length;}
    const input=parseRpcJson(new TextDecoder().decode(bytes));
    if (input.error) throw new Error();
    if (input.result && input.result.transaction?.signatures?.[0]!==sig) throw new Error();
    return input;
  } catch { throw new ReceiptError('RPC request failed or returned unusable data. Endpoint and provider details were omitted.'); }
}
export async function run(args) {
  const options={};
  for(let i=0;i<args.length;i+=2) {
    if (!['--wallet','--file','--signature','--out'].includes(args[i]) || !args[i+1] || Object.hasOwn(options,args[i])) throw new ReceiptError('Usage: node receipt/cli.mjs --wallet ADDRESS (--file RPC.json | --signature SIGNATURE) [--out NEW_PREFIX]');
    options[args[i]]=args[i+1];
  }
  address(options['--wallet']);
  if (!!options['--file'] === !!options['--signature']) throw new ReceiptError('Choose exactly one of --file or --signature.');
  let input;
  if(options['--file']) {
    if((await stat(options['--file'])).size>LIMIT) throw new ReceiptError('Input exceeds the 5 MB limit.');
    input=parseRpcJson(await readFile(options['--file'],'utf8'));
  } else input=await fetchTransaction(options['--signature'],process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
  const receipt=makeReceipt(input,options['--wallet']);
  if(options['--signature']) receipt.source={kind:'live_rpc_response',commitmentRequested:'confirmed',independentlyVerified:false};
  const json=JSON.stringify(receipt,null,2)+'\n';
  if(options['--out']) {
    const prefix=options['--out'];
    for(const extension of ['.json','.html']) {
      try { await stat(prefix+extension); throw new ReceiptError('Output exists. Choose a new prefix.'); } catch(e) { if(e.code!=='ENOENT') throw e; }
    }
    await writeFile(prefix+'.json',json,{flag:'wx'});
    await writeFile(prefix+'.html',receiptHtml(receipt),{flag:'wx'});
    return 'Saved JSON and offline HTML receipt.';
  }
  return json;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(await run(process.argv.slice(2))); }
  catch(error) { console.error(error instanceof ReceiptError ? error.message : 'Receipt could not be created. Check input file and output permissions.'); process.exitCode=1; }
}
