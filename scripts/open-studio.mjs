import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureStudioServer,openStudioPage} from './local-server.mjs';
import {access} from 'node:fs/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=await ensureStudioServer(root);
let first=true;try{await access(path.join(root,'runtime','first-run.json'));first=false;}catch{}
try{await openStudioPage(`http://127.0.0.1:${port}/${first?'install.html':''}`);}catch(error){console.error(error.message);process.exitCode=1;}
