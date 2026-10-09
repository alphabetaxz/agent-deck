import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Written independently against Pi's public extension API. No approval interception.
export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let latest = '';
  let turnId = '';
  const send = async (event: string, ctx: any, extra: Record<string, unknown> = {}) => {
    try {
      const data = process.env.AGENT_DECK_DATA ?? join(homedir(), 'Library/Application Support/AgentDeck');
      const runtime = JSON.parse(readFileSync(join(data, 'runtime.json'), 'utf8'));
      const url = new URL(runtime.hookURL);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return;
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + runtime.hookToken }, body: JSON.stringify({source:'pi',session_id:ctx.sessionManager.getSessionId(),cwd:ctx.cwd,hook_event_name:event,timestamp:Date.now(),turn_id:turnId||undefined,...extra}), signal: AbortSignal.timeout(800) });
    } catch { /* Never interfere with agent execution. */ }
  };
  const clear = () => { if (timer) clearInterval(timer); timer = undefined; };
  pi.on('session_start', (_event, ctx) => { clear();turnId='';latest='';void send('SessionStart',ctx);timer=setInterval(()=>void send('Heartbeat',ctx),15000);timer.unref(); });
  pi.on('before_agent_start', (event,ctx) => { turnId=crypto.randomUUID();latest='';void send('UserPromptSubmit',ctx,{prompt:event.prompt}); });
  pi.on('tool_execution_start',(event,ctx)=>{void send('PreToolUse',ctx,{tool_name:event.toolName});});
  pi.on('tool_execution_end',(event,ctx)=>{void send(event.isError?'PostToolUseFailure':'PostToolUse',ctx,{tool_name:event.toolName});});
  pi.on('message_end',event=>{if(event.message.role==='assistant')latest=event.message.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('').slice(0,500);});
  pi.on('agent_settled',(_event,ctx)=>{void send('Stop',ctx,{last_assistant_message:latest});});
  pi.on('session_shutdown',async(event,ctx)=>{clear();if(event.reason!=='reload')await send('SessionEnd',ctx);});
}
