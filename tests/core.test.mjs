import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeck } from '../core/server.mjs';
import { validateCards,validateManifest } from '../core/protocol.mjs';
import { Store } from '../core/store.mjs';
import { PluginHost } from '../core/plugins.mjs';
import { spawn } from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,30));}throw new Error('Timed out');};
async function setup(t) {
  const dataDir=mkdtempSync(join(tmpdir(),'agent-deck-test-'));
  const deck=await createDeck({root,dataDir,port:0,devicePort:0,integrationOptions:{home:join(dataDir,"home"),env:{},probe:async()=>({available:true,found:true,version:"test"})}});
  t.after(async()=>{await deck.close();rmSync(dataDir,{recursive:true,force:true});});
  const base=deck.runtime.baseURL;
  const usedAdminURL=deck.runtime.adminURL;
  const auth=await fetch(usedAdminURL,{redirect:'manual'});const cookie=auth.headers.get('set-cookie').split(';')[0];
  const request=(path,data,extra={})=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:base,...(data===undefined?{}:{'Content-Type':'application/json'}),...extra},body:data===undefined?undefined:JSON.stringify(data)});
  const enable=async id=>{assert.equal((await request('/api/plugins',{id,enabled:true})).status,200);await until(()=>deck.plugins.get(id).status==='running');};
  return {deck,request,enable,base,dataDir,cookie,usedAdminURL};
}
test('unauthenticated access, CSRF, and one-time admin login are rejected',async t=> {
  const {deck,request,base,dataDir,usedAdminURL}=await setup(t);
  assert.equal((await fetch(base+'/api/snapshot')).status,401);
  assert.equal((await fetch(usedAdminURL,{redirect:'manual'})).status,401);
  const refreshed=JSON.parse(readFileSync(join(dataDir,'runtime.json'),'utf8'));
  assert.notEqual(refreshed.adminURL,usedAdminURL);
  assert.equal((await fetch(refreshed.adminURL,{redirect:'manual'})).status,303);
  assert.equal((await request('/api/plugins',{id:'todo',enabled:true},{Origin:'https://other.example'})).status,403);
});
test('todo actions persist and errors do not crash the plugin',async t=> {
  const {deck,request,enable}=await setup(t);await enable('todo');
  assert.equal((await request('/api/actions',{pluginId:'todo',action:'add',params:{title:'交付首版'}})).status,200);
  const card=deck.plugins.cards().find(c=>c.pluginId==='todo');assert.equal(card.items[0].title,'交付首版');
  await request('/api/actions',{pluginId:'todo',action:'toggle',params:{id:card.items[0].id}});
  assert.equal(deck.store.get('todo','state').items[0].done,true);
  assert.equal((await request('/api/actions',{pluginId:'todo',action:'add',params:{title:''}})).status,400);
  assert.equal(deck.plugins.get('todo').status,'running');
  await request('/api/plugins',{id:'todo',enabled:false});await until(()=>!deck.plugins.get('todo').child);await enable('todo');
  await until(()=>deck.plugins.cards().find(c=>c.pluginId==='todo')?.items.length===1);
  assert.equal(deck.plugins.cards().find(c=>c.pluginId==='todo').items[0].done,true);
});
test('paired phone sees cards only, cannot manage, and revocation closes access',async t=> {
  const {deck,request,enable,base}=await setup(t);await enable('clock');await until(()=>deck.plugins.cards().length===1);
  const pair=await (await request('/api/pair/create',{})).json();
  const response=await fetch(base+'/api/pair',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({code:pair.code,name:'旧手机'})});
  assert.equal(response.status,200);const device=await response.json();const deviceCookie=response.headers.get('set-cookie').split(';')[0];
  const snapshot=await (await fetch(base+'/api/snapshot',{headers:{Cookie:deviceCookie}})).json();
  assert.equal(snapshot.plugins,undefined);assert.equal(snapshot.devices,undefined);assert.equal(snapshot.cards.length,1);
  assert.equal((await fetch(base+'/api/actions',{method:'POST',headers:{Cookie:deviceCookie,Origin:base},body:'{}'})).status,403);
  await request('/api/layout',{deviceId:device.id,hidden:['clock']});
  assert.equal((await (await fetch(base+'/api/snapshot',{headers:{Cookie:deviceCookie}})).json()).cards.length,0);
  await request('/api/devices/revoke',{id:device.id});
  assert.equal((await fetch(base+'/api/snapshot',{headers:{Cookie:deviceCookie}})).status,401);
});
test('pair codes are single-use and brute-force attempts are limited',async t=> {
  const {request,base}=await setup(t);const pair=await (await request('/api/pair/create',{})).json();
  const pairRequest=code=>fetch(base+'/api/pair',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({code})});
  assert.equal((await pairRequest(pair.code)).status,200);assert.equal((await pairRequest(pair.code)).status,401);
  for(let i=0;i<9;i++)await pairRequest('00000000');
  assert.equal((await pairRequest('00000000')).status,429);
});
test('hooks require a separate credential and accept real event schema',async t=> {
  const {deck,base,enable,request}=await setup(t);await enable('agents');
  const data={source:'claude',session_id:'test',hook_event_name:'UserPromptSubmit',prompt:'修复登录',cwd:'/code/demo'};
  assert.equal((await request('/api/hooks',data)).status,401);
  const response=await fetch(base+'/api/hooks',{method:'POST',headers:{Authorization:'Bearer '+deck.runtime.hookToken,'Content-Type':'application/json'},body:JSON.stringify(data)});
  assert.equal(response.status,200);assert.equal(deck.plugins.cards()[0].status,'running');
});
test('stream starts with a full snapshot so reconnect never requires missed events',async t=> {
  const {request}=await setup(t);const controller=new AbortController();
  const response=await request('/api/events');
  const reader=response.body.getReader();const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/event: snapshot/);await reader.cancel();controller.abort();
});
test('preview layout never removes todo data from management snapshot',async t=> {
  const {request,enable}=await setup(t);await enable('todo');await request('/api/layout',{deviceId:'preview',hidden:['todo']});
  const state=await (await request('/api/snapshot')).json();assert.equal(state.cards.length,0);assert.equal(state.allCards[0].pluginId,'todo');
});
test('LAN binding refuses unencrypted service',async()=> {
  await assert.rejects(createDeck({root,dataDir:'/tmp/unused-agent-deck',host:'0.0.0.0',port:0}),/requires TLS/);
});
test('invalid API versions and card payloads fail validation',()=> {
  assert.throws(()=>validateManifest({id:'bad',name:'bad',version:'1',apiVersion:99}),/version/);
  assert.throws(()=>validateCards([{id:'x',title:'x',type:'status',status:'fake',summary:'x',updatedAt:1}],{cardTypes:['status']}),/status/);
});
test('plugin crash retains last data, bounded restarts, and can be disabled',async t=> {
  const directory=mkdtempSync(join(tmpdir(),'agent-deck-host-'));const plugins=join(directory,'plugins');mkdirSync(join(plugins,'broken'),{recursive:true});
  writeFileSync(join(plugins,'broken','plugin.json'),JSON.stringify({id:'broken',name:'Broken',version:'1',apiVersion:1,entrypoint:'index.mjs',cardTypes:['text'],permissions:[]}));
  writeFileSync(join(plugins,'broken','index.mjs'),`process.stdin.once('data',()=>{console.log(JSON.stringify({type:'ready',id:'broken',apiVersion:1}));console.log(JSON.stringify({type:'cards',cards:[{id:'x',title:'x',type:'text',text:'last data',updatedAt:1}]}));setTimeout(()=>process.exit(1),50);});`);
  const store=new Store(join(directory,'test.sqlite'));const host=new PluginHost(plugins,store,()=>{});
  t.after(async()=>{await host.close();store.close();rmSync(directory,{recursive:true,force:true});});
  await host.configure('broken',{enabled:true});await until(()=>host.get('broken').status==='error');
  assert.equal(host.cards()[0].text,'last data');assert.equal(host.cards()[0].pluginStatus,'error');
  await host.configure('broken',{enabled:false});assert.equal(host.cards().length,0);
});

function runHook(dataDir,payload) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[join(root,'integrations/hook.mjs'),'claude'],{env:{...process.env,AGENT_DECK_DATA:dataDir},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));child.stdin.end(JSON.stringify(payload));
  });
}
test('hook helper is observation-only and fails open when service is absent',async t=> {
  const data=mkdtempSync(join(tmpdir(),'agent-deck-hook-'));t.after(()=>rmSync(data,{recursive:true,force:true}));
  assert.deepEqual(await runHook(data,{hook_event_name:'Stop'}),{code:0,stdout:'',stderr:''});
});
test('actual hook CLI transports payload without emitting approval directives',async t=> {
  const {deck,dataDir,enable}=await setup(t);await enable('agents');
  const result=await runHook(dataDir,{session_id:'helper-session',hook_event_name:'PermissionRequest',cwd:'/code/helper'});
  assert.deepEqual(result,{code:0,stdout:'',stderr:''});assert.equal(deck.plugins.cards()[0].status,'waiting');
});

test('App installs hooks, auto-enables agent plugin, and installed helper works without environment setup',async t=> {
  const {deck,request,base,dataDir}=await setup(t);
  assert.equal((await request('/api/integrations',{source:'claude',action:'install'},{Origin:'https://other.example'})).status,403);
  assert.equal((await request('/api/integrations',{source:'claude',action:'install'})).status,200);
  await until(()=>deck.plugins.get('agents').status==='running');
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[join(dataDir,'integrations/hook.mjs'),'claude','--data',dataDir],{env:{...process.env,AGENT_DECK_DATA:'/wrong-directory'},stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>resolve({code,output}));child.stdin.end(JSON.stringify({hook_event_name:'SessionStart',session_id:'installed-helper-test',cwd:'/project'}));
  });
  assert.deepEqual(result,{code:0,output:''});const snapshot=await (await request('/api/snapshot')).json();assert.equal(snapshot.integrations.find(i=>i.source==='claude').state,'connected');assert.equal(JSON.stringify(snapshot).includes(deck.runtime.hookToken),false);
  const pair=await (await request('/api/pair/create',{})).json();const response=await fetch(base+'/api/pair',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({code:pair.code})});const cookie=response.headers.get('set-cookie').split(';')[0];
  const phone=await (await fetch(base+'/api/snapshot',{headers:{Cookie:cookie}})).json();assert.equal(phone.integrations,undefined);
  assert.equal((await fetch(base+'/api/integrations',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({source:'pi',action:'install'})})).status,403);
});

test('phone network advertises Mac IP and decodable QR, isolates management, and shuts down',async t=>{
 const {deck,request,base,cookie}=await setup(t);
 assert.equal((await request('/api/network',{enabled:true},{Origin:'https://other.example'})).status,403);
 const disabled=await (await request('/api/pair/create',{})).json();assert.equal(disabled.url,null);assert.equal(disabled.qr,null);
 assert.equal((await request('/api/network',{enabled:true})).status,200);
 const network=(await (await request('/api/snapshot')).json()).network;assert.ok(network.port);assert.ok(network.addresses.length);
 const pair=await (await request('/api/pair/create',{address:network.addresses[0].address})).json();assert.equal(new URL(pair.url).hostname,network.addresses[0].address);assert.notEqual(new URL(pair.url).hostname,'127.0.0.1');
 const {PNG}=await import('pngjs');const {default:jsQR}=await import('jsqr');const png=PNG.sync.read(Buffer.from(pair.qr.split(',')[1],'base64'));const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);assert.equal(decoded.data,pair.url+'#pair='+pair.code);
 const lan='http://127.0.0.1:'+network.port;
 assert.equal((await fetch(lan+'/admin',{headers:{Cookie:cookie}})).status,403);
 assert.equal((await fetch(lan+'/api/hooks',{method:'POST',headers:{Authorization:'Bearer '+deck.runtime.hookToken}})).status,403);
 assert.equal((await fetch(lan+'/api/snapshot',{headers:{Cookie:cookie}})).status,401);
 const response=await fetch(lan+'/api/pair',{method:'POST',headers:{Origin:lan,'Content-Type':'application/json'},body:JSON.stringify({code:pair.code,name:'QR test phone'})});assert.equal(response.status,200);const phoneCookie=response.headers.get('set-cookie').split(';')[0];
 for(const asset of ['/display','/display.js','/display-shared.js','/display.css'])assert.equal((await fetch(lan+asset)).status,200);
 const snapshot=await (await fetch(lan+'/api/snapshot',{headers:{Cookie:phoneCookie}})).json();assert.equal(snapshot.plugins,undefined);assert.equal(snapshot.integrations,undefined);
 assert.equal((await fetch(lan+'/api/network',{method:'POST',headers:{Cookie:phoneCookie,Origin:lan,'Content-Type':'application/json'},body:'{"enabled":false}'})).status,403);
 assert.equal((await request('/api/network',{enabled:false})).status,200);assert.equal((await (await request('/api/snapshot')).json()).network.enabled,false);await assert.rejects(fetch(lan+'/display'));
});

test('desktop integration runs without CLI and remove clears only desktop cards',async t=>{
 const {deck,request,enable,dataDir}=await setup(t);const {DatabaseSync}=await import('node:sqlite');const codex=join(dataDir,'home','.codex');mkdirSync(join(codex,'sessions'),{recursive:true});const path=join(codex,'sessions','desktop.jsonl');const now=new Date().toISOString();writeFileSync(path,JSON.stringify({type:'session_meta',timestamp:now,payload:{id:'desktop',originator:'Codex Desktop',source:'vscode'}})+'\n'+JSON.stringify({type:'event_msg',timestamp:now,payload:{type:'task_started',turn_id:'turn'}})+'\n');const db=new DatabaseSync(join(codex,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT,cwd TEXT,source TEXT,archived INTEGER,updated_at INTEGER)');db.prepare('INSERT INTO threads VALUES(?,?,?,?,0,?)').run('desktop',path,'/project','vscode',Math.floor(Date.now()/1000));db.close();deck.desktop.appPaths=[join(dataDir,'home')];
 assert.equal((await request('/api/integrations',{source:'codex-desktop',action:'install'})).status,200);await until(()=>deck.plugins.get('agents').status==='running');await deck.desktop.tick();await until(()=>deck.plugins.cards().some(c=>c.subtitle==='Codex'));const snapshot=await (await request('/api/snapshot')).json();assert.equal(snapshot.integrations.find(x=>x.source==='codex-desktop').state,'connected');
 await deck.plugins.request('agents','event',{source:'pi',session_id:'other',hook_event_name:'SessionStart'});assert.equal((await request('/api/integrations',{source:'codex-desktop',action:'remove'})).status,200);assert.equal(deck.plugins.cards().some(c=>c.subtitle==='Codex'),false);assert.equal(deck.plugins.cards().some(c=>c.subtitle==='pi'),true);
});
