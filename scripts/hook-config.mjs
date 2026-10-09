// Generate a reviewed config fragment; do not mutate ~/.claude or ~/.codex.
import { fileURLToPath } from 'node:url';
const source=process.argv[2];
if (!['claude','codex'].includes(source)) { console.error('Usage: node scripts/hook-config.mjs claude|codex'); process.exit(1); }
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const helper=fileURLToPath(new URL('../integrations/hook.mjs',import.meta.url));
const command=`${quote(process.execPath)} ${quote(helper)} ${source}`;
const names=source==='claude'?['SessionStart','SessionEnd','UserPromptSubmit','PermissionRequest','PostToolUse','PostToolUseFailure','Stop','StopFailure','Notification']:['SessionStart','UserPromptSubmit','PermissionRequest','Stop'];
const hooks=Object.fromEntries(names.map(name=>[name,[{hooks:[{type:'command',command,timeout:2}]}]]));
console.log(JSON.stringify({hooks},null,2));
