import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent,agentCards } from '../plugins/agents/state.mjs';
const event=(name,extra={})=>({source:'claude',session_id:'one',hook_event_name:name,cwd:'/code/project',timestamp:100,...extra});
test('approval remains actionable until completion or tool result',()=> {
  const sessions={};applyEvent(sessions,event('UserPromptSubmit',{turn_id:'a'}),100);
  applyEvent(sessions,event('PermissionRequest',{turn_id:'a'}),100);
  applyEvent(sessions,event('PreToolUse',{turn_id:'a'}),100);
  assert.equal(sessions['claude:one'].status,'waiting');
  applyEvent(sessions,event('PostToolUse',{turn_id:'a'}),100);
  assert.equal(sessions['claude:one'].status,'running');
  applyEvent(sessions,event('Stop',{turn_id:'a'}),100);
  assert.equal(sessions['claude:one'].status,'completed');
});
test('older turn completion does not override the new turn',()=> {
  const sessions={};applyEvent(sessions,event('UserPromptSubmit',{turn_id:'old'}),100);
  applyEvent(sessions,event('UserPromptSubmit',{turn_id:'new',timestamp:200}),200);
  applyEvent(sessions,event('Stop',{turn_id:'old',timestamp:300}),300);
  assert.equal(sessions['claude:one'].status,'running');
});
test('old timestamp and generic notifications cannot downgrade waiting state',()=> {
  const sessions={};applyEvent(sessions,event('PermissionRequest',{timestamp:200}),200);
  applyEvent(sessions,event('Stop'),300);applyEvent(sessions,event('Notification',{timestamp:300,notification_type:'idle_prompt'}),300);
  assert.equal(sessions['claude:one'].status,'waiting');
});
test('pi heartbeat preserves turn status and stale sessions become unknown',()=> {
  const sessions={};const e=event('Stop',{source:'pi'});applyEvent(sessions,e,100);
  applyEvent(sessions,{...e,hook_event_name:'Heartbeat',timestamp:200},200);
  assert.equal(sessions['pi:one'].status,'completed');assert.equal(sessions['pi:one'].updatedAt,100);
  assert.equal(agentCards(sessions,50000)[0].status,'unknown');
});
test('ended sessions stay ended until explicit restart; sources have separate identity',()=> {
  const sessions={};applyEvent(sessions,event('SessionStart'),100);applyEvent(sessions,event('SessionEnd'),100);applyEvent(sessions,event('PreToolUse'),100);
  assert.equal(agentCards(sessions,100).length,0);
  applyEvent(sessions,event('SessionStart'),100);applyEvent(sessions,event('SessionStart',{source:'codex'}),100);
  assert.equal(agentCards(sessions,100).length,2);
});
test('a tool failure does not finish the overall turn',()=> {
  const sessions={};applyEvent(sessions,event('UserPromptSubmit'),100);applyEvent(sessions,event('PostToolUseFailure'),100);
  assert.equal(sessions['claude:one'].status,'running');
});
test('long Claude tool execution stays running until its result arrives',()=>{
  const sessions={};applyEvent(sessions,event('PreToolUse',{tool_use_id:'bash-1',tool_name:'Bash'}),100);
  assert.equal(agentCards(sessions,3600100)[0].status,'running');
  applyEvent(sessions,event('PostToolUse',{tool_use_id:'bash-1',timestamp:3600100}),3600100);
  applyEvent(sessions,event('Stop',{timestamp:3600200}),3600200);
  assert.equal(agentCards(sessions,3600200)[0].status,'completed');
  assert.equal(agentCards(sessions,4000000)[0].status,'unknown');
});
test('parallel subagents remain active after the parent stops until all finish',()=>{
  const sessions={};applyEvent(sessions,event('UserPromptSubmit'),100);
  for(const agent_id of ['a','b'])applyEvent(sessions,event('SubagentStart',{agent_id}),100);
  applyEvent(sessions,event('Stop'),100);
  applyEvent(sessions,event('SubagentStop',{agent_id:'a'}),100);
  assert.equal(agentCards(sessions,3600100)[0].status,'running');
  applyEvent(sessions,event('SubagentStop',{agent_id:'b',timestamp:3600100}),3600100);
  assert.equal(agentCards(sessions,3600100)[0].status,'completed');
});
test('subagent completion does not finish a working parent or unrelated subagent',()=>{
  const sessions={};applyEvent(sessions,event('UserPromptSubmit'),100);
  applyEvent(sessions,event('SubagentStart',{agent_id:'a'}),100);
  applyEvent(sessions,event('PreToolUse',{agent_id:'a',tool_use_id:'child-tool'}),100);
  applyEvent(sessions,event('Stop',{agent_id:'a'}),100);
  assert.equal(sessions['claude:one'].status,'running');
  applyEvent(sessions,event('SubagentStop',{agent_id:'a'}),100);
  assert.equal(sessions['claude:one'].status,'running');
  assert.deepEqual(sessions['claude:one'].tools,{});
  applyEvent(sessions,event('SubagentStop',{agent_id:'internal-suggestion'}),100);
  applyEvent(sessions,event('Stop'),100);
  assert.equal(sessions['claude:one'].status,'completed');
});
test('failure clears pending tool; restored state and ended sessions cannot stay live',async()=>{
  const {resetRestoredSessions}=await import('../plugins/agents/state.mjs');
  const sessions={};applyEvent(sessions,event('PreToolUse',{tool_use_id:'one'}),100);
  applyEvent(sessions,event('PostToolUseFailure',{tool_use_id:'one'}),100);
  assert.deepEqual(sessions['claude:one'].tools,{});
  applyEvent(sessions,event('SubagentStart',{agent_id:'one'}),100);
  resetRestoredSessions(sessions);
  assert.equal(agentCards(sessions,3600100)[0].status,'unknown');
  applyEvent(sessions,event('SessionEnd'),100);
  assert.equal(agentCards(sessions,3600100).length,0);
});
