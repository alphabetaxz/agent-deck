import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUsage,codexUsage,claudeUsage,claudeTranscriptTokens} from '../integrations/usage.mjs';
import {applyEvent,agentCards} from '../plugins/agents/state.mjs';
import {validateCards} from '../core/protocol.mjs';
const event=(name,extra={})=>({source:'claude',session_id:'usage',hook_event_name:name,timestamp:100,...extra});
test('usage is numeric, bounded and excludes secrets; missing values are not zero',()=>{
 const u=normalizeUsage({sessionTokens:-1,sessionCostUSD:Infinity,contextPercent:120,credential:'SECRET',windows:[{id:'primary',usedPercent:0,resetsAt:2000,windowMinutes:300},{id:'bad',usedPercent:101,resetsAt:2000}]},100);
 assert.deepEqual(u,{updatedAt:100,windows:[{id:'primary',usedPercent:0,resetsAt:2000,windowMinutes:300}]});
 assert.equal(JSON.stringify(u).includes('SECRET'),false);
});
test('Codex totals are cumulative and cache/reasoning are not added twice',()=>{
 const u=normalizeUsage(codexUsage({info:{total_token_usage:{total_tokens:25000,input_tokens:20000,cached_input_tokens:15000,output_tokens:5000,reasoning_output_tokens:2000},last_token_usage:{input_tokens:12000},model_context_window:200000},rate_limits:{primary:{used_percent:42,window_minutes:300,resets_at:300}}}),100);
 assert.equal(u.sessionTokens,25000);assert.equal(u.contextPercent,6);assert.equal(u.windows[0].resetsAt,300000);
});
test('Claude counts streamed response blocks once including cache tokens and preserves zero cost',()=>{
 const row=(id,usage)=>JSON.stringify({type:'assistant',message:{id,usage,content:'PRIVATE'}});
 const text=[row('a',{input_tokens:10,output_tokens:2,cache_read_input_tokens:30}),row('a',{input_tokens:10,output_tokens:5,cache_read_input_tokens:30}),'{invalid}',row('b',{input_tokens:7,cache_creation_input_tokens:3})].join('\n');
 assert.equal(claudeTranscriptTokens(text),55);assert.equal(claudeTranscriptTokens('{}'),undefined);
 const usage=normalizeUsage(claudeUsage({cost:{total_cost_usd:0},context_window:{total_input_tokens:99999,used_percentage:25},rate_limits:{five_hour:{used_percentage:0,resets_at:200}}},55),100);
 assert.equal(usage.sessionTokens,55);assert.equal(usage.sessionCostUSD,0);assert.equal(usage.sessionScope,'main');assert.equal(usage.windows[0].usedPercent,0);
});
test('usage events preserve waiting/completed state and ignore older usage snapshots',()=>{
 const sessions={};applyEvent(sessions,event('PermissionRequest'),100);
 applyEvent(sessions,event('Usage',{timestamp:200,usage:{sessionTokens:40,windows:[]}}),200);
 assert.equal(sessions['claude:usage'].status,'waiting');assert.equal(sessions['claude:usage'].updatedAt,100);
 applyEvent(sessions,event('Usage',{timestamp:150,usage:{sessionTokens:1,windows:[]}}),200);
 assert.equal(agentCards(sessions,200)[0].usage.sessionTokens,40);
 applyEvent(sessions,event('Stop',{timestamp:300}),300);
 applyEvent(sessions,event('Usage',{timestamp:400,usage:{sessionTokens:60,windows:[]}}),400);
 assert.equal(agentCards(sessions,400)[0].status,'completed');
 assert.throws(()=>validateCards([{...agentCards(sessions,400)[0],usage:{updatedAt:100,windows:[],sessionTokens:'bad'}}],{cardTypes:['status']}),/usage/);
});
test('Claude hook collects main-session tokens without emitting statusline output',async t=>{
 const {mkdtempSync,writeFileSync,copyFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {createServer}=await import('node:http');const {spawn}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'deck-statusline-'));const received=[];const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push(JSON.parse(body));res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
 for(const file of ['usage.mjs','hook.mjs'])copyFileSync(resolve('integrations',file),join(dir,file));
 writeFileSync(join(dir,'runtime.json'),JSON.stringify({hookURL:`http://127.0.0.1:${server.address().port}/api/hooks`,hookToken:'test-only'}));
 const transcript=join(dir,'session.jsonl');writeFileSync(transcript,JSON.stringify({type:'assistant',message:{id:'one',usage:{input_tokens:10,output_tokens:5},content:'PRIVATE'}})+'\n');
 const payload={hook_event_name:'Stop',session_id:'test',cwd:dir,transcript_path:transcript,cost:{total_cost_usd:.01},rate_limits:{five_hour:{used_percentage:20,resets_at:Math.floor(Date.now()/1000)+3600}},prompt:'PRIVATE'};
 const child=spawn(process.execPath,[join(dir,'hook.mjs'),'claude','--data',dir],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stdin.end(JSON.stringify(payload));const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 assert.equal(code,0);assert.equal(output,'');assert.equal(received.length,1);assert.equal(received[0].usage.sessionTokens,15);assert.equal(received[0].hook_event_name,'Stop');assert.equal(JSON.stringify(received[0].usage).includes('PRIVATE'),false);
});
