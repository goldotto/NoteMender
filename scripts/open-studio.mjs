import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureStudioServer,openStudioPage} from './local-server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=await ensureStudioServer(root);
try{await openStudioPage(`http://127.0.0.1:${port}/`);}catch(error){console.error(error.message);process.exitCode=1;}
