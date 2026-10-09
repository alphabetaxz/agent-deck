import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]??'dist/Agent Deck.app/Contents/Resources/code');
const {createDeck}=await import(pathToFileURL(join(root,'core/server.mjs')));
const dataDir=mkdtempSync(join(tmpdir(),'agent-deck-bundle-'));
const deck=await createDeck({root,dataDir,port:0,integrationOptions:{home:join(dataDir,'home'),env:{},probe:async()=>({available:false})}});
try{
 const health=await fetch(deck.runtime.baseURL+'/api/health');
 if(!health.ok)throw new Error('Packaged service did not start');
 for(const id of ['agents','todo','clock'])await deck.plugins.configure(id,{enabled:true});
 for(let attempt=0;attempt<100;attempt++){
  if(['agents','todo','clock'].every(id=>deck.plugins.get(id).status==='running'))break;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 if(!['agents','todo','clock'].every(id=>deck.plugins.get(id).status==='running'))throw new Error('Packaged plugins did not start');
 console.log('Bundled Node, core service, and plugins verified');
}finally{await deck.close();rmSync(dataDir,{recursive:true,force:true});}
