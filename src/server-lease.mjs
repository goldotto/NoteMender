import {open,readFile,unlink,mkdir} from 'node:fs/promises';
import {readFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {updatePath} from './update-install.mjs';
export async function acquireServerLease(root,port){
  const file=await updatePath(root,'service.json');await mkdir(path.dirname(file),{recursive:true});
  try{const old=JSON.parse(await readFile(file,'utf8'));if(!Number.isInteger(old.pid)||old.pid<=0)throw Error('服务运行记录无效，请检查 runtime/updates/service.json');try{process.kill(old.pid,0);throw Error('此目录已有程序运行，请打开原来的本机页面');}catch(e){if(e.code!=='ESRCH')throw e;}await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  const h=await open(file,'wx');try{await h.writeFile(JSON.stringify({pid:process.pid,port}));await h.sync();}finally{await h.close();}
  const release=()=>{try{if(JSON.parse(readFileSync(file,'utf8')).pid===process.pid)unlinkSync(file);}catch{}};process.once('exit',release);return release;
}
