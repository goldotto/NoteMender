import {spawn} from 'node:child_process';
import {access,mkdir,writeFile,readFile,rm,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pythonFor} from './python-runtime.mjs';
import {requestCompute,accelerationEnv} from './compute-runtime.mjs';
import {terminateProcess} from './process-control.mjs';
import {saveAudioResource} from './audio-resources.mjs';
import {audioRuntime} from './component-config.mjs';
import {modelSpecs,componentLocation} from './component-discovery.mjs';
export function separationService(root,{beforeStart=()=>{},spawnImpl=spawn}={}){
  const runtime=path.join(root,'runtime'),jobs=new Map();
  let current=null;
  const modelFile=async id=>path.join((await componentLocation(root,id)).modelHome,'hub','checkpoints',(await modelSpecs(root))[id].file);
  const ready=async()=>{try{await access(await pythonFor(root));await access(await modelFile('audio'));return true;}catch{return false;}};
  // This directory is generated exclusively by this application. Remove only old UUID job directories.
  async function cleanup(){try{for(const entry of await readdir(runtime,{withFileTypes:true})){if(!entry.isDirectory()||!/^job-[0-9a-f-]{36}$/.test(entry.name))continue;const dest=path.resolve(runtime,entry.name);if(dest.startsWith(path.resolve(runtime)+path.sep)&&(Date.now()-(await stat(dest)).mtimeMs)>86400000)await rm(dest,{recursive:true,force:true});}}catch{}}
  async function cachedJob(data,full=false,execution={mode:"standard"}){
    const digest=createHash('sha256').update(data).digest('hex');
    for(const entry of await readdir(runtime,{withFileTypes:true})){
      if(!entry.isDirectory()||!/^job-[0-9a-f-]{36}$/.test(entry.name))continue;
      const dir=path.join(runtime,entry.name),input=path.join(dir,'input.wav');
      try{
        if((await stat(input)).size!==data.length)continue;
        let stored={mode:'standard',device:'cpu',threads:0};try{stored=JSON.parse(await readFile(path.join(dir,'execution.json'),'utf8'));}catch{}
        if(JSON.stringify(stored)!==JSON.stringify(execution))continue;
        await access(path.join(dir,'stems.json'));await access(path.join(dir,'vocals.wav'));await access(path.join(dir,'other.wav'));
        if(full)for(const stem of ['bass','drums','instrumental'])await access(path.join(dir,stem+'.wav'));
        if(createHash('sha256').update(await readFile(input)).digest('hex')!==digest)continue;
        const id=entry.name.slice(4),job={id,state:'done',message:'已复用同一音频的本机分离结果',progress:1,dir,child:null};jobs.set(id,job);return job;
      }catch{}
    }
    return null;
  }
  cleanup();
  const handler=async(req,res,url,send,token)=>{
    if(!url.pathname.startsWith('/api/separation/'))return false;
    if(url.pathname==='/api/separation/status'&&req.method==='GET'){let sixReady=false;try{await access(await modelFile('six'));sixReady=true;}catch{}send(200,{ready:await ready(),models:['htdemucs',...(sixReady?['htdemucs_6s']:[])]});return true;}
    if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
    if(url.pathname==='/api/separation/start'&&req.method==='POST'){
      if(current){send(409,{error:'已有分离任务运行中'});return true;}
      if(!await ready()){send(400,{error:'请先双击Download-Components.cmd安装分轨环境'});return true;}
      // Reserve before awaiting body, so simultaneous uploads cannot start two CPU jobs.
      current='uploading';let child,job;
      try{
        let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>55*1024*1024)throw Error('分离音频超过 55 MB，请缩短歌曲');chunks.push(c);}const data=Buffer.concat(chunks);
        if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')throw Error('需要 WAV 音频');
        const model=url.searchParams.get('model')||'htdemucs';if(!['htdemucs','htdemucs_6s'].includes(model))throw Error('不支持的分轨模型');let modelFingerprint=null;if(model==='htdemucs_6s'){await access(await modelFile('six'));modelFingerprint=(await modelSpecs(root)).six.sha256;}const audioStart=Number(url.searchParams.get('start')||0),audioEnd=Number(url.searchParams.get('end')||0);if(model==='htdemucs_6s'&&(!Number.isFinite(audioStart)||!Number.isFinite(audioEnd)||audioStart<0||audioEnd<=audioStart||audioEnd>3600))throw Error('六轨片段的原曲秒数范围无效');
        const requested=requestCompute(url),pythonRuntime=requested.mode==='performance'?await accelerationEnv(root,requested.device):{python:await pythonFor(root),env:process.env};
        const execution={...requested,component:pythonRuntime.directory||'baseline',...(model==='htdemucs_6s'?{model,modelFingerprint,audioStart,audioEnd}: {})};
        if(requested.mode==='performance'){
          execution.adapterVersion=2;
          try{execution.componentFingerprint=createHash('sha256').update(await readFile(path.join(pythonRuntime.directory,'ready.json'))).digest('hex');}catch{execution.componentFingerprint='baseline';}
        }
        if(requested.mode==='standard')delete execution.component;
        const cached=await cachedJob(data,url.searchParams.get('full')==='1',execution);if(cached){current=null;send(200,{id:cached.id,cached:true});return true;}
        await beforeStart();
        const id=randomUUID(),dir=path.join(runtime,'job-'+id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'input.wav'),data);await writeFile(path.join(dir,'execution.json'),JSON.stringify(execution));
        job={id,state:'running',message:requested.mode==='performance'&&requested.device!=='cpu'?'Demucs 分离中（优先 NVIDIA 显卡），请稍候…':'Demucs 分离中（CPU），请稍候…',progress:.1,dir,child:null};jobs.set(id,job);current=id;
        child=spawnImpl(pythonRuntime.python,[path.join(root,'scripts','separate.py'),path.join(dir,'input.wav'),path.join(dir,'vocals.wav'),path.join(dir,'other.wav')],{cwd:root,windowsHide:true,env:{...pythonRuntime.env,JIANPU_COMPUTE:JSON.stringify(requested),JIANPU_SEPARATION_MODEL:model,TORCH_HOME:(await componentLocation(root,model==='htdemucs_6s'?'six':'audio')).modelHome,PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']});job.child=child;
        let stderr='';child.stderr.on('data',c=>{stderr=(stderr+c.toString()).slice(-1500);const match=stderr.match(/(\d+)%[^%]*$/);if(match)job.progress=.1+Number(match[1])*.008;});
        child.stdout.on('data',c=>{const message=c.toString().trim();if(message)job.message=message.slice(-150);});
        child.on('error',()=>{job.state='failed';job.error='无法启动 Python，请重新运行Download-Components.cmd。';current=null;});
        child.on('close',code=>{if(job.state==='cancelled'){}else if(code===0){job.state='done';job.progress=1;job.message='人声分离完成';}else{job.state='failed';job.error='Demucs 分离失败，请检查本地模型、内存或重新安装环境。';}if(current===id)current=null;job.child=null;});
        send(202,{id});
      }catch(e){current=null;send(400,{error:e.message});}
      return true;
    }
    if(url.pathname==='/api/separation/cancel'&&req.method==='POST'){
      let body='';for await(const c of req){body+=c;if(body.length>2048){send(413,{error:'请求过大'});return true;}}
      let id;try{id=JSON.parse(body).id;}catch{send(400,{error:'无效请求'});return true;}
      const job=jobs.get(id);if(job&&job.state==='running'){job.state='cancelled';await terminateProcess(job.child);await rm(job.dir,{recursive:true,force:true}).catch(()=>{});}send(200,{ok:true});return true;
    }
    const trackMatch=/^\/api\/separation\/track\/([0-9a-f-]{36})\/(vocals|other|bass|drums|instrumental|guitar|piano)$/.exec(url.pathname);
    if(trackMatch&&req.method==='GET'){try{await access(path.join(runtime,'job-'+trackMatch[1],'stems.json'));send(200,await readFile(path.join(runtime,'job-'+trackMatch[1],trackMatch[2]+'.wav')),'audio/wav');}catch{send(404,{error:'音轨不存在'});}return true;}
    const match=url.pathname.match(/^\/api\/separation\/(job|audio|other|bass|drums|instrumental)\/([0-9a-f-]{36})$/);
    if(match&&req.method==='GET'){
      const job=jobs.get(match[2]);if(!job){send(404,{error:'任务不存在'});return true;}
      if(match[1]==='job'){let sources=['vocals','other'];if(job.state==='done')try{sources=JSON.parse(await readFile(path.join(job.dir,'stems.json'),'utf8')).sources;}catch{}let compute=null;if(job.state==='done')try{compute=JSON.parse(await readFile(path.join(job.dir,'compute.json'),'utf8'));}catch{}let resources=[];if(job.state==='done'){if(!job.resources){const exec=JSON.parse(await readFile(path.join(job.dir,'execution.json'),'utf8'));const start=exec.audioStart||0,end=exec.audioEnd||Number(url.searchParams.get('end'));if(end>start){job.resourcePromise ||= Promise.all(sources.map(async source=>saveAudioResource(root,await readFile(path.join(job.dir,source+'.wav')),{source,audioStart:start,audioEnd:end,model:compute?.model||exec.model||'htdemucs'})));job.resources=await job.resourcePromise;}}resources=job.resources||[];}send(200,{state:job.state,progress:job.progress,message:job.message,error:job.error,sources,compute,resources});return true;}
      if(job.state!=='done'){send(409,{error:'任务尚未完成'});return true;}
      try{send(200,await readFile(path.join(job.dir,match[1]==='audio'?'vocals.wav':match[1]+'.wav')),'audio/wav');}catch(e){if(e.code==='ENOENT')send(404,{error:'此分轨缓存没有该音轨，请重新分离'});else throw e;}return true;
    }
    send(404,{error:'分离接口不存在'});return true;
  };
  handler.busy=()=>Boolean(current);handler.close=()=>{for(const job of jobs.values())if(job.child){job.state='cancelled';terminateProcess(job.child).then(()=>rm(job.dir,{recursive:true,force:true}).catch(()=>{}));}};return handler;
}
