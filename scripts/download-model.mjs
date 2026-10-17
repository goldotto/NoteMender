import {copyFile,mkdir,readFile,rename,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {runProcess,sha256File} from './install-runtime.mjs';

export async function modelReuseCandidates(root,relative,env=process.env){
  let config={};try{config=JSON.parse(await readFile(path.join(root,'runtime','component-settings.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  // Only references already associated with this project; no computer scan.
  return [...new Set([env.NOTEMENDER_REUSE_MODEL_HOME,config.bindings?.audio?.modelHome,config.bindings?.six?.modelHome].filter(Boolean))].map(home=>path.join(home,relative));
}

export async function verifiedDownload(file,spec){
  try{const info=await stat(file);return info.isFile()&&(spec.size===undefined?info.size>0:info.size===spec.size)&&await sha256File(file)===spec.sha256;}catch{return false;}
}

export async function ensurePinnedFile({target,spec,candidates=[],urls=[],env=process.env,cwd,run=runProcess,log=console.log,maxTime=900}){
  if(!/^[a-f0-9]{64}$/i.test(spec?.sha256||''))throw Error('缺少固定模型校验值');
  if(await verifiedDownload(target,spec))return target;
  await mkdir(path.dirname(target),{recursive:true});
  for(const source of candidates){
    if(path.resolve(source)===path.resolve(target)||!await verifiedDownload(source,spec))continue;
    const staged=target+'.reuse.part';
    try{await copyFile(source,staged);if(!await verifiedDownload(staged,spec))throw Error('已有模型复制后校验失败');await rename(staged,target);log('复用已关联环境中的 '+path.basename(target)+'，无需下载');return target;}
    finally{await unlink(staged).catch(()=>{});}
  }
  const partial=target+'.part';
  if(await verifiedDownload(partial,spec)){await rename(partial,target);return target;}
  const errors=[];
  for(const url of [...new Set(urls)]){
    const host=new URL(url).hostname;if(new URL(url).protocol!=='https:')throw Error('下载源必须使用 HTTPS');
    log('下载 '+path.basename(target)+' · '+host);
    try{
      const args=['--silent','--show-error','--fail','--location','--retry','1','--connect-timeout','15','--max-time',String(maxTime),'--speed-time','60','--speed-limit','1024','--output',partial,'--write-out','\n%{http_code}'];
      let result=await run('curl.exe',[...args,'--continue-at','-',url],{cwd,env,stdio:'pipe'});
      if(result.code===33||(result.code===22&&String(result.stdout).trim().endsWith('416'))){
        if(await verifiedDownload(partial,spec)){await rename(partial,target);return target;}
        result=await run('curl.exe',[...args,url],{cwd,env,stdio:'pipe'});
      }
      if(result.code!==0)throw Error((result.stderr||'curl 退出码 '+result.code).trim().slice(-350));
      if(!await verifiedDownload(partial,spec)){await unlink(partial).catch(()=>{});throw Error('文件大小或 SHA-256 校验失败');}
      await rename(partial,target);return target;
    }catch(error){const reason=host+'：'+error.message;errors.push(reason);log(reason);}
  }
  throw Error(path.basename(target)+' 未下载完成；有效下载进度已保留，可重试。'+(errors.length?'\n'+errors.join('\n'):'没有可用下载源'));
}
