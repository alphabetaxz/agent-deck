import {DatabaseSync} from 'node:sqlite';
import {existsSync,readdirSync,openSync,closeSync,readSync,fstatSync,realpathSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {homedir} from 'node:os';
const origins=new Set(['Codex Desktop','codex_work_desktop','codex-desktop']);
const MAX_LINE=1024*1024,MAX_INITIAL=32*1024*1024,MAX_TICK=2*1024*1024;
export function desktopEvent(row,session,turnId){
 const p=row.payload??{};const timestamp=Date.parse(row.timestamp);if(!Number.isFinite(timestamp))return null;
 const base={source:'codex',client:'desktop',session_id:session.id,cwd:session.cwd,timestamp,observed_at:timestamp,turn_id:p.turn_id??turnId};
 if(row.type==='event_msg'){
  if(p.type==='task_started')return {...base,hook_event_name:'UserPromptSubmit',prompt:'正在处理桌面任务'};
  if(p.type==='task_complete')return {...base,hook_event_name:'Stop',last_assistant_message:'本轮桌面任务已完成'};
  if(p.type==='turn_aborted')return {...base,hook_event_name:'Interrupt'};
  if(p.type==='error')return {...base,hook_event_name:'StopFailure',error:'桌面任务报告异常'};
  if(['exec_approval_request','apply_patch_approval_request','request_user_input'].includes(p.type))return {...base,hook_event_name:'PermissionRequest',message:'请在 Codex处理'};
  if(p.type==='token_count')return {...base,hook_event_name:'Heartbeat'};
 }
 if(row.type==='response_item'){
  if(['function_call','custom_tool_call'].includes(p.type)){
   if(/(^|\.)request_user_input$/.test(p.name??''))return {...base,hook_event_name:'PermissionRequest',message:'请在 Codex回答问题'};
   return {...base,hook_event_name:'PreToolUse',tool_name:'桌面工具'};
  }
  if(['function_call_output','custom_tool_call_output'].includes(p.type))return {...base,hook_event_name:'PostToolUse'};
 }
 return null;
}
export class CodexDesktopObserver {
 constructor({store,home=homedir(),env=process.env,onEvent,appPaths=['/Applications/ChatGPT.app','/Applications/Codex.app',join(home,'Applications/ChatGPT.app'),join(home,'Applications/Codex.app')],interval=1500,isReady=()=>true,onRemove,onStatus}){
  this.onStatus=onStatus;this.isReady=isReady;this.onRemove=onRemove;this.store=store;this.home=resolve(env.CODEX_HOME??join(home,'.codex'));this.onEvent=onEvent;this.appPaths=appPaths;this.interval=interval;this.files=new Map();this.enabled=store.get('core','codexDesktopEnabled',false);this.lastEventAt=null;this.error=null;this.available=false;this.closed=false;
 }
 databasePath(){try{return readdirSync(this.home).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0])).map(n=>join(this.home,n))[0];}catch{return null;}}
 async refresh(){this.available=this.appPaths.some(p=>existsSync(p))&&!!this.databasePath();return this.status();}
 status(){return {source:'codex-desktop',name:'Codex',available:this.available,found:this.appPaths.some(p=>existsSync(p)),installed:this.enabled,hasConfig:this.enabled,needsRepair:false,error:this.error,lastEventAt:this.lastEventAt,state:this.error?'error':!this.available?'missing':this.enabled?(this.lastEventAt?'connected':'configured'):'unconfigured',message:!this.available?(this.appPaths.some(p=>existsSync(p))?'未发现本机会话记录，请先在 Codex创建本地会话':'未检测到 Codex'):this.enabled?'只读接入已开启；工作、完成和中断会自动显示，部分审批状态可能不可见':'自动读取本机桌面会话状态，无需安装 CLI 或修改 Codex 配置'};}
 async change(action){
  if(!['install','remove'].includes(action))throw new Error('未知接入操作');await this.refresh();if(action==='install'&&!this.available)throw new Error('未检测到 Codex或本机会话记录，请先打开桌面版创建本地会话');
  this.enabled=action==='install';this.store.set('core','codexDesktopEnabled',this.enabled);
  if(!this.enabled){await this.pending;if(this.onRemove)await this.onRemove();else for(const file of this.files.values())if(file.session)await this.onEvent({source:'codex',client:'desktop',session_id:file.session.id,cwd:file.session.cwd,hook_event_name:'SessionEnd',timestamp:Date.now()});this.files.clear();this.lastEventAt=null;this.error=null;}else await this.tick();
  return this.status();
 }
 start(){this.closed=false;this.timer=setInterval(()=>{void this.tick();},this.interval);this.timer.unref();void this.tick();}
 async close(){this.closed=true;clearInterval(this.timer);if(this.pending)await this.pending;}
 async tick(){if(this.closed||!this.enabled)return;if(this.pending)return this.pending;const before=JSON.stringify(this.status());this.pending=this.scan().catch(()=>{this.error='无法读取桌面会话状态，请重新检测；Codex 文件未修改';}).finally(()=>{this.pending=null;if(!this.closed&&JSON.stringify(this.status())!==before)this.onStatus?.();});return this.pending;}
 async scan(){
  if(!this.isReady())return;
  await this.refresh();if(!this.available)return;const path=this.databasePath();let db,rows;
  try{db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA query_only=ON');rows=db.prepare("SELECT id,rollout_path,cwd FROM threads WHERE archived=0 AND source='vscode' AND updated_at>=? ORDER BY updated_at DESC LIMIT 32").all(Math.floor(Date.now()/1000)-86400);}finally{db?.close();}
  this.error=null;const active=new Set();
  for(const row of rows){
   if(this.closed||!this.enabled)break;
   let real;try{real=realpathSync(row.rollout_path);const allowed=realpathSync(join(this.home,'sessions'))+sep;if(!real.startsWith(allowed))continue;}catch{continue;}
   active.add(real);let file=this.files.get(real);const fd=openSync(real,'r');
   try{
    const stat=fstatSync(fd);if(!file||file.inode!==stat.ino||stat.size<file.offset){file={inode:stat.ino,offset:0,buffer:'',discard:false,session:null,turnId:null,seen:false,active:false,lastLifecycleTime:0};this.files.set(real,file);}
    if(stat.size>MAX_INITIAL&&file.offset===0){file.offset=stat.size;this.error='部分会话记录过大，等待新会话后再接入';continue;}
    const start=file.offset;let remaining=Math.min(stat.size-file.offset,start===0?MAX_INITIAL:MAX_TICK);const events=[];
    while(remaining>0){const chunk=Buffer.alloc(Math.min(65536,remaining));const count=readSync(fd,chunk,0,chunk.length,file.offset);if(!count)break;file.offset+=count;remaining-=count;
     // Buffer bytes to preserve UTF-8 and incomplete JSON across writes.
     file.bytes=Buffer.concat([file.bytes??Buffer.alloc(0),chunk.subarray(0,count)]);
     let newline;while((newline=file.bytes.indexOf(10))>=0){const line=file.bytes.subarray(0,newline);file.bytes=file.bytes.subarray(newline+1);if(file.discard){file.discard=false;continue;}if(line.length>MAX_LINE)continue;let record;try{record=JSON.parse(line.toString('utf8'));}catch{continue;}
      if(record.type==='session_meta'){const m=record.payload;if(origins.has(m?.originator)&&m.source==='vscode'&&m.id===row.id)file.session={id:m.id,cwd:row.cwd};else file.rejected=true;}
      if(!file.session||file.rejected)continue;const event=desktopEvent(record,file.session,file.turnId);if(!event)continue;
      if(event.timestamp<file.lastLifecycleTime)continue;
      if(event.turn_id&&file.turnId&&event.turn_id!==file.turnId&&event.hook_event_name!=='UserPromptSubmit')continue;
      if(['UserPromptSubmit','Stop','Interrupt','StopFailure'].includes(event.hook_event_name))file.lastLifecycleTime=event.timestamp;
      if(event.hook_event_name==='UserPromptSubmit'){file.turnId=event.turn_id;file.active=true;}
      if(['Stop','Interrupt','StopFailure'].includes(event.hook_event_name))file.active=false;
      if(['PreToolUse','PostToolUse','PermissionRequest'].includes(event.hook_event_name)&&!file.active)continue;
      events.push(event);
     }
     if(file.bytes.length>MAX_LINE){file.bytes=Buffer.alloc(0);file.discard=true;}
    }
    // Startup replay reduces historical records to the final state before publication.
    if(start===0&&events.length){let lastLifecycle=-1;for(let i=0;i<events.length;i++)if(['UserPromptSubmit','Stop','Interrupt','StopFailure'].includes(events[i].hook_event_name))lastLifecycle=i;if(lastLifecycle>=0)events.splice(0,lastLifecycle);else events.length=0;}
    if(start===0&&events.length)events.unshift({...events[0],hook_event_name:'SessionStart'});
    for(const event of events){if(this.closed||!this.enabled)break;if(event.hook_event_name==='UserPromptSubmit')await this.onEvent({...event,hook_event_name:'SessionStart'});
     await this.onEvent(event);this.lastEventAt=Math.max(this.lastEventAt??0,event.timestamp);file.seen=true;}
   }finally{closeSync(fd);}
  }
  for(const [path,file] of this.files)if(!active.has(path)){if(file.session&&file.seen)await this.onEvent({source:'codex',client:'desktop',session_id:file.session.id,cwd:file.session.cwd,hook_event_name:'SessionEnd',timestamp:Date.now()});this.files.delete(path);}
 }
}
