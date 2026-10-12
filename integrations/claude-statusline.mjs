import {readFile,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {spawn} from 'node:child_process';
import {sendEvent} from './hook.mjs';
import {claudeUsage,claudeTranscriptTokens} from './usage.mjs';
// This observer runs in Claude's statusline subprocess, away from the App UI.
// Preserve the user's existing statusline command and its output verbatim.
async function main(){
 let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>128*1024)return;}
 const payload=JSON.parse(input);const directory=dirname(fileURLToPath(import.meta.url));
 const configuration=JSON.parse(await readFile(join(directory,'claude-statusline-config.json'),'utf8'));
 const original=configuration.original;
 const passthrough=original?.command?new Promise(resolve=>{
  const child=spawn(original.command,{shell:true,stdio:['pipe','pipe','ignore'],cwd:payload.cwd||process.cwd()});
  child.stdout.pipe(process.stdout);child.stdin.on('error',()=>{});child.stdin.end(input);
  child.on('error',resolve);child.on('close',resolve);
 }):Promise.resolve();
 let tokens;
 try{const file=await open(payload.transcript_path,'r');try{const stat=await file.stat();if(stat.isFile()&&stat.size<=8*1024*1024)tokens=claudeTranscriptTokens(await file.readFile('utf8'));}finally{await file.close();}}catch{/* Missing/large transcripts have no total; don't display partial totals. */}
 try{await sendEvent({source:'claude',session_id:payload.session_id,cwd:payload.cwd,hook_event_name:'Usage',timestamp:Date.now(),usage:claudeUsage(payload,tokens)},configuration.dataDir);}catch{/* Never affect Claude. */}
 if(!original?.command)process.stdout.write(`[${typeof payload.model?.display_name==='string'?payload.model.display_name:'Claude'}]\n`);
 await passthrough;
}
main().catch(()=>{});
