import { runPlugin } from '../../sdk/plugin.mjs';
import { readFileSync } from 'node:fs';
import { applyEvent,agentCards } from './state.mjs';
const manifest=JSON.parse(readFileSync(new URL('./plugin.json',import.meta.url)));
runPlugin(manifest,ctx=> {
  const sessions=ctx.state.sessions??{};
  // Restored state must not imply that an old running session is still live.
  for (const s of Object.values(sessions)) s.lastSeen=0;
  const publish=()=>ctx.publish(agentCards(sessions)); let timer;
  return {start(){publish();timer=setInterval(publish,10000);},event(e){const changed=applyEvent(sessions,e); ctx.save({sessions}); if (changed) publish(); return {ok:true};},stop(){clearInterval(timer);}};
});
