import test from 'node:test';import assert from 'node:assert/strict';import {displayCards} from '../web/display-model.mjs';
test('all sessions share one Agent card, retain tool status only, and keep other plugins',()=>{const cards=[{pluginId:'agents',subtitle:'pi',status:'running',pluginStatus:'running',summary:'private'},{pluginId:'agents',subtitle:'pi',status:'completed',pluginStatus:'running'},{pluginId:'agents',subtitle:'Codex',status:'waiting',pluginStatus:'running',title:'project'},{pluginId:'todo',type:'list',items:[]}];const result=displayCards(cards);assert.equal(result.length,2);assert.equal(result[0].status,'waiting');assert.deepEqual(result[0].tools,[{name:'pi',status:'running'},{name:'Codex',status:'waiting'}]);assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(JSON.stringify(result).includes('project'),false);});
test('enabled Agent plugin remains visible with no sessions',()=>{assert.equal(displayCards([],[{id:'agents',status:'running'}])[0].status,'idle');assert.equal(displayCards([]).length,0);});
test('every visible plugin gets a cell while loading before its first data',()=>{const result=displayCards([],[{id:'clock',name:'时钟',status:'starting'},{id:'agents',status:'running'}]);assert.deepEqual(result.map(c=>c.pluginId),['agents','clock']);assert.equal(result[1].text,'正在加载');});
test('working session tokens aggregate while account limits use the newest snapshot',()=>{
 const now=Date.now();const card=(id,status,tokens,usedPercent,offset)=>({id,pluginId:'agents',subtitle:'Codex',pluginStatus:'running',status,updatedAt:now+offset,usage:{updatedAt:now+offset,sessionTokens:tokens,windows:[{id:'primary',usedPercent,resetsAt:now+3600000,windowMinutes:300}]}});
 const tools=displayCards([card('a','running',100,10,0),card('b','waiting',200,20,1),card('old','completed',999,30,2)])[0].tools;
 assert.equal(tools[0].usage.sessionTokens,300);assert.equal(tools[0].usage.sessionLabel,'2 个工作会话');assert.equal(tools[0].usage.windows[0].usedPercent,30);
 const incomplete=displayCards([card('a','running',100,10,0),{pluginId:'agents',subtitle:'Codex',status:'running',pluginStatus:'running',updatedAt:now}])[0].tools[0].usage;
 assert.equal(incomplete.sessionTokens,undefined);
});
test('different tools never share their account quota',()=>{
 const cards=['Claude Code','Codex','pi'].map((subtitle,i)=>({pluginId:'agents',subtitle,status:'running',pluginStatus:'running',updatedAt:100,usage:{updatedAt:100,sessionTokens:10,windows:i===2?[]:[{id:'primary',usedPercent:10+i*20,resetsAt:1000}]}}));
 const tools=displayCards(cards)[0].tools;assert.equal(tools[0].usage.windows[0].usedPercent,10);assert.equal(tools[1].usage.windows[0].usedPercent,30);assert.deepEqual(tools[2].usage.windows,[]);
});
