const order=['waiting','error','running','completed','unknown','idle'];
export function displayCards(cards,plugins=[]){
 const agentCards=cards.filter(c=>c.pluginId==='agents');const result=cards.filter(c=>c.pluginId!=='agents');
 const agentPlugin=plugins.find(p=>p.id==='agents');
 if(agentCards.length||agentPlugin){
  const tools=new Map();for(const c of agentCards){const name=c.subtitle==='Codex 桌面版'?'Codex':c.subtitle??'Agent';const status=c.pluginStatus==='running'?c.status:'error';const previous=tools.get(name);if(!previous||order.indexOf(status)<order.indexOf(previous))tools.set(name,status);}
  const overall=order.find(s=>[...tools.values()].includes(s))??(agentPlugin?.status==='running'?'idle':'unknown');
  result.unshift({id:'agent-summary',pluginId:'agents',type:'agent-summary',title:'Agent',status:overall,tools:[...tools].map(([name,status])=>({name,status})),pluginStatus:agentPlugin?.status??agentCards[0]?.pluginStatus??'running'});
 }
 for(const plugin of plugins)if(plugin.id!=='agents'&&!result.some(c=>c.pluginId===plugin.id))result.push({id:plugin.id+'-empty',pluginId:plugin.id,type:'text',title:plugin.name??plugin.id,text:plugin.status==='starting'?'正在加载':'暂无数据',pluginStatus:plugin.status,updatedAt:Date.now()});
 return result;
}
