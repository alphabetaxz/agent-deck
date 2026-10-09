import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
const data=process.argv[2]??join(homedir(),'Library/Application Support/AgentDeck');
const runtime=JSON.parse(readFileSync(join(data,'runtime.json'),'utf8'));
const child=spawn('open',[runtime.adminURL],{stdio:'ignore'});child.on('error',()=>{console.error('Cannot open browser');process.exitCode=1;});
