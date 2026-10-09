import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { API_VERSION, MAX_MESSAGE_BYTES, validateManifest, validateCards } from './protocol.mjs';

export class PluginHost {
  constructor(directory, store, changed) {
    this.store = store; this.changed = changed; this.plugins = new Map(); this.nextId = 0; this.closed = false;
    for (const folder of readdirSync(directory, { withFileTypes: true }).filter(x => x.isDirectory())) {
      const dir = resolve(directory, folder.name);
      try {
        const manifest = validateManifest(JSON.parse(readFileSync(resolve(dir,'plugin.json'),'utf8')));
        const entry = resolve(dir,manifest.entrypoint);
        if (relative(dir,entry).startsWith('..' + sep) || relative(dir,entry) === '..') throw new Error('Entrypoint escapes plugin directory');
        if (this.plugins.has(manifest.id)) throw new Error('Duplicate plugin ID');
        this.plugins.set(manifest.id,{ manifest, entry, status:'disabled', cards:[], pending:new Map(), failures:0, enabled:store.get('host',manifest.id+'.enabled',false), config:store.get('host',manifest.id+'.config',manifest.defaults ?? {}) });
      } catch (e) { console.error(`Plugin ${folder.name}: ${e.message}`); }
    }
  }
  start() { for (const p of this.plugins.values()) if (p.enabled) this.launch(p); }
  launch(p) {
    if (this.closed || !p.enabled || p.child) return;
    p.status='starting'; p.error=null; this.changed();
    const child = spawn(process.execPath,[p.entry], { cwd:resolve(p.entry,'..'), stdio:['pipe','pipe','pipe'], env:{ PATH:process.env.PATH, LANG:'en_US.UTF-8', TZ:process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone, NODE_NO_WARNINGS:'1' } });
    p.child=child; p.lastPong=Date.now(); let buffer='';
    const write = m => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(m)+'\n'); };
    p.write=write;
    const fail = reason => { p.error=reason; child.kill(); };
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer)>MAX_MESSAGE_BYTES) return fail('Plugin message too large');
      let newline;
      while ((newline=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,newline); buffer=buffer.slice(newline+1);
        try {
          const m=JSON.parse(line);
          if (m.type==='ready') {
            if (m.id!==p.manifest.id || m.apiVersion!==API_VERSION) throw new Error('Invalid handshake');
            p.status='running'; clearTimeout(p.startTimer); this.changed();
          } else if (m.type==='pong') p.lastPong=Date.now();
          else if (p.status!=='running') throw new Error('Message before handshake');
          else if (m.type==='cards') { p.cards=validateCards(m.cards,p.manifest); this.changed(); }
          else if (m.type==='state') this.store.set(p.manifest.id,'state',m.state);
          else if (m.type==='response') {
            const wait=p.pending.get(m.id); if (wait) { clearTimeout(wait.timer); p.pending.delete(m.id); m.error ? wait.reject(new Error(m.error)) : wait.resolve(m.result); }
          } else throw new Error('Invalid plugin message');
        } catch (e) { fail(e.message); return; }
      }
    });
    // Do not expose plugin stderr or event payloads to the phone.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', e => { p.error=e.message; });
    p.startTimer=setTimeout(()=>fail('Plugin startup timed out'),5000);
    p.pulse=setInterval(()=> {
      if (Date.now()-p.lastPong>15000) fail('Plugin heartbeat timed out'); else write({type:'ping'});
    },5000);
    child.on('exit', () => {
      clearTimeout(p.startTimer); clearInterval(p.pulse); p.child=null;
      for (const wait of p.pending.values()) { clearTimeout(wait.timer); wait.reject(new Error('Plugin stopped')); }
      p.pending.clear();
      if (!p.enabled || this.closed) p.status='disabled';
      else {
        p.status='error'; p.error ??= 'Plugin exited'; p.failures++;
        if (p.failures<=3) p.restart=setTimeout(()=>this.launch(p),1000*2**p.failures);
      }
      this.changed();
    });
    write({ type:'init',apiVersion:API_VERSION,state:this.store.get(p.manifest.id,'state',{}),config:p.config });
  }
  describe() { return [...this.plugins.values()].map(p=>({ ...p.manifest, enabled:p.enabled,status:p.status,error:p.error,config:p.config,cardCount:p.cards.length })); }
  cards() { return [...this.plugins.values()].filter(p=>p.enabled).flatMap(p=>p.cards.map(c=>({...c,pluginId:p.manifest.id,pluginStatus:p.status}))); }
  get(id) { const p=this.plugins.get(id); if (!p) throw new Error('Unknown plugin'); return p; }
  request(id, method, params) {
    const p=this.get(id);
    if (p.status!=='running') return Promise.reject(new Error('Plugin is not running'));
    return new Promise((resolve,reject)=> {
      const requestId=++this.nextId;
      const timer=setTimeout(()=>{p.pending.delete(requestId); reject(new Error('Plugin request timed out'));},4000);
      p.pending.set(requestId,{resolve,reject,timer}); p.write({type:'request',id:requestId,method,params});
    });
  }
  async configure(id,{enabled,config}) {
    const p=this.get(id);
    if (config!==undefined) {
      if (!config || typeof config!=='object' || Array.isArray(config)) throw new Error('Invalid configuration');
      for (const [key,schema] of Object.entries(p.manifest.configSchema ?? {})) {
        const value=config[key];
        if (value===undefined || typeof value!==schema.type || (schema.enum && !schema.enum.includes(value))) throw new Error(`Invalid configuration: ${key}`);
      }
      if (p.status==='running') await this.request(id,'configure',config);
      p.config=config; this.store.set('host',id+'.config',config);
    }
    if (typeof enabled==='boolean' && enabled!==p.enabled) {
      p.enabled=enabled; this.store.set('host',id+'.enabled',enabled); clearTimeout(p.restart);
      if (enabled) { p.failures=0; this.launch(p); }
      else { this.stop(p); p.cards=[]; }
    } else if (enabled && p.status==='error') { p.failures=0; clearTimeout(p.restart); this.launch(p); }
    this.changed();
  }
  stop(p) {
    if (p.child) { const child=p.child; p.write({type:'stop'}); const timer=setTimeout(()=>child.kill('SIGKILL'),1000); timer.unref(); child.once('exit',()=>clearTimeout(timer)); }
    p.status='disabled';
  }
  async close() {
    this.closed=true;
    await Promise.all([...this.plugins.values()].map(p=>new Promise(resolve=>{
      clearTimeout(p.restart);
      if (!p.child) return resolve();
      p.child.once('exit',resolve); this.stop(p);
    })));
  }
}
