// Observation only. Always exit successfully and never write directives to stdout.
import { readFileSync,realpathSync,openSync,fstatSync,readSync,closeSync } from 'node:fs';
import {claudeTranscriptTokens} from './usage.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function sendEvent(event,installedDataDir) {
  const data=installedDataDir??process.env.AGENT_DECK_DATA??join(homedir(),'Library/Application Support/AgentDeck');
  const runtime=JSON.parse(readFileSync(join(data,'runtime.json'),'utf8'));
  const url=new URL(runtime.hookURL);
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return;
  await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+runtime.hookToken},body:JSON.stringify(event),signal:AbortSignal.timeout(800)});
}
if (process.argv[1] && fileURLToPath(import.meta.url)===realpathSync(process.argv[1])) {
  try {
    let input='';
    for await (const chunk of process.stdin) { input+=chunk.toString();if(Buffer.byteLength(input)>128*1024)process.exit(0); }
    const payload=JSON.parse(input); const source=process.argv[2];
    const dataIndex=process.argv.indexOf('--data');
    let usage;
    if(source==='claude'&&!payload.agent_id&&['SessionStart','UserPromptSubmit','PostToolUse','PostToolUseFailure','Stop'].includes(payload.hook_event_name)&&typeof payload.transcript_path==='string'){
      let fd;try{fd=openSync(payload.transcript_path,'r');const stat=fstatSync(fd);if(stat.isFile()&&stat.size<=8*1024*1024){const buffer=Buffer.alloc(stat.size);let offset=0;while(offset<buffer.length){const count=readSync(fd,buffer,offset,buffer.length-offset,offset);if(!count)break;offset+=count;}const tokens=claudeTranscriptTokens(buffer.subarray(0,offset).toString('utf8'));if(tokens!==undefined)usage={sessionTokens:tokens,sessionScope:'main',windows:[]};}}catch{/* No partial or invented totals. */}finally{if(fd!==undefined)closeSync(fd);}
    }
    if(['claude','codex'].includes(source))await sendEvent({...payload,source,...(usage?{usage}:{}),timestamp:Date.now()},dataIndex<0?undefined:process.argv[dataIndex+1]);
  } catch { /* Service stopped, malformed payload, or transport failure: let agent continue. */ }
  process.exit(0);
}
