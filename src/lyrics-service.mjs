import {readFile,writeFile,mkdir,mkdtemp,rm,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {accelerationEnv} from './compute-runtime.mjs';
import {terminateProcess} from './process-control.mjs';
import {componentLocation} from './component-discovery.mjs';
export function validateLyricRequest(body){
  if(!body||!/^[a-f0-9]{64}$/.test(body.resourceId||''))throw Error('音频资源无效');
  for(const key of ['from','to'])if(typeof body[key]!=='number'||!Number.isFinite(body[key])||body[key]<0||body[key]>3600)throw Error('歌词范围无效');
  if(body.to<=body.from)throw Error('结束必须晚于开始');
  const language=['auto','zh','en','ja','ko','yue','fr','de','it','pt','ru','es'].includes(body.language)?body.language:'auto',device=body.device==='cuda'?'cuda':'cpu';
  const threads=Number(body.threads)||0;if(!Number.isInteger(threads)||threads<0||threads>os.availableParallelism())throw Error('CPU 线程数无效');
  return {resourceId:body.resourceId,from:body.from,to:body.to,language,device,threads,text:typeof body.text==='string'?body.text.slice(0,2000):null};
}
export function lyricsService(root,{canStart=()=>true,beforeStart=async()=>{},spawnImpl=spawn}={}){
  const directory=path.join(root,'runtime','lyrics-qwen');let child=null,current=null;
  async function status(){try{const selected=await componentLocation(root,'lyrics'),marker=selected.metadata||JSON.parse(await readFile(path.join(selected.directory,'ready.json'),'utf8'));if(marker.engine!=='qwen3-asr'||!/^Qwen3-ASR-(0\.6|1\.7)B$/.test(marker.model)||marker.aligner!=='Qwen3-ForcedAligner-0.6B'||!/^[a-f0-9]{64}$/.test(marker.fingerprint))throw Error('组件记录无效');await access(selected.python);if(selected.dependencies)await access(path.join(selected.dependencies,'qwen_asr','__init__.py'));for(const modelPath of Object.values(selected.modelPaths)){await access(path.join(modelPath,'config.json'));await access(path.join(modelPath,'model.safetensors'));}return {ready:true,engine:marker.engine,model:marker.model,aligner:marker.aligner,precision:'fp32',fingerprint:marker.fingerprint,job:current};}catch{return {ready:false,engine:'qwen3-asr',reason:'Qwen 歌词组件或模型尚未安装，请打开“组件管理”安装或复用。',job:current};}}
  const handler=async(req,res,url,send,token)=>{
    if(!url.pathname.startsWith('/api/lyrics/'))return false;
    if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
    if(url.pathname==='/api/lyrics/status'&&req.method==='GET'){send(200,await status());return true;}
    const kind=url.pathname.slice('/api/lyrics/'.length);
    if(!['transcribe','align'].includes(kind)||req.method!=='POST'){send(404,{error:'接口不存在'});return true;}
    let temp=null,finished=false,ownsTask=false;const controller=new AbortController(),onClose=()=>{if(!finished){controller.abort();if(ownsTask)terminateProcess(child).catch(()=>{});}};res.on('close',onClose);
    try{
      if(current||!canStart())throw Error('已有分析任务运行中，请稍后');
      current={stage:'准备歌词请求',progress:0};ownsTask=true;
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw Error('歌词请求过大');chunks.push(chunk);}const params=validateLyricRequest(JSON.parse(Buffer.concat(chunks).toString()));
      if(kind==='align'&&!params.text?.trim())throw Error('请填写要对齐的歌词');
      const ready=await status();if(!ready.ready)throw Error(ready.reason);
      const resourceRoot=path.join(root,'runtime','audio-resources',params.resourceId),metadata=JSON.parse(await readFile(path.join(resourceRoot,'metadata.json'),'utf8'));
      if(params.from<metadata.audioStart||params.to>metadata.audioEnd+.01)throw Error('所选音轨未覆盖歌词范围');
      const cache=path.join(directory,'cache'),identity={...params,kind,engine:ready.engine,model:ready.fingerprint,precision:'fp32',source:metadata.source,adapter:5};
      const key=createHash('sha256').update(JSON.stringify(identity)).digest('hex');await mkdir(cache,{recursive:true});const file=path.join(cache,key+'.json');
      try{const cached=JSON.parse(await readFile(file,'utf8'));finished=true;send(200,{...cached,cacheHit:true});return true;}catch(error){if(error.code!=='ENOENT')throw error;}
      current={stage:'准备歌词分析',progress:0};await beforeStart();controller.signal.throwIfAborted();
      temp=await mkdtemp(path.join(directory,'task-'));const request=path.join(temp,'request.json'),output=path.join(temp,'result.json');
      const selected=await componentLocation(root,'lyrics');await writeFile(request,JSON.stringify({...params,kind,input:path.join(resourceRoot,'audio.wav'),origin:metadata.audioStart,directory: selected.directory,marker:selected.metadata,modelPaths:selected.modelPaths,output}));
      const runtime=await accelerationEnv(root,'auto'),env={...runtime.env,PYTHONPATH:[selected.dependencies,selected.overlay,runtime.env.PYTHONPATH].filter(Boolean).join(path.delimiter),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HOME:path.join(directory,'hf-cache')};
      controller.signal.throwIfAborted();
      await new Promise((resolve,reject)=>{let errors='',lines='';child=spawnImpl(selected.external?selected.python:runtime.python,[path.join(root,'scripts','qwen_lyrics_analysis.py'),request],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stderr.on('data',c=>errors=(errors+c).slice(-3000));child.stdout.on('data',c=>{lines+=c;const parts=lines.split('\n');lines=parts.pop();for(const part of parts)try{const p=JSON.parse(part);if(p.stage&&Number.isFinite(p.progress))current={stage:p.stage,progress:Math.max(0,Math.min(1,p.progress))};}catch{}});child.once('error',reject);child.once('close',code=>code===0&&!controller.signal.aborted?resolve():reject(controller.signal.aborted?new DOMException('歌词分析已取消','AbortError'):Error(errors||'Qwen 歌词分析失败')));});
      const result=JSON.parse(await readFile(output,'utf8'));controller.signal.throwIfAborted();const record={...result,identity:{...identity,actualDevice:result.device},cacheHit:false};if(result.device===params.device)await writeFile(file,JSON.stringify(record));finished=true;send(200,record);
    }catch(error){finished=true;if(!res.destroyed)send(400,{error:error.code==='ENOENT'?'音频资源缺失，请重新导入':error.message});}
    finally{res.off('close',onClose);if(ownsTask){if(child)await terminateProcess(child);child=null;current=null;}if(temp)await rm(temp,{recursive:true,force:true});}return true;
  };
  handler.busy=()=>Boolean(current);handler.close=()=>terminateProcess(child);return handler;
}
