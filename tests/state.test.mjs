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
