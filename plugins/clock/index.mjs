import { runPlugin } from '../../sdk/plugin.mjs';
import { readFileSync } from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('./plugin.json',import.meta.url)));
runPlugin(manifest,ctx=> {
  let timer;
  const publish=()=>ctx.publish([{id:'time',type:'metric',title:'本地时间',value:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:ctx.config.format==='12h'}),unit:'',subtitle:new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'}),updatedAt:Date.now()}]);
  return {start(){publish();timer=setInterval(publish,10000);},configure:publish,stop(){clearInterval(timer);}};
});
