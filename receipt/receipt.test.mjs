import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRpcJson,makeReceipt,sol,address,LIMIT } from './core.mjs';
import { receiptHtml,escapeHtml } from './report.mjs';
import { fetchTransaction,run } from './cli.mjs';
import { fixture,WALLET,OTHER,MINT,SIG,transfer } from './fixtures.mjs';
import { encodeBase58,decodeBase58 } from './vendor/decoders.mjs';
import { createHash } from 'node:crypto';
const receipt=f=>makeReceipt(f,WALLET);
test('native send reconciles once including network fee',()=>{
  const r=receipt(fixture()); assert.equal(r.native.deltaLamports,'-100005000'); assert.equal(r.native.unexplainedLamports,'0'); assert.equal(r.native.journal.length,2);
});
test('receive does not allocate another wallet fee',()=>{
  const r=makeReceipt(fixture(),OTHER); assert.equal(r.native.walletFeeLamports,'0'); assert.equal(r.native.deltaLamports,'100000000'); assert.equal(r.native.unexplainedLamports,'0');
});
test('failed transaction ignores attempted native transfers',()=>{
  const f=fixture(); f.result.meta.err={InstructionError:[0,'Custom']}; f.result.meta.postBalances=[999995000,0,1];
  const r=receipt(f); assert.equal(r.status,'failed'); assert.equal(r.native.journal.length,1); assert.equal(r.native.unexplainedLamports,'0');
});
test('priority fee is not counted twice',()=>{
  const f=fixture(); f.result.transaction.message.accountKeys.push('ComputeBudget111111111111111111111111111111'); f.result.meta.preBalances.push(1);f.result.meta.postBalances.push(1);
  f.result.transaction.message.instructions.unshift({programIdIndex:3,accounts:[],data:'1'});
  f.result.meta.fee=15000;f.result.meta.postBalances[0]-=10000;
  assert.equal(receipt(f).native.unexplainedLamports,'0');assert.equal(receipt(f).native.walletFeeLamports,'15000');
});
test('unknown program leaves residual instead of invented fee',()=>{
  const f=fixture();f.result.transaction.message.instructions[0].programIdIndex=1;
  const r=receipt(f);assert.equal(r.native.unexplainedLamports,'-100000000');assert.equal(r.coverage.instructionAttribution,'partial');
});
test('CPI transfer is counted exactly once',()=>{
  const f=fixture();f.result.transaction.message.instructions=[{programIdIndex:1,accounts:[0,1],data:'1'}];f.result.meta.innerInstructions=[{index:0,instructions:[transfer()]}];
  assert.equal(receipt(f).native.unexplainedLamports,'0');assert.equal(receipt(f).coverage.instructionAttribution,'partial');
});
test('missing inner instruction recording stays partial',()=>{
  const f=fixture();delete f.result.meta.innerInstructions;assert.equal(receipt(f).coverage.innerInstructions,'missing');assert.equal(receipt(f).coverage.instructionAttribution,'partial');
});
test('trailing bytes are not accepted as a supported transfer',()=>{
  const f=fixture();const bytes=decodeBase58(f.result.transaction.message.instructions[0].data);f.result.transaction.message.instructions[0].data=encodeBase58(new Uint8Array([...bytes,0]));assert.equal(receipt(f).native.unexplainedLamports,'-100000000');
});
test('account creation is account funding, not a rent fee',()=>{
  const f=fixture(),bytes=new Uint8Array(52),v=new DataView(bytes.buffer);v.setBigUint64(4,100000000n,true);v.setBigUint64(12,165n,true);
  f.result.transaction.message.instructions[0].data=encodeBase58(bytes);
  assert.equal(receipt(f).native.journal[1].category,'account_funding');assert.equal(receipt(f).native.unexplainedLamports,'0');
});
test('unmodeled close-account refund stays unexplained',()=>{
  const f=fixture();f.result.transaction.message.instructions=[{programIdIndex:1,accounts:[1,0],data:'A'}];f.result.meta.postBalances=[1002034280,0,1];
  assert.equal(receipt(f).native.unexplainedLamports,'2039280');
});
test('v0 loaded accounts resolve in writable then readonly order',()=>{
  const f=fixture();f.result.version=0;f.result.transaction.message.accountKeys=[WALLET,'11111111111111111111111111111111'];f.result.transaction.message.addressTableLookups=[{}];f.result.meta.loadedAddresses={writable:[OTHER],readonly:[]};
  f.result.meta.preBalances=[1000000000,1,0];f.result.meta.postBalances=[899995000,1,100000000];f.result.transaction.message.instructions=[{...transfer(),programIdIndex:1,accounts:[0,2]}];assert.equal(receipt(f).native.unexplainedLamports,'0');
});
test('unresolved LUT is rejected',()=>{
  const f=fixture();f.result.transaction.message.addressTableLookups=[{}];assert.throws(()=>receipt(f),/lookup/);
});
test('unsafe native numbers are rejected',()=>{
  const f=fixture();f.result.meta.preBalances[1]=9007199254740992;assert.throws(()=>receipt(f),/imprecise/);
});
test('large RPC integers remain exact through parse and journal',()=>{
  const text=JSON.stringify(fixture()).replace('"preBalances":[1000000000,0,1]','"preBalances":[1000000000,9007199254740993,1]').replace('"postBalances":[899995000,100000000,1]','"postBalances":[899995000,9007199354740993,1]');
  const f=parseRpcJson(text);assert.equal(f.result.meta.preBalances[1],'9007199254740993');assert.equal(receipt(f).native.unexplainedLamports,'0');
});
test('token values use raw integers and owner metadata',()=>{
  const f=fixture();f.result.meta.postTokenBalances=[{accountIndex:1,mint:MINT,owner:WALLET,uiTokenAmount:{amount:'9007199254740993123',decimals:6}}];
  assert.equal(receipt(f).tokens[0].deltaRaw,'9007199254740993123');assert.equal(receipt(f).tokens[0].decimals,6);
});
test('other owners are not attributed to focused wallet',()=>{
  const f=fixture();f.result.meta.postTokenBalances=[{accountIndex:1,mint:MINT,owner:OTHER,uiTokenAmount:{amount:'42',decimals:6}}];assert.deepEqual(receipt(f).tokens,[]);
});
test('missing token metadata is explicit',()=>{const f=fixture();delete f.result.meta.preTokenBalances;assert.equal(receipt(f).coverage.tokenMetadata,'missing');});
test('incomplete token sides cannot invent a zero starting balance',()=>{const f=fixture();delete f.result.meta.preTokenBalances;f.result.meta.postTokenBalances=[{accountIndex:1,mint:MINT,owner:WALLET,uiTokenAmount:{amount:'42',decimals:6}}];const r=receipt(f);assert.equal(r.tokens[0].deltaRaw,null);assert.equal(r.tokens[0].beforeRaw,null);});
test('unattributed token owner prevents a precise delta claim',()=>{const f=fixture();f.result.meta.preTokenBalances=[{accountIndex:1,mint:MINT,uiTokenAmount:{amount:'40',decimals:6}}];f.result.meta.postTokenBalances=[{accountIndex:1,mint:MINT,owner:WALLET,uiTokenAmount:{amount:'42',decimals:6}}];const r=receipt(f);assert.equal(r.tokens[0].deltaRaw,null);assert.equal(r.coverage.unattributedTokenEntries,1);});
test('duplicate inner groups are rejected',()=>{const f=fixture();f.result.meta.innerInstructions=[{index:0,instructions:[]},{index:0,instructions:[]}];assert.throws(()=>receipt(f),/inner/);});
test('incomplete balances rejected',()=>{const f=fixture();f.result.meta.postBalances.pop();assert.throws(()=>receipt(f),/coverage/);});
test('unknown wallet rejected',()=>{assert.throws(()=>makeReceipt(fixture(),MINT),/not an account/);});
test('parsed instruction response rejected clearly',()=>{const f=fixture();f.result.transaction.message.instructions=[{parsed:{}}];assert.throws(()=>receipt(f),/encoding json/);});
test('invalid public address rejected',()=>assert.throws(()=>address('secret is not an address'),/Invalid/));
test('null result is not a successful receipt',()=>assert.throws(()=>receipt({result:null}),/not found/));
test('RPC errors do not echo provider payload',()=>assert.throws(()=>receipt({error:{message:'sensitive-provider-value'}}),e=>!e.message.includes('sensitive-provider-value')));
test('decimal SOL formatting never uses floating point',()=>{assert.equal(sol('-1'),'-0.000000001');assert.equal(sol('9007199254740993'),'9007199.254740993');});
test('malformed and oversized JSON rejected',()=>{assert.throws(()=>parseRpcJson('{'),/valid JSON/);assert.throws(()=>parseRpcJson(' '.repeat(LIMIT+1)),/5 MB/);});
test('HTML escaping and scriptless report CSP',()=>{assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');const r=receipt(fixture());r.limits.push('<img src=x onerror=alert(1)>');const html=receiptHtml(r);assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script'));assert.ok(html.includes("default-src 'none'"));});
test('RPC request uses json encoding, checks signature, and hides errors',async()=>{
  let request;await fetchTransaction(SIG,'https://example.invalid/rpc?key=sensitive',async(_url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify(fixture()));});
  assert.equal(request.params[1].encoding,'json');assert.equal(request.params[1].commitment,'confirmed');
  await assert.rejects(fetchTransaction(SIG,'https://example.invalid',async()=>{throw Error('sensitive') }),e=>!e.message.includes('sensitive'));
});
test('RPC refuses insecure remote endpoints and redirects',async()=>{
  await assert.rejects(fetchTransaction(SIG,'http://example.invalid'),/HTTPS/);
  await assert.rejects(fetchTransaction(SIG,'https://example.invalid',async(_url,o)=>{assert.equal(o.redirect,'error');return new Response('bad',{status:302});}),/failed/);
});
test('RPC response signature must match requested transaction',async()=>{
  const f=fixture();f.result.transaction.signatures[0]=encodeBase58(new Uint8Array(64).fill(2));await assert.rejects(fetchTransaction(SIG,'https://example.invalid',async()=>new Response(JSON.stringify(f))),/failed/);
});
test('RPC streamed response is capped even without content length',async()=>{
  await assert.rejects(fetchTransaction(SIG,'https://example.invalid',async()=>new Response(' '.repeat(LIMIT+1))),/failed/);
});
test('projection omits provider URLs, logs, memos, and raw errors',()=>{
  const f=fixture();f.result.meta.logMessages=['sensitive-provider-value'];f.result.debug='sensitive-provider-value';const text=JSON.stringify(receipt(f));assert.ok(!text.includes('sensitive-provider-value'));
});
test('built viewer script matches its CSP and has no external assets',async()=>{
  const html=await readFile(new URL('./viewer.html',import.meta.url),'utf8');const script=html.match(/<script>([\s\S]*)<\/script>/)[1];const hash=createHash('sha256').update(script).digest('base64');assert.ok(html.includes(`script-src 'sha256-${hash}'`));assert.ok(!/<(?:script|link|img)[^>]+(?:src|href)=/i.test(html));assert.ok(html.includes("connect-src 'none'"));
});
test('vendored bundle matches checked-in provenance hash',async()=>{
  const provenance=JSON.parse(await readFile(new URL('./vendor/provenance.json',import.meta.url),'utf8'));const bytes=await readFile(new URL('./vendor/decoders.mjs',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),provenance.sha256);
});
test('CLI writes both portable formats and refuses existing output',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'positano-receipt-'));try{
    const file=join(dir,'input.json'),out=join(dir,'receipt');await writeFile(file,JSON.stringify(fixture()));
    await run(['--wallet',WALLET,'--file',file,'--out',out]);assert.equal(JSON.parse(await readFile(out+'.json','utf8')).native.unexplainedLamports,'0');
    await assert.rejects(run(['--wallet',WALLET,'--file',file,'--out',out]),/exists/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
