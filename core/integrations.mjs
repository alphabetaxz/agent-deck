import { readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,unlinkSync,statSync,lstatSync,accessSync,constants,openSync,closeSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID,createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
const names={claude:'Claude Code',pi:'pi',codex:'Codex CLI'};
const events={claude:['SessionStart','SessionEnd','UserPromptSubmit','PermissionRequest','PostToolUse','PostToolUseFailure','Stop','StopFailure','Notification'],codex:['SessionStart','SessionEnd','UserPromptSubmit','PermissionRequest','PostToolUse','Stop']};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const hash=s=>createHash('sha256').update(s??'').digest('hex');
function read(path) {try {if(lstatSync(path).isSymbolicLink())throw new Error('接入文件是符号链接，已保留原文件');return readFileSync(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function objectJSON(text,label) {
  if(text===null)return {};
  let value;try{value=JSON.parse(text);}catch{throw new Error(`${label}不是有效 JSON，原文件未修改`);}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label}格式不正确，原文件未修改`);
  return value;
}
export function mergeHooks(text,ownedCommands,command,source) {
  const value=objectJSON(text,'Agent 配置');const hooks=value.hooks??{};
  if(!hooks||typeof hooks!=='object'||Array.isArray(hooks))throw new Error('hooks 格式不正确，原文件未修改');
  const result={};
  for(const [event,groups] of Object.entries(hooks)) {
    if(!Array.isArray(groups))throw new Error(`Hook ${event} 格式不正确，原文件未修改`);
    result[event]=groups.flatMap(group=>{
      if(!group||typeof group!=='object'||!Array.isArray(group.hooks))throw new Error('Hook 分组格式不正确，原文件未修改');
      const handlers=group.hooks.filter(h=>!h || typeof h.command!=='string' || !ownedCommands.includes(h.command));
      return handlers.length===0&&group.hooks.length>0?[]:[{...group,hooks:handlers}];
    });
    if(result[event].length===0)delete result[event];
  }
  if(command)for(const event of events[source]) {
    result[event]??=[];result[event].push({hooks:[{type:'command',command,timeout:2}]});
  }
  if(Object.keys(result).length)value.hooks=result;else delete value.hooks;
  return JSON.stringify(value,null,2)+'\n';
}

// Preserve TOML text and unrelated values; refuse unfamiliar feature encodings.
export function enableFeature(text,key) {
  const lines=(text??'').split('\n');
  if(lines.some(l=>/^\s*\[\s*["']features["']/.test(l)))throw new Error('Codex features 使用了暂不支持的 TOML 写法，原文件未修改');
  if(lines.some(l=>/^\s*features\s*=|^\s*features\.(hooks|codex_hooks)\s*=/.test(l)))throw new Error('Codex features 使用了暂不支持的 TOML 写法，原文件未修改');
  const headers=lines.map((l,i)=>/^\s*\[features\]\s*(?:#.*)?$/.test(l)?i:-1).filter(i=>i>=0);
  if(headers.length>1)throw new Error('Codex features 重复，原文件未修改');
  const seen=new Set();const records=[];let header=headers[0];const addedHeader=header===undefined;
  if(addedHeader){if(lines.at(-1)!=='')lines.push('');header=lines.length;lines.push('[features]');}
  let end=lines.findIndex((l,i)=>i>header&&/^\s*\[/.test(l));if(end<0)end=lines.length;
  for(let i=header+1;i<end;i++) {
    const line=lines[i];
    if(/^\s*["']?(hooks|codex_hooks)["']?\s*=/.test(line)) {
      const match=line.match(/^\s*(hooks|codex_hooks)\s*=\s*(true|false)\s*(?:#.*)?$/);
      if(!match)throw new Error('Codex Hooks 开关格式不支持，原文件未修改');
      if(seen.has(match[1]))throw new Error('Codex Hooks 开关重复，原文件未修改');seen.add(match[1]);
      const installed=`${match[1]} = true`;
      if(match[2]==='false'){records.push({key:match[1],original:line,installed});lines[i]=installed;}
    }
  }
  const hasKey=lines.slice(header+1,end).some(l=>new RegExp('^\\s*'+key+'\\s*=').test(l));
  if(!hasKey){const installed=key+' = true';lines.splice(end,0,installed);records.push({key,original:null,installed});}
  return {text:lines.join('\n'),records,addedHeader};
}
export function restoreFeature(text,patch) {
  if(text===null||!patch)return text;
  const lines=text.split('\n');const header=lines.findIndex(l=>/^\s*\[features\]\s*(?:#.*)?$/.test(l));if(header<0)return text;
  let end=lines.findIndex((l,i)=>i>header&&/^\s*\[/.test(l));if(end<0)end=lines.length;
  for(const record of patch.records??[]) {
    const index=lines.findIndex((line,i)=>i>header&&i<end&&line===record.installed);
    if(index<0)continue;
    if(record.original===null){lines.splice(index,1);end--;}else lines[index]=record.original;
  }
  if(patch.addedHeader&&lines.slice(header+1,end).every(l=>!l.trim()))lines.splice(header,end-header);
  return lines.join('\n');
}

export class IntegrationManager {
  constructor({root,dataDir,home=homedir(),env=process.env,probe,desktop}) {
    this.desktop=desktop;this.root=root;this.dataDir=resolve(dataDir);this.home=home;this.env=env;
    this.directory=join(this.dataDir,'integrations');this.observed=new Map();this.tools=new Map();
    this.probe=probe??(source=>this.detect(source));
    this.paths={claude:join(env.CLAUDE_CONFIG_DIR??join(home,'.claude'),'settings.json'),codex:join(env.CODEX_HOME??join(home,'.codex'),'hooks.json'),pi:join(env.PI_CODING_AGENT_DIR??join(home,'.pi','agent'),'extensions','agent-deck.ts')};
    this.codexConfig=join(dirname(this.paths.codex),'config.toml');
  }
  manifestPath(source){return join(this.directory,source+'.json');}
  manifest(source){return objectJSON(read(this.manifestPath(source)),'接入记录');}
  async detect(source) {
    const path=[...(this.env.PATH??'').split(':'),join(this.home,'.local/bin'),join(this.home,'.asdf/shims'),'/opt/homebrew/bin','/usr/local/bin'];
    const binary=path.map(p=>join(p,source)).find(p=>{try{accessSync(p,constants.X_OK);return statSync(p).isFile();}catch{return false;}});
    if(!binary)return {available:false,found:false,reason:'未检测到工具，请安装后点击重新检测'};
    try {
      const {stdout}=await execute(binary,['--version'],{timeout:3000,maxBuffer:16384,env:{...this.env,PATH:path.join(':')}});
      let featureKey='hooks';
      if(source==='codex') {
        try {const {stdout:features}=await execute(binary,['features','list'],{timeout:3000,maxBuffer:16384,env:{...this.env,PATH:path.join(':')}});
          if(!/^hooks\s/m.test(features)&&/^codex_hooks\s/m.test(features))featureKey='codex_hooks';
          else if(!/^hooks\s/m.test(features))return {available:false,found:true,binary,reason:'当前版本未提供 Hooks 功能，请升级 Codex CLI'};
        }catch{return {available:false,found:true,binary,reason:'无法确认 Hooks 支持，请检查或升级 Codex CLI'};}
      }
      return {available:true,found:true,binary,version:stdout.trim().split('\n')[0].slice(0,100),featureKey};
    }catch{return {available:false,found:true,binary,reason:'工具无法启动，请检查或重新安装该工具'};}
  }
  async refresh() {
    await this.desktop?.refresh();
    if(!this.refreshing)this.refreshing=Promise.all(Object.keys(names).map(async source=>this.tools.set(source,await this.probe(source)))).finally(()=>this.refreshing=null);
    await this.refreshing;return this.status();
  }
  status() {
    return Object.keys(names).map(source=>{
      const tool=this.tools.get(source)??{available:false,found:false};let installed=false,needsRepair=false,error=null,hasConfig=false;
      let manifest={};
      try {
        manifest=this.manifest(source);hasConfig=!!manifest.installed;
        if(hasConfig){
          if(source==='pi')installed=hash(read(this.paths.pi))===manifest.extensionHash;
          else {
            const config=objectJSON(read(this.paths[source]),'Agent 配置');
            installed=events[source].every(event=>(config.hooks?.[event]??[]).some(g=>g.hooks?.some(h=>h.command===manifest.command)));
            installed=installed&&hash(read(join(this.directory,'hook.mjs')))===manifest.helperHash;
            if(source==='codex') {
              const toml=read(this.codexConfig)??'';
              if(/^\s*(hooks|codex_hooks)\s*=\s*false\s*(?:#.*)?$/m.test(toml))installed=false;
            }
          }
          needsRepair=!installed || manifest.dataDir!==this.dataDir;
        }
      }catch(e){error=e.message;needsRepair=hasConfig;}
      const lastEventAt=this.observed.get(source)??null;
      return {source,name:names[source],...tool,installed:installed&&!needsRepair,hasConfig,needsRepair,error,lastEventAt,
        state:error?'error':!tool.available?(tool.found?'unavailable':'missing'):needsRepair?'repair':installed?(lastEventAt?'connected':'configured'):'unconfigured',
        configPath:this.paths[source],message:installed?(source==='codex'&&!lastEventAt?'配置已安装；首次使用时请在 Codex 中确认 Hook 信任':'已安装接入；正常打开新会话即可上报状态'):tool.reason??'点击一键接入，自动保存配置'};
    }).concat(this.desktop?[this.desktop.status()]:[]);
  }
  recordEvent(source){if(names[source])this.observed.set(source,Date.now());}
  writeChanges(changes,source) {
    const active=changes.filter(c=>c.before!==c.after);if(!active.length)return;
    const backup=join(this.dataDir,'backups',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID(),source);mkdirSync(backup,{recursive:true,mode:0o700});
    for(const change of active)if(change.before!==null)writeFileSync(join(backup,change.label),change.before,{mode:0o600});
    const applied=[];
    try {
      for(const change of active) {
        if(read(change.path)!==change.before)throw new Error('配置已被其他程序修改，请重新检测后再试');
        if(change.after===null){unlinkSync(change.path);}else {
          mkdirSync(dirname(change.path),{recursive:true,mode:0o700});const temporary=change.path+'.agent-deck-'+randomUUID();
          try{writeFileSync(temporary,change.after,{mode:0o600});renameSync(temporary,change.path);}finally{if(existsSync(temporary))unlinkSync(temporary);}
        }
        applied.push(change);
      }
    }catch(e){
      for(const change of applied.reverse())if(read(change.path)===change.after){if(change.before===null){if(existsSync(change.path))unlinkSync(change.path);}else writeFileSync(change.path,change.before,{mode:0o600});}
      throw e;
    }
  }
  async change(source,action) {
    if(source==='codex-desktop'&&this.desktop)return this.desktop.change(action);
    if(!names[source]||!['install','remove'].includes(action))throw new Error('未知接入操作');
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    const lock=join(this.directory,'install.lock');let fd;
    try{fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));}catch(e){
      if(e.code!=='EEXIST')throw e;
      let alive=true;try{const owner=JSON.parse(readFileSync(lock,'utf8'));try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}}catch{/* preserve unknown lock */}
      if(alive)throw new Error('另一个接入操作正在进行，请稍后再试');
      unlinkSync(lock);return this.change(source,action);
    }
    try {
      const manifest=this.manifest(source);if(manifest.installed&&source!=='pi'&&typeof manifest.command!=='string')throw new Error('接入记录不完整，请保留配置并检查备份');const target=this.paths[source];const current=read(target);const changes=[];
      const add=(path,after,label)=>changes.push({path,before:read(path),after,label});
      if(action==='install') {
        const tool=await this.probe(source);this.tools.set(source,tool);if(!tool.available)throw new Error(tool.reason??'工具不可用');
        const next={...manifest,installed:true,dataDir:this.dataDir,installedAt:Date.now()};
        if(source==='pi') {
          if(current!==null&&(!manifest.installed||hash(current)!==manifest.extensionHash))throw new Error('同名 pi 扩展已存在或被修改，已保留原文件');
          const template=readFileSync(join(this.root,'integrations/pi-extension.ts'),'utf8');
          const extension=template.replace('const INSTALLED_DATA_DIR: string | undefined = undefined;',`const INSTALLED_DATA_DIR: string | undefined = ${JSON.stringify(this.dataDir)};`);
          if(extension===template)throw new Error('扩展模板缺少安装参数');
          next.extensionHash=hash(extension);add(target,extension,'pi-extension.ts');
        }else {
          const helperPath=join(this.directory,'hook.mjs');const helper=readFileSync(join(this.root,'integrations/hook.mjs'),'utf8');
          const command=[process.execPath,helperPath,source,'--data',this.dataDir].map(quote).join(' ');
          add(target,mergeHooks(current,manifest.command?[manifest.command]:[],command,source),'hooks.json');
          add(helperPath,helper,'hook.mjs');next.command=command;next.helperHash=hash(helper);
          if(source==='codex') {
            const previous=read(this.codexConfig);const patch=enableFeature(previous,tool.featureKey??'hooks');
            add(this.codexConfig,patch.text,'config.toml');
            next.featurePatch={records:[...(manifest.featurePatch?.records??[]),...patch.records],addedHeader:manifest.featurePatch?.addedHeader||patch.addedHeader};
          }
        }
        add(this.manifestPath(source),JSON.stringify(next,null,2)+'\n','integration.json');
      }else {
        if(!manifest.installed)return this.status();
        if(source==='pi') {
          if(current!==null&&hash(current)!==manifest.extensionHash)throw new Error('pi 扩展已被修改，已保留原文件');
          if(current!==null)add(target,null,'pi-extension.ts');
        }else {
          if(current!==null)add(target,mergeHooks(current,[manifest.command],null,source),'hooks.json');
          if(source==='codex'){const existing=read(this.codexConfig);if(existing!==null)add(this.codexConfig,restoreFeature(existing,manifest.featurePatch),'config.toml');}
        }
        add(this.manifestPath(source),JSON.stringify({...manifest,installed:false},null,2)+'\n','integration.json');this.observed.delete(source);
      }
      this.writeChanges(changes,source);return this.status();
    }finally{closeSync(fd);unlinkSync(lock);}
  }
}
