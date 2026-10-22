import {readFile,open,unlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {installTransaction,rollbackTransaction,atomicJSON,appendHistory,launchServer,sleep,preflight,pruneUpdates,updatePath} from './update-install.mjs';
import {verifyEnvelope} from './update-security.mjs';

export async function runUpdate(directory,{healthAttempts=150,healthInterval=400,exitAttempts=100}={}){
  const config=JSON.parse(await readFile(path.join(directory,'request.json'),'utf8')),root=await realpath(config.root),port=config.port,trust=config.trust,envelope=config.envelope;
  const id=path.basename(directory);if(!/^[a-f0-9-]{36}$/.test(id)||path.resolve(directory)!==await updatePath(root,id)||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(config.pid)||config.pid<=0)throw Error('更新恢复配置无效');
  const target=verifyEnvelope(envelope,trust),journal=path.join(directory,'transaction.json'),lockPath=await updatePath(root,'install.lock'),expectedInstance=createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0,16);
  let lock,terminal=false,child=null,phase='等待原服务退出',outcome='failed';
  const readTransaction=async()=>{try{return JSON.parse(await readFile(journal,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  async function stopChild(){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(5000)]);if(child.exitCode===null&&child.signalCode===null)throw Error('新服务尚未退出，保留事务以便恢复');}
  async function startIfAbsent(){try{const r=await fetch(`http://127.0.0.1:${port}/api/status`,{signal:AbortSignal.timeout(1000)});const s=await r.json();if(s.instance!==expectedInstance)throw Error('原端口被其他程序占用');return;}catch(e){if(e.message==='原端口被其他程序占用')throw e;}child=launchServer(root,port);}
  const log=async(result,reason='')=>appendHistory(root,{at:new Date().toISOString(),from:config.current,to:{version:target.version,build:target.build},result,phase,reason:String(reason).replace(/[A-Za-z]:[\\/][^\r\n]*/g,'[本机路径]')});
  try{
    try{const pid=Number(await readFile(lockPath,'utf8'));if(!Number.isInteger(pid)||pid<=0)throw Error('更新锁无效，请保留更新目录并反馈');try{process.kill(pid,0);throw Error('另一个更新进程仍在运行');}catch(e){if(e.code!=='ESRCH')throw e;}await unlink(lockPath);}catch(e){if(e.code!=='ENOENT')throw e;}
    lock=await open(lockPath,'wx');await lock.writeFile(String(process.pid));await lock.sync();
    // Never kill a process that might be unrelated. A blocked exit leaves program files unchanged.
    let exited=false;for(let i=0;i<exitAttempts;i++){try{process.kill(config.pid,0);}catch(e){if(e.code==='ESRCH'){exited=true;break;}throw e;}await sleep(200);}if(!exited)throw Error('原服务尚未退出，未修改程序');
    let tx=await readTransaction();
    if(config.recover&&(!tx||tx.state==='preparing')){phase='恢复准备中断';terminal=true;await log('failed','安装准备中断，程序文件未变更');await startIfAbsent();}
    else if(tx&&['replacing','rolling-back','awaiting-health'].includes(tx.state)){phase='恢复中断安装';verifyEnvelope(tx.from,trust);await rollbackTransaction(root,directory,tx);terminal=true;outcome='rolled-back';await log(outcome,'检测到上次安装中断，已恢复原程序');await startIfAbsent();}
    else if(tx&&['complete','rolled-back'].includes(tx.state)){terminal=true;outcome=tx.state==='complete'?'success':'rolled-back';await startIfAbsent();}
    else if(tx)throw Error('安装事务状态无法确认，保留恢复副本');
    else{
      phase='安装预检';await preflight(root,target,trust,config.current);
      phase='替换程序';tx=await installTransaction(root,directory,envelope,trust);
      phase='启动与工作恢复';child=launchServer(root,port);let healthy=false;
      for(let i=0;i<healthAttempts;i++){await sleep(healthInterval);if(child.exitCode!==null||child.signalCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/status`,{signal:AbortSignal.timeout(900)}),s=await r.json();if(r.ok&&s.instance===expectedInstance&&s.build===target.build&&s.version===target.version){const h=await fetch(`http://127.0.0.1:${port}/api/updates/restore-status`,{headers:{'X-Studio-Token':s.token},signal:AbortSignal.timeout(900)});if(h.ok&&(await h.json()).ready){healthy=true;break;}}}catch{}}
      if(!healthy)throw Error('新程序启动或工作恢复检查未通过');
      tx.state='complete';await atomicJSON(journal,tx);terminal=true;outcome='success';await log(outcome);await pruneUpdates(root,id,trust).catch(()=>{});
    }
  }catch(error){
    // Without ownership of the lock, leave the other installer and its records completely alone.
    if(!lock)throw error;
    let reason=error.message;const tx=await readTransaction().catch(()=>({state:'unknown'}));
    try{
      if(tx&&['replacing','rolling-back','awaiting-health'].includes(tx.state)){await stopChild();verifyEnvelope(tx.from,trust);await rollbackTransaction(root,directory,tx);terminal=true;outcome='rolled-back';reason+='；已回退原程序';}
      else if(!tx||['preparing','rolled-back','complete'].includes(tx.state)){terminal=true;outcome=tx?.state==='rolled-back'?'rolled-back':'failed';}
      if(terminal)await startIfAbsent();
    }catch(recoveryError){terminal=false;reason+='；恢复未完成：'+recoveryError.message;}
    await log(terminal?outcome:'failed',reason).catch(()=>{});
    if(!terminal)throw Error('更新恢复未完成，请保留 runtime/updates 并重新运行启动程序');
  }finally{
    if(lock){await lock.close();await unlink(lockPath).catch(()=>{});if(terminal)await unlink(await updatePath(root,'pending.json')).catch(()=>{});}
  }
  return {result:outcome};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await runUpdate(path.dirname(fileURLToPath(import.meta.url)));}catch(error){console.error(error.message);process.exitCode=1;}
}
