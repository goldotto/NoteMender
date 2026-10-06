import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {accelerationEnv} from '../src/compute-runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),engine=process.argv[2]||'crepe';
if(!['crepe','demucs'].includes(engine))throw Error('请选择 crepe 或 demucs');
const runtime=await accelerationEnv(root,'cuda');
await new Promise((resolve,reject)=>{const child=spawn(runtime.python,[path.join(root,'scripts/qualify-torch.py'),engine,...process.argv.slice(3)],{cwd:root,windowsHide:true,env:runtime.env,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('显卡检查未完成')));});
