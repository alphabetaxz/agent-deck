import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {JSDOM} from 'jsdom';
const source=file=>readFileSync(new URL('../web/'+file,import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t){
 const dom=new JSDOM(source('admin.html'),{url:'http://deck.test/admin',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window, calls=[],timeouts=new Map();let next=0,resolvePair,rejectPair;
 w.setTimeout=fn=>{timeouts.set(++next,fn);return next;};w.clearTimeout=id=>timeouts.delete(id);w.setInterval=()=>1;w.clearInterval=()=>{};
 w.EventSource=function(){this.addEventListener=this.close=()=>{};};
 const network={enabled:false,addresses:[{name:'en0',address:'192.0.2.10'}],encrypted:false};
 const snapshot={cards:[],allCards:[],displayPlugins:[],plugins:[],devices:[],layouts:{},integrations:[],network,sequence:1};
 w.fetch=async(path,options)=>{calls.push(path);let value;
 if(path==='/api/snapshot')value=snapshot;
 else if(path==='/api/network')value={...network,enabled:true};
 else if(path==='/api/pair/create')return new Promise((resolve,reject)=>{resolvePair=value=>resolve({ok:true,json:async()=>value});rejectPair=reject;options.signal.addEventListener('abort',()=>reject(new Error('aborted')));});
 else throw new Error('Unexpected request');
 return {ok:true,json:async()=>value};};
 w.eval(source('display-shared.js'));w.eval(source('app.js').replace("import {displayCards} from './display-model.mjs';","const displayCards=window.AgentDeckDisplayCards;"));await flush();
 return {w,calls,timeouts,resolvePair:value=>resolvePair(value),rejectPair:error=>rejectPair(error)};
}
test('one click enables phone connection, keeps busy state, then displays QR',async t=>{
 const f=await fixture(t), b=f.w.document.getElementById('pair-button');
 assert.equal(b.disabled,false);assert.match(b.textContent,/开启连接/);
 b.click();await flush();assert.equal(b.disabled,true);assert.match(b.textContent,/生成中/);
 assert.deepEqual(f.calls,['/api/snapshot','/api/network','/api/pair/create']);
 f.resolvePair({lan:true,qr:'data:image/png;base64,AA==',code:'12345678',url:'http://192.0.2.10:43121/display',expires:Date.now()+120000});await flush();
 assert.equal(b.disabled,false);assert.equal(f.w.document.querySelectorAll('#pair-info img').length,1);assert.match(f.w.document.getElementById('pair-info').textContent,/12345678/);
});
test('a stalled QR request times out and allows retry with an inline error',async t=>{
 const f=await fixture(t), b=f.w.document.getElementById('pair-button');b.click();await flush();
 assert.equal(f.timeouts.size,1);for(const callback of [...f.timeouts.values()])callback();await flush();
 assert.equal(b.disabled,false);assert.match(f.w.document.getElementById('pair-info').textContent,/请求超时/);
});
