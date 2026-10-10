import { basename } from 'node:path';
const sources=new Set(['claude','codex','pi']);
const events=new Set(['SessionStart','SessionEnd','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','StopFailure','Heartbeat','Interrupt','SubagentStart','SubagentStop']);
const active=s=>Object.keys(s.tools??{}).length>0||Object.keys(s.subagents??{}).length>0;
export function resetRestoredSessions(sessions){for(const s of Object.values(sessions)){s.lastSeen=0;s.tools={};s.subagents={};s.mainStopped=false;}}
const clip=v=>typeof v==='string'?v.slice(0,500):'';
export function applyEvent(sessions, event, now=Date.now()) {
  if (!event || !sources.has(event.source) || !events.has(event.hook_event_name) || typeof event.session_id!=='string' || !event.session_id || event.session_id.length>120) throw new Error('Invalid agent event');
  const key=`${event.source}:${event.session_id}`;
  let s=sessions[key]; const name=event.hook_event_name;
  const at=Number.isFinite(event.timestamp)?Math.min(event.timestamp,now):now;
  if (s && at<s.updatedAt) return false;
  if (s?.ended && name!=='SessionStart') return false;
  if (name==='Heartbeat' && !s) return false;
  if (!s) {
    if (Object.keys(sessions).length>=100) { const oldest=Object.values(sessions).sort((a,b)=>a.lastSeen-b.lastSeen)[0]; delete sessions[oldest.id]; }
    s=sessions[key]={id:key,source:event.source,title:basename(clip(event.cwd))||'未命名项目',status:'idle',summary:'等待任务',updatedAt:at,lastSeen:now,ended:false};
  }
  // Reject known older turns even when they arrive later than the next submit.
  if (event.turn_id && s.turnId && event.turn_id!==s.turnId && !['SessionStart','UserPromptSubmit'].includes(name)) return false;
  const seen=Number.isFinite(event.observed_at)?Math.min(event.observed_at,now):now;
  if(event.client==='desktop')s.client='desktop';
  if (name==='Heartbeat') { s.lastSeen=seen; return false; }
  if (event.source==='claude') {
    s.tools??={};s.subagents??={};
    const tool=event.tool_use_id?'tool:'+clip(event.tool_use_id):'',agent=event.agent_id?'agent:'+clip(event.agent_id):'';
    if(['SessionStart','Interrupt','SessionEnd','StopFailure'].includes(name)){s.tools={};s.subagents={};s.mainStopped=false;}
    if(name==='UserPromptSubmit')s.mainStopped=false;
    if(name==='PreToolUse'&&tool)s.tools[tool]=agent;
    if(['PostToolUse','PostToolUseFailure'].includes(name)&&tool)delete s.tools[tool];
    if(name==='SubagentStart'&&agent)s.subagents[agent]=true;
    if(name==='SubagentStop'&&agent){delete s.subagents[agent];for(const [id,owner] of Object.entries(s.tools))if(owner===agent)delete s.tools[id];}
  }
  if (name==='SessionStart') { s.status='idle'; s.summary='等待任务'; s.ended=false; s.turnId=null; }
  if (name==='UserPromptSubmit') { s.status='running'; s.summary=clip(event.prompt)||'正在处理任务'; s.turnId=event.turn_id??null; }
  if (name==='PermissionRequest' || (name==='Notification' && ['permission_prompt','agent_needs_input','elicitation_dialog'].includes(event.notification_type))) { s.status='waiting'; s.summary=clip(event.message)||'需要你在电脑端处理'; }
  if (name==='PreToolUse' && s.status!=='waiting') { s.status='running'; s.summary=`正在使用 ${clip(event.tool_name)||'工具'}`; }
  if (name==='PostToolUse') { s.status='running'; s.summary='继续处理任务'; }
  if (name==='PostToolUseFailure') s.summary='工具执行失败，等待后续事件';
  if (name==='SubagentStart' && s.status!=='waiting') {s.status='running';s.summary='子 Agent 正在工作';}
  if (name==='SubagentStop' && s.status!=='waiting' && (s.status==='running'||active(s))) {s.status='running';s.summary='继续处理任务';}
  if (name==='Stop' && !event.agent_id) {s.mainStopped=true;s.status=active(s)?'running':'completed';s.summary=active(s)?'等待后台任务完成':clip(event.last_assistant_message)||'本轮回复已完成';}
  if(s.source==='claude'&&s.mainStopped&&!active(s)&&['SubagentStop','PostToolUse','PostToolUseFailure'].includes(name)){s.status='completed';s.summary='本轮回复已完成';}
  if (name==='StopFailure') { s.status='error'; s.summary=clip(event.error)||'本轮运行异常'; }
  if(name==='Interrupt'){s.status='idle';s.summary='本轮已中断';}
  if (name==='SessionEnd') { s.ended=true; s.status='idle'; s.summary='会话已结束'; }
  s.updatedAt=at; s.lastSeen=seen; return true;
}
export function agentCards(sessions,now=Date.now()) {
  return Object.values(sessions).filter(s=>!s.ended).sort((a,b)=>(b.status==='waiting')-(a.status==='waiting')||b.updatedAt-a.updatedAt).map(s=> {
    // Without a process monitor, quiet Claude/Codex sessions have uncertain liveness.
    const stale=!(s.source==='claude'&&s.lastSeen>0&&active(s))&&now-s.lastSeen>(s.source==='pi'?45000:300000);
    return {id:s.id,type:'status',title:s.title,subtitle:s.client==='desktop'?'Codex':s.source==='claude'?'Claude Code':s.source==='codex'?'Codex':'pi',status:stale?'unknown':s.status,summary:stale?'暂未收到新事件；存活状态待确认':s.summary,updatedAt:s.updatedAt};
  });
}
