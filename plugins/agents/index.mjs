import { runPlugin } from '../../sdk/plugin.mjs';
import { readFileSync } from 'node:fs';
import { applyEvent,agentCards,resetRestoredSessions } from './state.mjs';
const manifest=JSON.parse(readFileSync(new URL('./plugin.json',import.meta.url)));
runPlugin(manifest,ctx=> {
  const sessions=ctx.state.sessions??{};
  // Restored state must not imply that an old running session is still live.
  resetRestoredSessions(sessions);
  const publish=()=>ctx.publish(agentCards(sessions)); let timer;
  return {start(){publish();timer=setInterval(publish,10000);},action({action}){if(action!=='clearDesktop')throw new Error('Unknown action');for(const [id,s] of Object.entries(sessions))if(s.client==='desktop')delete sessions[id];ctx.save({sessions});publish();return {ok:true};},event(e){const changed=applyEvent(sessions,e); ctx.save({sessions}); if (changed) publish(); return {ok:true};},stop(){clearInterval(timer);}};
});
