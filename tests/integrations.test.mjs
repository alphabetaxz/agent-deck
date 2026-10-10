import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {IntegrationManager,enableFeature,restoreFeature} from '../core/integrations.mjs';
const root=resolve('.');
async function fixture(t){const home=mkdtempSync(join(tmpdir(),'deck-install-'));t.after(()=>rmSync(home,{recursive:true,force:true}));const manager=new IntegrationManager({root,home,dataDir:join(home,"data with ' quote"),env:{},probe:async()=>({available:true,found:true,version:'test'})});await manager.refresh();return manager;}
function write(path,text){mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,text);}
test('Claude install is idempotent, binds data directory, preserves other hooks and removes only owned hooks',async t=>{
 const m=await fixture(t);write(m.paths.claude,JSON.stringify({custom:{keep:true},hooks:{Stop:[{matcher:'',hooks:[{type:'command',command:'other-hook'}]}]}}));
 await m.change('claude','install');await m.change('claude','install');let config=JSON.parse(readFileSync(m.paths.claude));assert.deepEqual(config.custom,{keep:true});assert.equal(config.hooks.Stop.length,2);assert.match(m.manifest('claude').command,/--data/);assert.equal(m.status()[0].state,'configured');m.recordEvent('claude');assert.equal(m.status()[0].state,'connected');
 await m.change('claude','remove');config=JSON.parse(readFileSync(m.paths.claude));assert.equal(config.hooks.Stop.length,1);assert.equal(config.hooks.Stop[0].hooks[0].command,'other-hook');assert.equal(m.status()[0].hasConfig,false);assert.ok(existsSync(join(m.dataDir,'backups')));
});
test('pi auto-discovery install embeds location; modified extensions are preserved',async t=>{
 const m=await fixture(t);await m.change('pi','install');const original=readFileSync(m.paths.pi,'utf8');assert.ok(original.includes(JSON.stringify(m.dataDir)));assert.equal(m.status().find(x=>x.source==='pi').installed,true);await m.change('pi','install');assert.equal(readFileSync(m.paths.pi,'utf8'),original);
 write(m.paths.pi,original+'\n// user edit');await assert.rejects(m.change('pi','remove'),/已被修改/);await assert.rejects(m.change('pi','install'),/已保留/);assert.ok(readFileSync(m.paths.pi,'utf8').endsWith('// user edit'));
});
test('Codex enables hooks preserving TOML and restores owned feature change',async t=>{
 const m=await fixture(t);const before='model = "custom"\n[features]\nhooks = false # my choice\nother = true\n';write(m.codexConfig,before);write(m.paths.codex,'{"custom":true}');await m.change('codex','install');await m.change('codex','install');assert.match(readFileSync(m.codexConfig,'utf8'),/hooks = true/);await m.change('codex','remove');assert.equal(readFileSync(m.codexConfig,'utf8'),before);assert.equal(JSON.parse(readFileSync(m.paths.codex)).custom,true);
});
test('invalid configs and symbolic links are not overwritten',async t=>{
 const m=await fixture(t);write(m.paths.claude,'{invalid');await assert.rejects(m.change('claude','install'),/有效 JSON/);assert.equal(readFileSync(m.paths.claude,'utf8'),'{invalid');assert.equal(existsSync(m.manifestPath('claude')),false);rmSync(m.paths.claude);const target=join(m.home,'target');write(target,'{}');symlinkSync(target,m.paths.claude);await assert.rejects(m.change('claude','install'),/符号链接/);assert.equal(readFileSync(target,'utf8'),'{}');
});
test('unavailable tools cannot be installed',async t=>{const m=await fixture(t);m.probe=async()=>({available:false,reason:'broken'});await assert.rejects(m.change('codex','install'),/broken/);assert.equal(existsSync(m.paths.codex),false);});
test('TOML feature edits reject ambiguous encodings and preserve user changes on remove',()=>{
 assert.throws(()=>enableFeature('[features]\nhooks = true\nhooks = false','hooks'),/重复/);assert.throws(()=>enableFeature('features = { hooks = false }','hooks'),/暂不支持/);const p=enableFeature('[features]\nhooks = false\n','hooks');assert.equal(restoreFeature(p.text.replace('hooks = true','hooks = false # later'),p),'[features]\nhooks = false # later\n');
});
test('pi migrates an unchanged generated extension from another installation with a backup',async t=>{
 const old=await fixture(t);await old.change('pi','install');const previous=readFileSync(old.paths.pi,'utf8');
 const next=new IntegrationManager({root,home:old.home,dataDir:join(old.home,'formal-data'),env:{},probe:old.probe});await next.refresh();
 assert.equal(next.status().find(x=>x.source==='pi').needsRepair,true);
 await next.change('pi','install');assert.ok(readFileSync(next.paths.pi,'utf8').includes(JSON.stringify(next.dataDir)));
 assert.equal(next.status().find(x=>x.source==='pi').installed,true);
 const {readdirSync}=await import('node:fs');const backups=join(next.dataDir,'backups');const backup=readdirSync(backups)[0];assert.equal(readFileSync(join(backups,backup,'pi','pi-extension.ts'),'utf8'),previous);
 await next.change('pi','install');await next.change('pi','remove');assert.equal(existsSync(next.paths.pi),false);
});
test('pi preserves foreign or edited extensions when installation records are missing',async t=>{
 const old=await fixture(t);await old.change('pi','install');const previous=readFileSync(old.paths.pi,'utf8');
 const next=new IntegrationManager({root,home:old.home,dataDir:join(old.home,'formal-data'),env:{},probe:old.probe});await next.refresh();
 for(const text of [previous+'\n// my custom changes','// Agent Deck\nexport default function(){}']){
  write(next.paths.pi,text);await assert.rejects(next.change('pi','install'),/已保留/);assert.equal(readFileSync(next.paths.pi,'utf8'),text);assert.equal(existsSync(next.manifestPath('pi')),false);
 }
});
