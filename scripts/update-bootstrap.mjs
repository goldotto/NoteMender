// This bootstrap intentionally imports only Node built-ins, so interrupted app replacement cannot break recovery.
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=path.join(root,'runtime/updates');
try{
  for(const p of [path.join(root,'runtime'),dir])try{if((await lstat(p)).isSymbolicLink())throw Error('更新恢复目录不能使用链接');}catch(e){if(e.code!=='ENOENT')throw e;}
  let pending;try{pending=await readFile(path.join(dir,'pending.json'),'utf8');}catch(e){if(e.code==='ENOENT')process.exit(0);throw e;}
  const p=JSON.parse(pending);if(!/^[a-f0-9-]{36}$/.test(p.id))throw Error('更新恢复索引无效');
  let running=false;try{const pid=Number(await readFile(path.join(dir,'install.lock'),'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw Error('更新锁记录无效');try{process.kill(pid,0);running=true;}catch(e){if(e.code!=='ESRCH')throw e;}}catch(e){if(e.code!=='ENOENT')throw e;}
  if(running)throw Error('更新仍在进行，请稍后重新启动');
  const task=path.join(dir,p.id);if((await lstat(task)).isSymbolicLink()||await realpath(task)!==task)throw Error('更新任务目录无效');
  const requestFile=path.join(task,'request.json'),config=JSON.parse(await readFile(requestFile,'utf8'));if(path.resolve(config.root)!==root)throw Error('更新恢复目标不符');config.recover=true;await writeFile(requestFile,JSON.stringify(config));
  const result=spawnSync(process.execPath,[path.join(dir,p.id,'update-runner.mjs')],{cwd:path.join(dir,p.id),windowsHide:true,stdio:'inherit',env:process.env});if(result.error||result.status)throw Error('更新恢复失败，请保留 runtime/updates 目录并反馈');
}catch(e){console.error('更新恢复未完成，请保留 runtime/updates 目录：'+e.message);process.exitCode=1;}
