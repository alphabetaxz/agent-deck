const mode=document.body.dataset.mode;
const $=id=>document.getElementById(id);
let state=null, stream=null, retry=null, lastSeen=null, wakeLock=null;
const statuses={idle:'空闲',running:'工作中',waiting:'等待你处理',completed:'本轮完成',error:'异常',unknown:'状态未知'};
function el(tag,text,className) {const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}
function notice(message) {$('notice').hidden=!message;$('notice').textContent=message??'';}
async function api(path,data) {
  const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const result=await response.json();if(!response.ok){const e=new Error(result.error??'操作失败');e.status=response.status;throw e;}return result;
}
function button(text,action,className='secondary') {const b=el('button',text,className);b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await action();notice('');}catch(e){notice(e.message);}finally{b.disabled=false;}});return b;}
function renderCards(cards) {
  const container=$('cards');container.replaceChildren();
  if (!cards.length) {container.append(el('div',mode==='admin'?'启用插件后，卡片会显示在这里。Agent 会话需要先配置接入。':'暂无显示内容，请在 Mac 端启用插件并选择卡片。','empty'));return;}
  for (const c of cards) {
    const card=el('article',null,'card');card.append(el('div',c.subtitle??c.pluginId,'card-subtitle'));
    const head=el('div',null,'card-top');head.append(el('h3',c.title));
    if(c.type==='status')head.append(el('span',statuses[c.status],`status ${c.status}`));card.append(head);
    if(c.pluginStatus!=='running')card.append(el('p','插件暂不可用 · 以下为最后数据'));
    if(c.type==='status')card.append(el('p',c.summary));
    if(c.type==='text')card.append(el('p',c.text));
    if(c.type==='metric'){const value=el('div',c.value,'metric');value.append(el('small',c.unit??''));card.append(value);}
    if(c.type==='list') {
      const list=el('ul',null,'checklist');
      for(const item of c.items){const li=el('li');li.append(el('span',item.done?'✓':'○','check'),el('span',item.title,item.done?'done':''));list.append(li);}
      if(!c.items.length)list.append(el('li','今天还没有待办。'));card.append(list);
    }
    const time=el('time',new Date(c.updatedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' 更新');time.dateTime=new Date(c.updatedAt).toISOString();card.append(time);container.append(card);
  }
}
const todoAction=(action,params)=>api('/api/actions',{pluginId:'todo',action,params});
let todoFingerprint='';
function renderTodos() {
  const p=state.plugins.find(p=>p.id==='todo');$('todo-form').hidden=p?.status!=='running';
  // Todo editor must remain visible even if its display card is hidden in the preview layout.
  const card=state.allCards?.find(c=>c.pluginId==='todo')??state.cards.find(c=>c.pluginId==='todo');
  const fingerprint=JSON.stringify({status:p?.status,enabled:p?.enabled,items:card?.items});if(fingerprint===todoFingerprint)return;todoFingerprint=fingerprint;
  const container=$('todo-editor');container.replaceChildren();
  if(!p?.enabled){container.append(el('p','请先启用「今日待办」插件。','muted'));return;}
  if(p.status!=='running'){container.append(el('p','待办插件暂不可用，请检查插件状态。','muted'));return;}
  for(const item of card?.items??[]) {
    const row=el('div',null,'todo-row');
    const check=document.createElement('input');check.type='checkbox';check.checked=item.done;check.setAttribute('aria-label',`完成 ${item.title}`);
    check.addEventListener('change',async()=>{check.disabled=true;try{await todoAction('toggle',{id:item.id});}catch(e){check.checked=!check.checked;notice(e.message);check.disabled=false;}});
    const title=el('span',item.title,'todo-name'+(item.done?' done':''));row.append(check,title);
    row.append(button('↑',()=>todoAction('move',{id:item.id,direction:-1}),'icon-button'),button('↓',()=>todoAction('move',{id:item.id,direction:1}),'icon-button'));
    row.append(button('编辑',async()=> {
      const input=document.createElement('input');input.value=item.title;input.maxLength=500;input.setAttribute('aria-label','编辑待办');title.replaceWith(input);input.focus();
      const save=button('保存',async()=>{await todoAction('edit',{id:item.id,title:input.value});todoFingerprint='';renderTodos();},'secondary');
      const cancel=button('取消',()=>{todoFingerprint='';renderTodos();},'icon-button');row.append(save,cancel);
    },'icon-button'));
    row.append(button('删除',()=>todoAction('delete',{id:item.id}),'icon-button'));container.append(row);
  }
}
let pluginFingerprint='',deviceFingerprint='',layoutFingerprint='';
function renderPlugins() {
  const fingerprint=JSON.stringify(state.plugins);if(fingerprint===pluginFingerprint)return;pluginFingerprint=fingerprint;
  const container=$('plugin-list');container.replaceChildren();
  for(const p of state.plugins) {
    const panel=el('article',null,'plugin');const head=el('header');head.append(el('h3',p.name),button(p.enabled?'停用':'启用',()=>api('/api/plugins',{id:p.id,enabled:!p.enabled}),p.enabled?'secondary':''));panel.append(head);
    panel.append(el('small',`${p.version} · ${p.status==='running'?'运行中':p.status==='disabled'?'已停用':p.status==='starting'?'启动中':'异常'}`));
    panel.append(el('small','权限声明：'+(p.permissions.join('、')||'无')));
    if(p.error){panel.append(el('p',p.error,'muted'));panel.append(button('重新启动',()=>api('/api/plugins',{id:p.id,enabled:true})));}
    for(const [key,schema] of Object.entries(p.configSchema??{})) {
      if(schema.enum){const label=el('label',key==='format'?'时间格式':key);const select=document.createElement('select');select.setAttribute('aria-label',`${p.name} ${key}`);for(const value of schema.enum){const option=el('option',value);option.value=value;select.append(option);}select.value=p.config[key];select.addEventListener('change',async()=>{try{await api('/api/plugins',{id:p.id,config:{...p.config,[key]:select.value}});}catch(e){notice(e.message);}});label.append(select);panel.append(label);}
    }
    container.append(panel);
  }
}
function renderDevices() {
  const fingerprint=JSON.stringify(state.devices);if(fingerprint!==deviceFingerprint){deviceFingerprint=fingerprint;const container=$('device-list');container.replaceChildren();
    if(!state.devices.length)container.append(el('p','尚未配对手机。你可以先打开本机显示预览。','muted'));
    const selected=$('layout-device').value;$('layout-device').replaceChildren();const preview=el('option','本机预览');preview.value='preview';$('layout-device').append(preview);
    for(const d of state.devices){const row=el('div',null,'device');const info=el('div',d.name);info.append(el('small','配对于 '+new Date(d.createdAt).toLocaleDateString()));row.append(info,button('撤销配对',()=>api('/api/devices/revoke',{id:d.id}),'secondary'));container.append(row);const option=el('option',d.name);option.value=d.id;$('layout-device').append(option);}
    if([...$('layout-device').options].some(x=>x.value===selected))$('layout-device').value=selected;
  }
  renderLayout();
}
function renderLayout() {
  const deviceId=$('layout-device').value,hidden=state.layouts[deviceId]?.hidden??[];
  const fingerprint=JSON.stringify({deviceId,hidden,ids:state.plugins.map(p=>p.id)});if(fingerprint===layoutFingerprint)return;layoutFingerprint=fingerprint;
  const container=$('layout-options');container.replaceChildren();
  for(const p of state.plugins){const label=el('label');const check=document.createElement('input');check.type='checkbox';check.checked=!hidden.includes(p.id);check.addEventListener('change',async()=>{const next=new Set(state.layouts[deviceId]?.hidden??[]);check.checked?next.delete(p.id):next.add(p.id);try{await api('/api/layout',{deviceId,hidden:[...next]});}catch(e){notice(e.message);}});label.append(check,document.createTextNode(' '+p.name));container.append(label);}
}
function render(snapshot) {
  state=snapshot;lastSeen=Date.now();$('connection').textContent='已连接';if($('connection-dot'))$('connection-dot').style.background='var(--accent)';
  if($('pair-screen'))$('pair-screen').hidden=true;renderCards(state.cards);
  if(mode==='admin'){
    const agents=(state.allCards??state.cards).filter(c=>c.type==='status');const todos=(state.allCards??state.cards).find(c=>c.pluginId==='todo')?.items??[];
    const summary=$('summary');summary.replaceChildren();for(const [label,value] of [['Agent 工作中',agents.filter(c=>c.status==='running').length],['等待你处理',agents.filter(c=>c.status==='waiting').length],['今日待办',`${todos.filter(t=>t.done).length} / ${todos.length}`]]){const box=el('div');box.append(el('span',label),el('b',String(value)));summary.append(box);}
    renderTodos();renderPlugins();renderDevices();
  } else $('last-update').textContent='最后同步 '+new Date(lastSeen).toLocaleTimeString('zh-CN',{hour12:false});
}
async function connect() {
  clearTimeout(retry);stream?.close();
  try{render(await api('/api/snapshot'));notice('');}
  catch(e){$('connection').textContent='未连接';if(e.status===401&&mode==='display'){$('pair-screen').hidden=false;$('cards').replaceChildren();return;}notice(e.message);retry=setTimeout(connect,4000);return;}
  stream=new EventSource('/api/events');stream.addEventListener('snapshot',event=>{try{const incoming=JSON.parse(event.data);if(state&&incoming.sequence<state.sequence)return;render(incoming);notice('');}catch{notice('收到无效数据，正在重新同步');stream.close();retry=setTimeout(connect,1000);}});
  stream.onerror=()=>{$('connection').textContent='离线 · 重连中';if($('connection-dot'))$('connection-dot').style.background='var(--amber)';notice('与 Mac 的连接已中断。当前显示的是最后同步的数据。');stream.close();retry=setTimeout(connect,3000);};
}
if(mode==='admin') {
  $('todo-form').addEventListener('submit',async e=>{e.preventDefault();const input=$('todo-title');try{await todoAction('add',{title:input.value});input.value='';notice('');}catch(e){notice(e.message);}});
  $('pair-button').addEventListener('click',async()=>{try{const pair=await api('/api/pair/create',{});const panel=$('pair-info');panel.replaceChildren(el('p','配对码 · 2 分钟有效'),el('strong',pair.code),el('p','在手机浏览器打开：'+pair.url),el('p',pair.lan?'手机与 Mac 应在同一局域网，并信任部署所用证书。':'当前仅运行本机预览。连接真实手机需要启用已配置 TLS 的局域网服务。','muted'));panel.hidden=false;}catch(e){notice(e.message);}});
  $('layout-device').addEventListener('change',renderLayout);
} else {
  $('pair-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/pair',{code:$('pair-code').value,name:$('device-name').value});await connect();}catch(e){notice(e.message);}});
  $('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else notice('当前浏览器不支持全屏，请使用系统或浏览器的全屏选项。');}catch{notice('无法进入全屏，请检查浏览器设置。');}});
  async function acquireWake(){if(!navigator.wakeLock){notice('当前浏览器无法保持亮屏。请在 Android 设置中调整休眠时间。');return;}try{wakeLock=await navigator.wakeLock.request('screen');$('wake').textContent='亮屏已开启';wakeLock.addEventListener('release',()=>{$('wake').textContent='保持亮屏';});}catch{notice('无法保持亮屏，请检查设备设置。');}}
  $('wake').addEventListener('click',acquireWake);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&wakeLock)acquireWake();});
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!stream)connect();});
connect();
