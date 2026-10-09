import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createDeck } from './server.mjs';
const args=process.argv.slice(2);
const option=(key,fallback)=>{const i=args.indexOf('--'+key);return i<0?fallback:args[i+1];};
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
try {
  const deck=await createDeck({root,dataDir:option('data',join(homedir(),'Library/Application Support/AgentDeck')),host:option('host','127.0.0.1'),port:Number(option('port','43120')),cert:option('cert'),key:option('key')});
  // Credentials are in runtime.json (0600), never stdout or an unauthenticated endpoint.
  console.log(JSON.stringify({type:'ready',url:deck.runtime.baseURL}));
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await deck.close();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
} catch(e) {console.error(e.message);process.exit(1);}
