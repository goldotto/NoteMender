import {spawn} from 'node:child_process';
import {access,mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {accelerationEnv,requestCompute} from './compute-runtime.mjs';
import {terminateProcess} from './process-control.mjs';

export function validateSingingWords(body){
  if(!body||!/^[a-f0-9]{64}$/.test(body.resourceId||'')||!Array.isArray(body.windows)||!body.windows.length||body.windows.length>800)throw Error('人声音频或分析窗口无效');
  const ids=new Set();let wordCount=0;
  const windows=body.windows.map(w=>{
    if(!/^[a-zA-Z0-9-]{1,80}$/.test(w.id||'')||ids.has(w.id))throw Error('窗口 ID 无效或重复');ids.add(w.id);
    if(!Number.isFinite(w.from)||!Number.isFinite(w.to)||w.from<0||w.to>w.from+20||w.to<=w.from||w.to>3600)throw Error('人声窗口范围无效');
    if(!Array.isArray(w.words))throw Error('字词时间列表无效');wordCount+=w.words.length;if(wordCount>20000)throw Error('字词过多');
    const wordIds=new Set(),words=w.words.map(t=>{
      if(!/^[a-zA-Z0-9-]{1,80}$/.test(t.id||'')||wordIds.has(t.id))throw Error('字词 ID 无效或重复');wordIds.add(t.id);
      if(!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.end<=t.start||t.start<w.from-.001||t.end>w.to+.001)throw Error('字词时间超出窗口');
      return {id:t.id,start:Math.max(0,t.start-w.from),end:Math.min(w.to-w.from,t.end-w.from)};
    });
    return {id:w.id,from:w.from,to:w.to,words};
  });
  return {resourceId:body.resourceId,language:String(body.language||'auto').slice(0,12),textVersion:String(body.textVersion||'').slice(0,128),windows};
}
export function singingService(root,{spawnImpl=spawn,beforeStart=()=>{}}={}){
  const directory=path.join(root,'runtime','singing'),cache=path.join(directory,'cache');let child=null,current=null;
  async function ready(){try{await access(path.join(directory,'ready.json'));return true;}catch{return false;}}
  const handler=async(req,res,url,send,token)=>{
    if(!url.pathname.startsWith('/api/singing/'))return false;
    if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
    if(url.pathname==='/api/singing/status'&&req.method==='GET'){send(200,{ready:await ready(),engine:'rosvot',device:'cuda',optional:true,wordAlignment:true,job:current});return true;}
    const conditioned=url.pathname==='/api/singing/align';
    if(!['/api/singing/analyse','/api/singing/align'].includes(url.pathname)||req.method!=='POST'){send(404,{error:'接口不存在'});return true;}
    if(current){send(409,{error:'已有演唱分析运行中'});return true;}current={stage:'准备人声分析',progress:0};
    const controller=new AbortController(),close=()=>{if(!res.writableEnded){controller.abort();terminateProcess(child).catch(()=>{});}};res.on('close',close);let temp;
    try{
      if(!await ready())throw Error('演唱精细分音未安装，请运行 scripts/安装候选组件.ps1 -Singing');
      const execution=requestCompute(url);if(execution.device==='cpu')throw Error('ROSVOT 实验组件需选择自动或 NVIDIA 显卡；现有 CPU 候选仍可使用');
      let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>4*1024*1024)throw Error('请缩短演唱分析片段');chunks.push(c);}const bytes=Buffer.concat(chunks);
      let params=null,resource=null;
      if(conditioned){
        params=validateSingingWords(JSON.parse(bytes.toString('utf8')));
        const directory=path.join(root,'runtime','audio-resources',params.resourceId);
        resource=JSON.parse(await readFile(path.join(directory,'metadata.json'),'utf8'));
        if(params.windows.some(w=>w.from<resource.audioStart||w.to>resource.audioEnd+.001))throw Error('人声音轨未覆盖分析窗口');
        resource={...resource,input:path.join(directory,'audio.wav')};await access(resource.input);
      }else if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('需要 WAV 音频');
      const marker=JSON.parse(await readFile(path.join(directory,'ready.json'),'utf8'));
      const identity={fingerprints:marker.fingerprints||marker,torchVersion:marker.compute?.torchVersion,device:'cuda',precision:'fp32',adapterVersion:5,kind:conditioned?'words':'audio'};
      const key=createHash('sha256').update(conditioned?JSON.stringify(params):bytes).update(JSON.stringify(identity)).digest('hex');
      await mkdir(cache,{recursive:true});const filename=path.join(cache,key+'.json');try{send(200,{...JSON.parse(await readFile(filename,'utf8')),cacheHit:true});return true;}catch(e){if(e.code!=='ENOENT')throw e;}
      await beforeStart();controller.signal.throwIfAborted();temp=await mkdtemp(path.join(directory,'task-'));const input=path.join(temp,'input.wav'),output=path.join(temp,'result.json'),request=path.join(temp,'request.json');
      const args=conditioned?['--request',request]:[input,output];
      if(conditioned)await writeFile(request,JSON.stringify({...params,input:resource.input,origin:resource.audioStart,output}));else await writeFile(input,bytes);
      const runtime=await accelerationEnv(root,'cuda');controller.signal.throwIfAborted();current={stage:'加载人声分音模型',progress:.01};
      await new Promise((resolve,reject)=>{
        child=spawnImpl(runtime.python,[path.join(root,'scripts','singing_analysis.py'),...args],{cwd:root,windowsHide:true,env:{...runtime.env,PYTHONPATH:[path.join(directory,'dependencies'),runtime.env.PYTHONPATH].filter(Boolean).join(path.delimiter)},stdio:['ignore','pipe','pipe']});let message='',lines='';
        child.stderr.on('data',c=>message=(message+c.toString()).slice(-1800));
        child.stdout?.on('data',c=>{lines+=c;const parts=lines.split('\n');lines=parts.pop();for(const part of parts)try{const p=JSON.parse(part);if(p.stage&&Number.isFinite(p.progress))current={stage:p.stage,progress:Math.max(0,Math.min(1,p.progress))};}catch{}});
        child.once('error',reject);child.once('close',code=>code===0&&!controller.signal.aborted?resolve():reject(Error(controller.signal.aborted?'演唱分析已取消':message||'演唱分析失败')));
      });
      const result=JSON.parse(await readFile(output,'utf8'));controller.signal.throwIfAborted();await writeFile(filename,JSON.stringify(result));send(200,{...result,cacheHit:false});
    }catch(e){if(!res.destroyed)send(400,{error:e.code==='ENOENT'?'人声音频资源缺失，请重新关联原音':e.message});}finally{if(child)await terminateProcess(child);child=null;if(temp)await rm(temp,{recursive:true,force:true});current=null;res.off('close',close);}return true;
  };
  handler.busy=()=>Boolean(current);handler.close=()=>terminateProcess(child);return handler;
}
