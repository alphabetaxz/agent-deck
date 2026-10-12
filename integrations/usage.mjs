// Numeric usage only: never forward account credentials or transcript text.
const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:undefined;
export function normalizeUsage(raw,now=Date.now()) {
 if(!raw||typeof raw!=='object')return null;
 const value={updatedAt:now,windows:[]};if(raw.sessionScope==='main')value.sessionScope='main';
 for(const key of ['sessionTokens','sessionCostUSD','contextPercent']){const n=number(raw[key]);if(n!==undefined&&(key!=='contextPercent'||n<=100))value[key]=n;}
 if(Array.isArray(raw.windows))for(const w of raw.windows.slice(0,4)) {
  if(!w||typeof w.id!=='string'||!/^[a-z0-9_-]{1,40}$/.test(w.id))continue;
  const usedPercent=number(w.usedPercent),resetsAt=number(w.resetsAt),windowMinutes=number(w.windowMinutes);
  if(usedPercent===undefined||usedPercent>100||resetsAt===undefined||resetsAt>8640000000000000)continue;
  value.windows.push({id:w.id,usedPercent,resetsAt,...(windowMinutes!==undefined?{windowMinutes}:{})});
 }
 return value;
}
export function codexUsage(payload){
 const info=payload.info;const limit=payload.rate_limits;const windows=[];
 for(const id of ['primary','secondary']){const w=limit?.[id];if(w)windows.push({id,usedPercent:w.used_percent,resetsAt:w.resets_at*1000,windowMinutes:w.window_minutes});}
 return {sessionTokens:info?.total_token_usage?.total_tokens,contextPercent:info?.model_context_window>0&&info.last_token_usage?Math.min(100,100*info.last_token_usage.input_tokens/info.model_context_window):undefined,windows};
}
export function claudeUsage(payload,sessionTokens){
 const windows=[];
 for(const [id,minutes] of [['five_hour',300],['seven_day',10080],['spend_limit',undefined]]){const w=payload.rate_limits?.[id];if(w)windows.push({id,usedPercent:w.used_percentage,resetsAt:w.resets_at*1000,windowMinutes:minutes});}
 return {sessionScope:'main',sessionTokens,sessionCostUSD:payload.cost?.total_cost_usd,contextPercent:payload.context_window?.used_percentage,windows};
}
// Assistant responses may be repeated for different content blocks. Count each API
// response once and retain the largest observed counters while it is streaming.
export function claudeTranscriptTokens(text){
 const messages=new Map();let found=false;
 for(const line of text.split('\n')){let row;try{row=JSON.parse(line);}catch{continue;}
  const m=row.message;if(row.type!=='assistant'||!m?.id||!m.usage)continue;
  const usage=m.usage;const previous=messages.get(m.id)??[0,0,0,0];
  const keys=['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'];
  for(let i=0;i<keys.length;i++){const n=number(usage[keys[i]]);if(n!==undefined){previous[i]=Math.max(previous[i],n);found=true;}}
  messages.set(m.id,previous);
 }
 return found?[...messages.values()].reduce((sum,v)=>sum+v.reduce((a,b)=>a+b,0),0):undefined;
}
