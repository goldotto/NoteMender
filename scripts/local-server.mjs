import {spawn,spawnSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';

const VERSION='2.5.0-demo.6';
async function probe(port){
  try{const response=await fetch(`http://127.0.0.1:${port}/api/status`,{signal:AbortSignal.timeout(1000)});let version=null,instance=null;try{if(response.ok)({version,instance}=await response.json());}catch{}return {running:true,version,instance};}
  catch{return {running:false,version:null,instance:null};}
}
export async function ensureStudioServer(root){
  const instance=createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0,16);
  const first=Number.parseInt(instance.slice(0,8),16)%18000;
  const ports=Array.from({length:16},(_,i)=>41000+(first+i)%18000);
  for(const port of ports){const found=await probe(port);if(found.version===VERSION&&found.instance===instance)return port;}
  let port=null;for(const candidate of ports)if(!(await probe(candidate)).running){port=candidate;break;}
  if(port===null)throw Error('本机听谱端口均被占用，请先关闭一个旧版听谱服务。');
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:String(port)},detached:true,windowsHide:true,stdio:'ignore'});child.unref();
  for(let i=0;i<40;i++){const found=await probe(port);if(found.version===VERSION&&found.instance===instance)return port;await new Promise(resolve=>setTimeout(resolve,250));}
  throw Error('新版听谱服务未能启动。请检查本机运行环境。');
}
export function openStudioPage(url){
  if(!/^http:\/\/127\.0\.0\.1:\d+\//.test(url))throw Error('只允许打开本机听谱页面');
  const quoted=url.replace(/'/g,"''");
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; Start-Process -FilePath '${quoted}'`],{windowsHide:true,encoding:'utf8',timeout:15000});
  if(result.error||result.status!==0)throw Error(`浏览器未能自动打开。请将这个地址复制到浏览器：\n${url}\n请检查默认浏览器设置或访问权限。`);
}

