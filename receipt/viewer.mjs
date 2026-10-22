import { makeReceipt, parseRpcJson, sol, ReceiptError, LIMIT } from './core.mjs';
import { receiptHtml } from './report.mjs';
import { fixture, WALLET } from './fixtures.mjs';
const el=id=>document.getElementById(id);
let current;
function cell(row,value,tag='td') { const td=document.createElement(tag);td.textContent=value;row.append(td); }
function render(input,synthetic=false) {
  current=makeReceipt(input,el('wallet').value.trim());
  if(synthetic) { current.source.kind='synthetic_example'; current.limits.unshift('SYNTHETIC EXAMPLE: invented addresses and balances, not a real transaction.'); }
  el('example-label').hidden=!synthetic;
  el('delta').textContent=sol(current.native.deltaLamports)+' SOL';
  el('fee').textContent=sol(current.native.walletFeeLamports)+' SOL';
  el('unknown').textContent=sol(current.native.unexplainedLamports)+' SOL';
  el('coverage').textContent=`${current.status} · ${current.native.unexplainedLamports==='0'?'Wallet balance reconciled':'Unexplained wallet change'} · ${current.coverage.instructionAttribution==='partial'?'Some instructions unsupported':'Supported native layouts only'}`;
  el('identity').textContent=`Slot ${current.slot} / ${current.signature}`;
  el('flows').replaceChildren();
  for(const j of current.native.journal) { const tr=document.createElement('tr');cell(tr,j.category.replaceAll('_',' '));cell(tr,sol(j.walletLamportsDelta));cell(tr,j.to ?? 'Network fee payer charge');el('flows').append(tr); }
  el('tokens').replaceChildren();
  for(const t of current.tokens) { const tr=document.createElement('tr');cell(tr,t.mint);cell(tr,t.deltaRaw ?? 'Unknown: incomplete owner metadata');cell(tr,t.decimals);el('tokens').append(tr); }
  el('token-note').hidden=!!current.tokens.length;
  el('limits').replaceChildren();for(const text of current.limits) { const li=document.createElement('li');li.textContent=text;el('limits').append(li); }
  el('result').hidden=false;el('error').textContent='';
}
function error(e) { current=undefined;el('result').hidden=true;el('error').textContent=e instanceof ReceiptError ? e.message : 'Could not read this snapshot. Use an RPC getTransaction JSON response.'; }
el('inspect').addEventListener('click',async()=>{
  try {const file=el('snapshot').files[0];if(!file)throw new ReceiptError('Choose an RPC JSON file first.');if(file.size>LIMIT)throw new ReceiptError('Input exceeds the 5 MB limit.');render(parseRpcJson(await file.text()));}catch(e){error(e);}
});
el('demo').addEventListener('click',()=>{try{el('wallet').value=WALLET;render(fixture(),true);}catch(e){error(e);}});
function download(name,content,type) { const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
el('json').addEventListener('click',()=>{if(current)download('transaction-receipt.json',JSON.stringify(current,null,2)+'\n','application/json');});
el('html').addEventListener('click',()=>{if(current)download('transaction-receipt.html',receiptHtml(current),'text/html');});
