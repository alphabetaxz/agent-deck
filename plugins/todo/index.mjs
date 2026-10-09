import { randomUUID } from 'node:crypto';
import { runPlugin } from '../../sdk/plugin.mjs';
import { readFileSync } from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('./plugin.json',import.meta.url)));
runPlugin(manifest, ctx=> {
  let items=Array.isArray(ctx.state.items) ? ctx.state.items : [];
  const publish=()=>ctx.publish([{ id:'today',type:'list',title:'今日待办',subtitle:`${items.filter(x=>x.done).length} / ${items.length} 已完成`,updatedAt:Date.now(),items }]);
  const title=v=> { if (typeof v!=='string' || !v.trim() || v.length>500) throw new Error('待办标题需要 1–500 个字符'); return v.trim(); };
  return {
    start:publish,
    action({action,params={}}) {
      if (action==='add') { if (items.length>=500) throw new Error('待办数量已达上限'); items.push({id:randomUUID(),title:title(params.title),done:false,createdAt:Date.now()}); }
      else {
        const index=items.findIndex(x=>x.id===params.id); if (index<0) throw new Error('待办不存在');
        if (action==='toggle') items[index].done=!items[index].done;
        else if (action==='edit') items[index].title=title(params.title);
        else if (action==='delete') items.splice(index,1);
        else if (action==='move') { const to=index+params.direction; if (![1,-1].includes(params.direction)) throw new Error('Invalid move'); if (to>=0 && to<items.length) [items[index],items[to]]=[items[to],items[index]]; }
        else throw new Error('Unknown todo action');
      }
      ctx.save({items}); publish(); return {ok:true};
    },
  };
});
