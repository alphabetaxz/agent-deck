import http from 'node:http';
import QRCode from 'qrcode';
import https from 'node:https';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { PluginHost } from './plugins.mjs';
import { CodexDesktopObserver } from './codex-desktop.mjs';
import { IntegrationManager } from './integrations.mjs';
import { Store } from './store.mjs';
import { MAX_MESSAGE_BYTES } from './protocol.mjs';

const token=()=>randomBytes(32).toString('hex');
const equal=(a,b)=>typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req) {
  let value='';
  for await (const chunk of req) { value+=chunk.toString(); if (Buffer.byteLength(value)>MAX_MESSAGE_BYTES) { const e=new Error('Request too large');e.status=413;throw e; } }
  try { return JSON.parse(value); } catch { const e=new Error('Invalid JSON');e.status=400;throw e; }
}
export async function createDeck({root,dataDir,host='127.0.0.1',port=43120,cert,key,integrationOptions={},devicePort=43121}) {
  const tls=!!(cert&&key);
  if (!['127.0.0.1','::1','localhost'].includes(host) && !tls) throw new Error('LAN mode requires TLS: provide --cert and --key');
  const store=new Store(join(dataDir,'deck.sqlite'));
  const admin=token(), hookToken=store.get('core','hookToken')??token();store.set('core','hookToken',hookToken);
  let login=token(), pair=null, sequence=0, closing=false;
  let deviceServer=null;
  const lanAddresses=()=>Object.entries(networkInterfaces()).flatMap(([name,entries])=>entries.filter(x=>x.family==='IPv4'&&!x.internal&&!/^(utun|tun|tap|lo)/.test(name)).map(x=>({address:x.address,name}))).sort((a,b)=>Number(!/^en/.test(a.name))-Number(!/^en/.test(b.name)));
  const networkStatus=()=>({enabled:!!deviceServer,port:deviceServer?.address()?.port??null,addresses:lanAddresses(),encrypted:tls});
  const streams=new Set(), pairAttempts=new Map();
  let devices=store.get('core','devices',[]);
  let layouts=store.get('core','layouts',{});
  const desktop=new CodexDesktopObserver({store,home:integrationOptions.home,env:integrationOptions.env,appPaths:integrationOptions.appPaths,onStatus:()=>{if(!closing)publish();},isReady:()=>hostPlugins.get('agents').status==='running',onEvent:async event=>{await hostPlugins.request('agents','event',event);publish();},onRemove:async()=>{if(hostPlugins.get('agents').status==='running')await hostPlugins.request('agents','action',{action:'clearDesktop'});else{const state=store.get('agents','state',{sessions:{}});for(const [id,session] of Object.entries(state.sessions??{}))if(session.client==='desktop')delete state.sessions[id];store.set('agents','state',state);}}});
  const integrations=new IntegrationManager({root,dataDir,...integrationOptions,desktop});
  await integrations.refresh();
  const hostPlugins=new PluginHost(join(root,'plugins'),store,()=>{if (!closing) publish();});
  const displaySnapshot=(device)=> {
    const hidden=layouts[device?.id??'preview']?.hidden??[];
    return {apiVersion:1,sequence,serverTime:Date.now(),cards:hostPlugins.cards().filter(c=>!hidden.includes(c.pluginId)),displayPlugins:hostPlugins.describe().filter(p=>p.enabled&&!hidden.includes(p.id)).map(p=>({id:p.id,name:p.name,status:p.status})),layout:layouts[device?.id??'preview']??{hidden:[]}};
  };
  const adminSnapshot=()=>({...displaySnapshot(null),allCards:hostPlugins.cards(),integrations:integrations.status(),network:networkStatus(),plugins:hostPlugins.describe(),devices:devices.map(({credential,...d})=>d),layouts,connection:{host,port:server.address()?.port??port,tls,lan:!['127.0.0.1','::1','localhost'].includes(host)}});
  function publish() {
    sequence++;
    for (const s of streams) {
      if (s.device && !devices.some(d=>d.id===s.device.id)) { s.res.end(); streams.delete(s); continue; }
      if (s.res.writableLength>1024*1024) {s.res.destroy();streams.delete(s);continue;}
      s.res.write(`id: ${sequence}\nevent: snapshot\ndata: ${JSON.stringify(s.admin?adminSnapshot():displaySnapshot(s.device))}\n\n`);
    }
  }
  const adminAuth=req=>equal(req.headers.authorization?.replace(/^Bearer /,''),admin)||equal((req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('deck_admin='))?.slice(11),admin);
  const deviceAuth=req=> {
    const credential=req.headers.authorization?.replace(/^Bearer /,'')??(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('deck_device='))?.slice(12);
    return devices.find(d=>equal(d.credential,credential));
  };
  function originOK(req) {
    if (req.headers.authorization) return !req.headers.origin || req.headers.origin===`${tls?'https':'http'}://${req.headers.host}`;
    return req.headers.origin===`${tls?'https':'http'}://${req.headers.host}`;
  }
  const cookie=(name,value)=>`${name}=${value}; HttpOnly; SameSite=Strict; Path=/;${tls?' Secure;':''}`;
  async function handle(req,res,deviceOnly=false) {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control','no-store');
    try {
      const url=new URL(req.url,'http://localhost'), path=url.pathname;
      if(deviceOnly&&!['/','/display','/display-model.mjs','/display-shared.js','/display.js','/display.css','/app.js','/style.css','/api/pair','/api/snapshot','/api/events'].includes(path))return json(res,403,{error:'此端口仅用于手机显示'});
      if (path==='/admin/login' && req.method==='GET') {
        if (!equal(url.searchParams.get('code'),login)) return json(res,401,{error:'登录链接已失效，请重新启动 Mac App'});
        login=token();runtime.adminURL=base+'/admin/login?code='+login;
        writeFileSync(runtimePath,JSON.stringify(runtime),{mode:0o600});
        res.writeHead(303,{'Set-Cookie':cookie('deck_admin',admin),Location:'/admin'});return res.end();
      }
      if (path==='/api/health' && req.method==='GET') return json(res,200,{ok:true,apiVersion:1,pid:process.pid});
      if (path==='/api/pair' && req.method==='POST') {
        if (!originOK(req)) return json(res,403,{error:'Invalid origin'});
        const address=req.socket.remoteAddress;
        if (pairAttempts.size>1000) pairAttempts.clear();
        const attempt=pairAttempts.get(address)??{count:0,start:Date.now()};
        if (Date.now()-attempt.start>60000) {attempt.count=0;attempt.start=Date.now();}
        pairAttempts.set(address,attempt);
        if (++attempt.count>10) return json(res,429,{error:'请稍后再试'});
        const data=await body(req);
        if (!pair || pair.expires<Date.now() || !equal(String(data.code),pair.code)) return json(res,401,{error:'配对码错误或已过期'});
        if (devices.length>=20) return json(res,409,{error:'设备数量已达上限'});
        const d={id:token().slice(0,16),credential:token(),name:typeof data.name==='string'?data.name.slice(0,60):'Android 显示屏',createdAt:Date.now()};
        devices.push(d);store.set('core','devices',devices);pair=null;publish();
        res.setHeader('Set-Cookie',cookie('deck_device',d.credential));return json(res,200,{id:d.id,name:d.name});
      }
      if (path==='/api/hooks' && req.method==='POST') {
        if (!equal(req.headers.authorization?.replace(/^Bearer /,''),hookToken)) return json(res,401,{error:'Unauthorized'});
        if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return json(res,403,{error:'Hooks are local only'});
        const event=await body(req);
        await hostPlugins.request('agents','event',event);integrations.recordEvent(event.source);publish();return json(res,200,{ok:true});
      }
      const isAdmin=!deviceOnly&&adminAuth(req), device=deviceAuth(req);
      if (path.startsWith('/api/')) {
        if (!isAdmin && !device) return json(res,401,{error:'请先配对设备'});
        if (path==='/api/snapshot' && req.method==='GET') return json(res,200,isAdmin?adminSnapshot():displaySnapshot(device));
        if (path==='/api/events' && req.method==='GET') {
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});
          const stream={res,admin:isAdmin,device,deviceOnly};streams.add(stream);
          res.write(`event: snapshot\ndata: ${JSON.stringify(isAdmin?adminSnapshot():displaySnapshot(device))}\n\n`);
          const pulse=setInterval(()=>res.write(': keepalive\n\n'),15000);
          res.on('close',()=>{clearInterval(pulse);streams.delete(stream);});return;
        }
        if (!isAdmin) return json(res,403,{error:'请在 Mac 端管理'});
        if (!originOK(req)) return json(res,403,{error:'Invalid origin'});
        const data=await body(req);
        if (path==='/api/integrations' && req.method==='POST') {
          if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return json(res,403,{error:'请在本机 App 管理接入'});
          if(data.source==='codex-desktop'&&data.action==='install')await hostPlugins.configure('agents',{enabled:true});
          await integrations.change(data.source,data.action);
          if(data.action==='install')await hostPlugins.configure('agents',{enabled:true});
          publish();return json(res,200,{ok:true});
        }
        if (path==='/api/integrations/refresh' && req.method==='POST') {await integrations.refresh();publish();return json(res,200,{ok:true});}
        if (path==='/api/plugins' && req.method==='POST') {await hostPlugins.configure(data.id,data);return json(res,200,{ok:true});}
        if (path==='/api/actions' && req.method==='POST') {const result=await hostPlugins.request(data.pluginId,'action',{action:data.action,params:data.params});return json(res,200,result);}
        if (path==='/api/network' && req.method==='POST') {
          if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return json(res,403,{error:'请在 Mac 本机设置手机连接'});
          if(typeof data.enabled!=='boolean')throw new Error('Invalid network setting');
          if(data.enabled&&!deviceServer){
            const next=tls?https.createServer({cert:readFileSync(cert),key:readFileSync(key)},(req,res)=>handle(req,res,true)):http.createServer((req,res)=>handle(req,res,true));
            next.requestTimeout=10000;next.headersTimeout=10000;
            await new Promise((resolve,reject)=>{next.once('error',reject);next.listen(devicePort,'0.0.0.0',resolve);});deviceServer=next;
          }else if(!data.enabled&&deviceServer){
            pair=null;for(const stream of streams)if(stream.deviceOnly){stream.res.end();streams.delete(stream);}
            const old=deviceServer;deviceServer=null;old.closeAllConnections();await new Promise(resolve=>old.close(resolve));
          }
          store.set('core','deviceNetworkEnabled',data.enabled);publish();return json(res,200,networkStatus());
        }
        if (path==='/api/pair/create' && req.method==='POST') {
          pair={code:String(randomInt(10000000,100000000)),expires:Date.now()+120000};
          const addresses=lanAddresses();
          const address=data.address??addresses[0]?.address;
          if(data.address&&!addresses.some(x=>x.address===data.address))throw new Error('所选网络地址已失效，请重新生成');
          const displayURL=deviceServer&&address?`${tls?'https':'http'}://${address}:${deviceServer.address().port}/display`:null;
          const qrURL=displayURL?displayURL+'#pair='+pair.code:null;
          const qr=qrURL?await QRCode.toDataURL(qrURL,{width:280,margin:4,errorCorrectionLevel:'M'}):null;
          return json(res,200,{...pair,url:displayURL,qr,lan:!!displayURL,encrypted:tls,previewURL:base+'/display'});
        }
        if (path==='/api/devices/revoke' && req.method==='POST') {
          devices=devices.filter(d=>d.id!==data.id);delete layouts[data.id];store.set('core','devices',devices);store.set('core','layouts',layouts);publish();return json(res,200,{ok:true});
        }
        if (path==='/api/layout' && req.method==='POST') {
          if (data.deviceId!=='preview'&&!devices.some(d=>d.id===data.deviceId)) throw new Error('Unknown device');
          if (!Array.isArray(data.hidden) || data.hidden.some(id=>!hostPlugins.plugins.has(id))) throw new Error('Invalid layout');
          layouts[data.deviceId]={hidden:[...new Set(data.hidden)]};store.set('core','layouts',layouts);publish();return json(res,200,{ok:true});
        }
        return json(res,404,{error:'Unknown endpoint'});
      }
      const files={'/':'display.html','/display':'display.html','/admin':'admin.html','/display-model.mjs':'display-model.mjs','/display-shared.js':'display-shared.js','/display.js':'display.js','/display.css':'display.css','/app.js':'app.js','/style.css':'style.css'};
      if (req.method!=='GET' || !files[path]) return json(res,404,{error:'Not found'});
      if (path==='/admin'&&!isAdmin) return json(res,401,{error:'请通过 Mac App 或启动时的管理链接打开'});
      const content=readFileSync(join(root,'web',files[path]));
      const ext=files[path].split('.').pop();res.writeHead(200,{'Content-Type':({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css'})[ext]+'; charset=utf-8'});res.end(content);
    } catch (e) { if (!res.headersSent) json(res,e.status??400,{error:e.message});else res.end(); }
  }
  const server=tls?https.createServer({cert:readFileSync(cert),key:readFileSync(key)},handle):http.createServer(handle);
  server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  const localHost=host==='0.0.0.0'?'127.0.0.1':host;
  const base=`${tls?'https':'http'}://${localHost}:${server.address().port}`;
  const runtime={pid:process.pid,baseURL:base,adminURL:base+'/admin/login?code='+login,hookToken,hookURL:base+'/api/hooks'};
  const runtimePath=join(dataDir,'runtime.json');writeFileSync(runtimePath,JSON.stringify(runtime),{mode:0o600});chmodSync(runtimePath,0o600);
  hostPlugins.start();desktop.start();
  if(store.get('core','deviceNetworkEnabled',false)){
    const next=tls?https.createServer({cert:readFileSync(cert),key:readFileSync(key)},(req,res)=>handle(req,res,true)):http.createServer((req,res)=>handle(req,res,true));
    try{await new Promise((resolve,reject)=>{next.once('error',reject);next.listen(devicePort,'0.0.0.0',resolve);});deviceServer=next;}catch{store.set('core','deviceNetworkEnabled',false);}
  }
  return {server,store,integrations,desktop,plugins:hostPlugins,runtime,publish,async close(){closing=true;await desktop.close();for(const s of streams)s.res.end();await hostPlugins.close();if(deviceServer){deviceServer.closeAllConnections();await new Promise(resolve=>deviceServer.close(resolve));}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();}};
}
