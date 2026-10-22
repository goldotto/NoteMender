import {readFile,writeFile,mkdir,rename,unlink,lstat,statfs,realpath,open,readdir,rmdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeTarget,verifyEnvelope,verifyInstalled,sha256} from './update-security.mjs';
import {readZip} from './update-zip.mjs';
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Only updater-owned data paths may use this helper. Never follow junctions into another directory.
export async function updatePath(root,...parts){
  const base=await realpath(root),segments=['runtime','updates',...parts];let result=base;
  for(const segment of segments){if(typeof segment!=='string'||!segment||segment==='.'||segment==='..'||/[\\/:]/.test(segment))throw Error('更新数据路径无效');result=path.join(result,segment);try{if((await lstat(result)).isSymbolicLink())throw Error('更新数据目录或文件不能是链接');}catch(e){if(e.code!=='ENOENT')throw e;}}
  return result;
}
export async function atomicJSON(file,value){await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';const h=await open(temp,'wx');try{await h.writeFile(JSON.stringify(value,null,2));await h.sync();}finally{await h.close();}try{await rename(temp,file);}catch(e){await unlink(temp).catch(()=>{});throw e;}}
export async function preflight(root,manifest,trust,current,{platform=process.platform,arch=process.arch,diskUsage=statfs}={}){
  if(platform!=='win32'||arch!=='x64'||Number(process.versions.node.split('.')[0])<manifest.minNode)throw Error('运行环境不符合要求，请下载适合的基础程序包');
  const base=await realpath(root);if(base!==path.resolve(root))throw Error('目录链接不支持直接覆盖，请手动更新');
  await updatePath(root);const old=await verifyInstalled(root,trust,current),owned=new Set(old.files.map(f=>f.path));
  try{const lease=JSON.parse(await readFile(path.join(root,'runtime/updates/service.json'),'utf8'));if(lease.pid!==process.pid){try{process.kill(lease.pid,0);throw Error('另一个程序实例正在运行，请关闭后重试');}catch(e){if(e.code!=='ESRCH')throw e;}}}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const f of manifest.files){const target=await safeTarget(root,f.path);try{await lstat(target);if(!owned.has(f.path))throw Error('更新会覆盖未知文件，请另存新版');}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(manifest.remove.some(f=>!owned.has(f)))throw Error('更新试图移除非程序文件');
  const fs=await diskUsage(root),needed=manifest.files.reduce((n,f)=>n+f.size,0)*2+manifest.package.size+32*1024*1024;if(Number(fs.bavail)*Number(fs.bsize)<needed)throw Error('磁盘空间不足，需同时保存更新和回退副本');
  const probe=path.join(root,'.notemender-write-'+randomUUID());try{await writeFile(probe,'',{flag:'wx'});}finally{await unlink(probe).catch(()=>{});}return old;
}
export async function extractVerified(zipFile,manifest,stage){
  const bytes=await readFile(zipFile);if(bytes.length!==manifest.package.size||sha256(bytes)!==manifest.package.sha256)throw Error('更新包大小或 SHA-256 不一致');
  const entries=readZip(bytes,manifest);await mkdir(stage,{recursive:true});
  for(const e of entries){const f=manifest.files.find(f=>f.path===e.path);if(sha256(e.data)!==f.sha256)throw Error('程序文件校验失败');const target=await safeTarget(stage,e.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,e.data,{flag:'wx'});}
  const info=JSON.parse(await readFile(path.join(stage,'public/build-info.json'),'utf8'));if(info.build!==manifest.build||info.version!==manifest.version||info.distribution!=='portable')throw Error('包内构建信息不一致');return entries.length;
}
async function replaceFile(target,bytes,transaction){
  await mkdir(path.dirname(target),{recursive:true});const temp=target+'.nm-update-'+transaction;await writeFile(temp,bytes,{flag:'wx'});try{await rename(temp,target);}catch(e){await unlink(temp).catch(()=>{});throw e;}
}
export async function installTransaction(root,directory,envelope,trust,{fault=()=>{}}={}){
  const m=verifyEnvelope(envelope,trust),stage=path.join(directory,'stage'),backup=path.join(directory,'backup'),file=path.join(directory,'transaction.json');
  const oldReceipt=await readFile(path.join(root,'runtime/updates/installed.json'),'utf8');
  const transaction={id:path.basename(directory),from:JSON.parse(oldReceipt),to:envelope,state:'preparing',items:[],startedAt:new Date().toISOString()};
  await atomicJSON(file,transaction);
  // Back up all targets before changing any of them. A crash during preparation changes no program files.
  for(const name of [...m.files.map(f=>f.path),...m.remove]){
    const target=await safeTarget(root,name);let exists=true;let bytes;try{bytes=await readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;exists=false;}
    if(exists){const dest=await safeTarget(backup,name).catch(async e=>{if(e.code!=='ENOENT')throw e;await mkdir(backup,{recursive:true});return safeTarget(backup,name);});await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes,{flag:'wx'});}
    transaction.items.push({path:name,existed:exists});
  }
  transaction.state='replacing';await atomicJSON(file,transaction);
  try{
    for(const [i,f] of m.files.entries()){const bytes=await readFile(await safeTarget(stage,f.path));if(sha256(bytes)!==f.sha256)throw Error('暂存程序文件发生变化');await replaceFile(await safeTarget(root,f.path),bytes,transaction.id);await fault('replace',i);}
    for(const name of m.remove)await unlink(await safeTarget(root,name));
    await atomicJSON(path.join(root,'runtime/updates/installed.json'),envelope);transaction.state='awaiting-health';await atomicJSON(file,transaction);return transaction;
  }catch(error){await rollbackTransaction(root,directory,transaction);throw error;}
}
export async function rollbackTransaction(root,directory,transaction){
  transaction.state='rolling-back';await atomicJSON(path.join(directory,'transaction.json'),transaction);
  for(const item of transaction.items){const target=await safeTarget(root,item.path);await unlink(target+'.nm-update-'+transaction.id).catch(e=>{if(e.code!=='ENOENT')throw e;});if(item.existed)await replaceFile(target,await readFile(await safeTarget(path.join(directory,'backup'),item.path)),transaction.id);else await unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  await atomicJSON(path.join(root,'runtime/updates/installed.json'),transaction.from);transaction.state='rolled-back';await atomicJSON(path.join(directory,'transaction.json'),transaction);
}
export async function appendHistory(root,entry){const file=path.join(root,'runtime/updates/history.json');let rows=[];try{rows=JSON.parse(await readFile(file,'utf8'));}catch{}await atomicJSON(file,[...rows,entry].slice(-30));}
export function launchServer(root,port){const p=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:String(port)},windowsHide:true,detached:true,stdio:'ignore'});p.on('error',()=>{});p.unref();return p;}
// Delete only signed, known program copies from terminal updater tasks. Unknown files and sessions are retained.
export async function pruneUpdates(root,keepId,trust){
  const dir=await updatePath(root),rows=await readdir(dir,{withFileTypes:true}),obsoleteHashes=new Set();
  for(const row of rows){
    if(!row.isDirectory()||row.name===keepId||!/^[a-f0-9-]{36}$/.test(row.name))continue;
    try{const directory=await updatePath(root,row.name),tx=JSON.parse(await readFile(path.join(directory,'transaction.json'),'utf8'));if(!['complete','rolled-back'].includes(tx.state))continue;const old=verifyEnvelope(tx.from,trust),next=verifyEnvelope(tx.to,trust);obsoleteHashes.add(next.package.sha256);
      for(const [folder,files] of [['stage',next.files],['backup',[...old.files,...next.files].filter((f,i,a)=>a.findIndex(x=>x.path===f.path)===i)]]){
        const base=await updatePath(root,row.name,folder);try{await realpath(base);}catch(e){if(e.code==='ENOENT')continue;throw e;}
        const parents=new Set();for(const f of files){const file=await safeTarget(base,f.path);await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});let p=path.dirname(file);while(p.startsWith(base+path.sep)){parents.add(p);p=path.dirname(p);}}
        for(const p of [...parents].sort((a,b)=>b.length-a.length))await rmdir(p).catch(()=>{});await rmdir(base).catch(()=>{});
      }
      for(const name of ['update-install.mjs','update-security.mjs','update-zip.mjs','update-runner.mjs','request.json','transaction.json'])await unlink(await updatePath(root,row.name,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory).catch(()=>{});
    }catch{/* A damaged or unknown directory is kept for manual investigation. */}
  }
  let keepHash;try{keepHash=verifyEnvelope(JSON.parse(await readFile(await updatePath(root,keepId,'request.json'),'utf8')).envelope,trust).package.sha256;}catch{}
  for(const row of rows)if(row.isFile()&&/^[a-f0-9]{64}\.(zip|part)$/.test(row.name)&&obsoleteHashes.has(row.name.split('.')[0])&&!row.name.startsWith(keepHash||'!'))await unlink(await updatePath(root,row.name)).catch(()=>{});
}
