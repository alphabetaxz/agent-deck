// Observation only. Always exit successfully and never write directives to stdout.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function sendEvent(event) {
  const data=process.env.AGENT_DECK_DATA??join(homedir(),'Library/Application Support/AgentDeck');
  const runtime=JSON.parse(readFileSync(join(data,'runtime.json'),'utf8'));
  const url=new URL(runtime.hookURL);
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return;
  await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+runtime.hookToken},body:JSON.stringify(event),signal:AbortSignal.timeout(800)});
}
if (process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  try {
    let input='';
    for await (const chunk of process.stdin) { input+=chunk.toString();if(Buffer.byteLength(input)>128*1024)process.exit(0); }
    const payload=JSON.parse(input); const source=process.argv[2];
    if(['claude','codex'].includes(source))await sendEvent({...payload,source,timestamp:Date.now()});
  } catch { /* Service stopped, malformed payload, or transport failure: let agent continue. */ }
  process.exit(0);
}
