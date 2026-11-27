import {spawn} from 'node:child_process';
import {access,mkdir,readFile,readdir,rename,rm,stat,statfs,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {COMPONENTS,orderedComponents,DOWNLOAD_SOURCES} from '../public/component-catalog.mjs';
import {componentConfig,saveComponentConfig,audioRuntime} from './component-config.mjs';
import {componentLocation,inspectComponent,discoverPython,knownModelHomes,knownQwenPaths} from './component-discovery.mjs';
import {MU_MODEL_IDS,muModel} from '../public/muscriptor-spec.mjs';
import {runProbe} from './component-discovery.mjs';
import {terminateProcess} from './process-control.mjs';
import {pythonFor} from './python-runtime.mjs';
import {accelerationEnv} from './compute-runtime.mjs';

export async function installerRuntime(root,id){
  const runtime=['lyrics','singing','muscriptor'].includes(id)?await accelerationEnv(root,id==='singing'?'cuda':'auto'):{python:await pythonFor(root),env:{...process.env}};
  const bundled=path.join(root,'runtime','python','Lib','ensurepip','_bundled');
  let pip=null;try{pip=(await readdir(bundled)).find(name=>/^pip-.*\.whl$/.test(name));}catch{}
  const local=path.resolve(runtime.python).toLowerCase().startsWith(path.resolve(root).toLowerCase()+path.sep);
  const audio=await audioRuntime(root);
  return {...runtime,env:{...runtime.env,NOTEMENDER_REUSE_MODEL_HOME:audio.modelHome,NOTEMENDER_INSTALL_PYTHON:runtime.python,NOTEMENDER_READONLY_PYTHON:local?'0':'1',PYTHONPATH:[pip?path.join(bundled,pip):null,runtime.env.PYTHONPATH].filter(Boolean).join(path.delimiter),PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'}};
}

export function installerCommand(root,id,node=process.execPath){
  const script=path.join(root,'scripts');
  const commands={basic:[node,[path.join(script,'install-basic.mjs')]],python:[node,[path.join(script,'install-python.mjs')]],'audio-env':['powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'setup-runtime.ps1'),'-ProjectOnly','-EnvironmentOnly']],muscriptor:[node,[path.join(script,'install-muscriptor.mjs')]],audio:['powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'setup-runtime.ps1'),'-ProjectOnly']],six:[node,[path.join(script,'install-candidates.mjs'),'--six']],lyrics:[node,[path.join(script,'install-lyrics.mjs')]],gpu:[node,[path.join(script,'install-acceleration.mjs'),'--gpu']],cpu:[node,[path.join(script,'install-acceleration.mjs')]],singing:[node,[path.join(script,'install-candidates.mjs'),'--singing']]};
  if(!Object.hasOwn(commands,id))throw Error('不支持的组件');return commands[id];
}
async function has(file){try{await access(file);return true;}catch{return false;}}
export function componentsService(root,{record=()=>{},canStart=()=>true,beforeStart=async()=>{},spawnImpl=spawn,inspect=inspectComponent,discover=discoverPython,location=componentLocation}={}){
  let current=null,controller=null,child=null,cached=null,cacheTime=0,pending=null,warming=null,warmController=null,warmFailedAt=0;
  const candidates=new Map(),cacheFile=path.join(root,'runtime','component-cache.json');
  let snapshot=null,snapshotLoaded=false,snapshotRead=null;
  function useSnapshot(value){snapshot=value;snapshotLoaded=true;snapshotRead=Promise.resolve(value);}
  function loadSnapshot(){if(snapshotLoaded)return snapshotRead||Promise.resolve(snapshot);snapshotLoaded=true;snapshotRead=(async()=>{try{const data=JSON.parse(await readFile(cacheFile,'utf8'));useSnapshot(data&&[1,2].includes(data.version)&&Array.isArray(data.components)&&data.components.length?data:null);}catch{useSnapshot(null);}return snapshot;})();return snapshotRead;}
  async function saveSnapshot(components,freeBytes,checkedAt){
    const data={version:2,checkedAt,freeBytes,components};
    try{const temp=cacheFile+'.tmp';await mkdir(path.dirname(cacheFile),{recursive:true});await writeFile(temp,JSON.stringify(data),'utf8');await rename(temp,cacheFile);}catch{}
    useSnapshot(data);
  }
  async function removeSnapshot(){useSnapshot(null);try{await rm(cacheFile,{force:true});}catch{}}
  const busyNow=()=>Boolean(current&&['running','cancelling'].includes(current.state)||!canStart());
  const placeholder=()=>cached?.components||COMPONENTS.map(item=>({...item,ready:item.id==='base',checking:item.id!=='base'}));
  const busyStatus=()=>({...cached,components:placeholder(),job:current,busy:true,checkedAt:cacheTime,refreshing:Boolean(warming)});
  async function probeComponents(signal=null){
    // Two workers cap concurrent Python probes; slots keep catalog order regardless of completion order.
    const components=new Array(COMPONENTS.length);let index=0;
    async function worker(){
      for(;;){
        if(signal?.aborted)return;
        const position=index++;if(position>=COMPONENTS.length)return;
        const item=COMPONENTS[position],checkStarted=Date.now();record({source:'components',event:'check.start',component:item.id});
        let result=item.id==='base'?{ready:true}:null,where;
        if(item.id==='muscriptor'){
          const variants={},probes=new Map();
          // Sibling models share the dependency probe when they use the same environment.
          const run=(command,args,options)=>{
            const key=JSON.stringify([command,options.env?.PYTHONPATH]);
            if(!probes.has(key))probes.set(key,runProbe(command,args,options));
            return probes.get(key);
          };
          for(const variant of MU_MODEL_IDS){
            where=await location(root,item.id,{variant});
            signal?.throwIfAborted();
            const checked=await inspect(root,item.id,where,{signal,run});
            variants[variant]={...checked,external:Boolean(where.external)};
          }
          result={ready:Object.values(variants).some(model=>model.ready),variants};
          where=null;
        }
        if(!result){where=await location(root,item.id);signal?.throwIfAborted();
          const missing=(!where.external&&['gpu','cpu','lyrics','singing'].includes(item.id)&&!await has(path.join(where.directory,'ready.json')));
          result=missing?{ready:false,reason:'组件尚未安装'}:await inspect(root,item.id,where,{signal});
        }
        components[position]={...item,...result,external:Boolean(where?.external),sharedWith:where?.sharedWith||null,location:where?.external?where.directory||where.python:null};
        record({source:'components',event:'check.complete',component:item.id,state:result.ready?'ready':'missing',elapsedMs:Date.now()-checkStarted,message:result.reason});
      }
    }
    const settled=await Promise.allSettled([worker(),worker()]),failed=settled.find(entry=>entry.status==='rejected');if(failed)throw failed.reason;
    let freeBytes=null;try{const info=await statfs(root);freeBytes=Number(info.bavail)*Number(info.bsize);}catch{}
    return {components,freeBytes};
  }
  function foreground(){
    const run=(async()=>{
      const {components,freeBytes}=await probeComponents(),checkedAt=Date.now();
      cached={components,freeBytes,installDirectory:path.join(root,'runtime'),sources:DOWNLOAD_SOURCES};cacheTime=checkedAt;
      await saveSnapshot(components,freeBytes,checkedAt);
      return {...cached,job:current,busy:false,checkedAt:cacheTime,refreshing:false};
    })();
    pending=run;run.then(()=>{if(pending===run)pending=null;},()=>{if(pending===run)pending=null;});return run;
  }
  function startWarm(){
    if(warming)return warming;
    if(pending||!canStart()||Date.now()-warmFailedAt<=60000)return null;
    const abortController=new AbortController(),signal=abortController.signal;warmController=abortController;
    warming=(async()=>{
      try{
        const {components,freeBytes}=await probeComponents(signal);if(signal.aborted)return null;
        const checkedAt=Date.now();
        await saveSnapshot(components,freeBytes,checkedAt);
        cached={components,freeBytes,installDirectory:path.join(root,'runtime'),sources:DOWNLOAD_SOURCES};cacheTime=checkedAt;
        return {...cached,job:current,busy:false,checkedAt:cacheTime,refreshing:false};
      }catch(error){if(!signal.aborted)warmFailedAt=Date.now();return null;}
      finally{warming=null;if(warmController===abortController)warmController=null;}
    })();
    return warming;
  }
  function abortWarming(){warmController?.abort();}
  function snapshotStatus(data){
    // 目录升级后新增的组件不在旧快照里：标为待检查，避免首屏少卡片。
    const known=new Map((data.components||[]).map(item=>[item.id,item]));
    const components=COMPONENTS.map(item=>{
      const saved=known.get(item.id);
      if(!saved)return {...item,ready:item.id==='base',checking:item.id!=='base'};
      if(item.id!=='muscriptor'||saved.variants)return saved;
      // The old snapshot only knew Large. Keep it usable while variant probes warm up.
      return {...saved,...item,variants:{small:{ready:false},medium:{ready:false},
        large:{ready:Boolean(saved.ready),external:Boolean(saved.external)}}};
    });
    return {components,freeBytes:Number.isFinite(data.freeBytes)?data.freeBytes:null,installDirectory:path.join(root,'runtime'),sources:DOWNLOAD_SOURCES,job:current,busy:false,checkedAt:Number(data.checkedAt)||0,refreshing:Boolean(warming),stale:true};
  }
  async function status(refresh=false){
    if(pending)return pending;
    const busy=busyNow();
    if(!refresh&&cached&&Date.now()-cacheTime<180000)return {...cached,job:current,busy,checkedAt:cacheTime,refreshing:false};
    if(busy)return busyStatus();
    if(refresh){
      if(warming){const warmed=await warming;if(pending)return pending;if(warmed)return warmed;if(busyNow())return busyStatus();}
      return foreground();
    }
    await loadSnapshot();
    if(pending)return pending;
    if(cached&&Date.now()-cacheTime<180000)return {...cached,job:current,busy:busyNow(),checkedAt:cacheTime,refreshing:false};
    if(busyNow())return busyStatus();
    if(snapshot){startWarm();return snapshotStatus(snapshot);}
    return foreground();
  }
  function start(kind,work){
    if(current&&['running','cancelling'].includes(current.state)||pending||!canStart())throw Error('请等待当前分析、检查或组件任务结束');
    abortWarming();
    controller=new AbortController();current={id:randomUUID(),kind,state:'running',progress:0,stage:'准备',logs:[],candidates:[]};const job=current,signal=controller.signal;
    const started=Date.now();record({source:'components',event:'task.start',operation:kind});
    // Reserve the task before returning. All stages run sequentially.
    Promise.resolve().then(async()=>{await beforeStart();signal.throwIfAborted();await work(job,signal);signal.throwIfAborted();job.state='done';job.progress=1;job.stage='完成';}).catch(error=>{job.state=signal.aborted?'cancelled':'failed';job.stage=signal.aborted?'已取消':'任务失败：展开安装详情查看原因，可重试';if(!signal.aborted){job.error=error.message;log(job,error.message);record({source:'components',event:'task.error',operation:kind,component:job.component,level:'error',message:error.message,stack:error.stack});}}).finally(()=>{record({source:'components',event:'task.complete',operation:kind,component:job.component,state:job.state,elapsedMs:Date.now()-started});child=null;cached=null;cacheTime=0;controller=null;removeSnapshot();});
    return {...job};
  }
  const redactToken=value=>String(value).replace(/hf_[a-zA-Z0-9]+/g,'[已隐藏令牌]');
  function log(job,value){const text=redactToken(value).replace(/\x1b\[[0-9;]*m/g,'').trim();if(text){job.logs.push(text.slice(-1200));job.logs=job.logs.slice(-30);record({source:'components',event:'installer.output',component:job.component,message:text});}}
  async function execute(job,id,signal,region,mu={}){
    const [command,args]=installerCommand(root,id);signal.throwIfAborted();
    const runtime=await installerRuntime(root,id);
    // Installer subprocesses always use owned interpreter/targets. Reused environments stay read-only.
    await new Promise((resolve,reject)=>{let tail='',buffer='';child=spawnImpl(command,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...runtime.env,...(id==='muscriptor'?{NOTEMENDER_MUSCRIPTOR_VARIANT:mu.variant,NOTEMENDER_MUSCRIPTOR_TERMS:mu.acceptTerms===true?'accepted':'',NOTEMENDER_MUSCRIPTOR_FILE:mu.modelFile||'',NOTEMENDER_HF_TOKEN:mu.token||''}:{}),NOTEMENDER_INSTALL_MANAGED:'1',NOTEMENDER_DOWNLOAD_REGION:region,PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1',PIP_CACHE_DIR:path.join(root,'runtime','downloads','pip'),TEMP:path.join(root,'runtime','downloads','temp'),TMP:path.join(root,'runtime','downloads','temp')}});
      const output=chunk=>{buffer+=chunk.toString();const lines=buffer.split(/[\r\n]+/);buffer=lines.pop();for(const line of lines){log(job,line);tail=(tail+'\n'+redactToken(line)).slice(-2000);try{const data=JSON.parse(line);if(data.stage)job.stage=redactToken(data.stage);if(Number.isFinite(data.progress))job.unitProgress=Math.max(0,Math.min(1,data.progress));}catch{}}};child.stdout.on('data',output);child.stderr.on('data',output);
      const abort=()=>terminateProcess(child).catch(()=>{});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();const finish=()=>{signal.removeEventListener('abort',abort);if(buffer)log(job,buffer);};
      child.once('error',error=>{finish();reject(error);});child.once('close',code=>{finish();child=null;signal.aborted?reject(new DOMException('已取消','AbortError')):code===0?resolve():reject(Error(tail.trim()||'组件安装失败，退出码 '+code));});
    });
  }
  async function scan(job,signal,body){
    candidates.clear();
    if(body.folder){for(const relative of ['runtime/models/browser-basic-pitch','public/models/basic-pitch']){const directory=path.join(body.folder,relative),checked=await inspect(root,'basic',{directory},{deep:true,signal});if(checked.ready){const candidateId=randomUUID();candidates.set(candidateId,{id:'basic',location:{directory,validatedAt:new Date().toISOString()}});job.candidates.push({candidateId,component:'basic',name:'基础扒谱模型',location:directory});break;}}}
    const files=await discover({consent:body.consent,folder:body.folder||null});const homes=await knownModelHomes(root,body.folder),qwen=await knownQwenPaths(root,body.folder);
    let index=0;for(const python of files){
      signal.throwIfAborted();job.stage='检查已有环境 '+(++index)+' / '+files.length;job.progress=(index-1)/Math.max(1,files.length);
      const basic=await inspect(root,'python',{python},{signal});if(!basic.ready)continue;
      const basicId=randomUUID();candidates.set(basicId,{id:'python',location:{python,validatedAt:new Date().toISOString()}});job.candidates.push({candidateId:basicId,component:'python',name:'Python 3.11 基础解释器',python,location:python});
      const projectRoot=body.folder?path.resolve(body.folder):null;
      for(const [step,id] of ['audio-env','audio','six','gpu','cpu','lyrics'].entries()){
        job.stage='检查 '+COMPONENTS.find(item=>item.id===id).name+' · 环境 '+index+' / '+files.length;job.progress=(index-1+step/6)/Math.max(1,files.length);
        let locations=[];
        if(id==='audio-env')locations=[{python}];
        else if(id==='audio'||id==='six')locations=homes.map(modelHome=>({python,modelHome}));
        else if(id==='gpu'||id==='cpu')locations=[...(projectRoot?[{python,directory:path.join(projectRoot,'runtime','acceleration',id)}]:[]),{python,directory:null}];
        else locations=[{python,...qwen,dependencies:projectRoot?path.join(qwen.directory,'dependencies'):null}];
        for(const where of locations){signal.throwIfAborted();const checked=await inspect(root,id,where,{signal});if(!checked.ready)continue;
          const candidateId=randomUUID(),binding={...where,directory:where.directory||checked.directory,validatedAt:new Date().toISOString()};
          if(id==='lyrics'){const models=JSON.parse(await readFile(path.join(root,'scripts','qwen-download-manifest.json'),'utf8'));binding.metadata={version:1,engine:'qwen3-asr',model:models.asr.folder,aligner:models.aligner.folder,precision:'fp32',fingerprint:createHash('sha256').update(JSON.stringify({models,python,versions:checked.torchVersion})).digest('hex')};}
          candidates.set(candidateId,{id,location:binding});job.candidates.push({candidateId,component:id,name:COMPONENTS.find(c=>c.id===id).name,python,location:where.modelHome||where.directory||python,gpuName:checked.gpuName||null});break;
        }
      }
    }
    if(!files.length)job.stage=job.candidates.length?'已找到可复用采样音色；未找到 Python 环境':'未找到可检查的环境或采样音色；可指定已有程序目录';
  }
  const handler=async(req,res,url,send,token)=>{
    if(!url.pathname.startsWith('/api/components/'))return false;
    if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
    try{
      if(url.pathname==='/api/components/status'&&req.method==='GET'){send(200,await status(url.searchParams.get('refresh')==='1'));return true;}
      if(url.pathname==='/api/components/job'&&req.method==='GET'){send(200,{job:current});return true;}
      if(req.method!=='POST'){send(405,{error:'方法不支持'});return true;}
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192)throw Error('请求过大');chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
      if(url.pathname==='/api/components/scan'){
        if(body.consent!==true)throw Error('请先允许扫描本机已有环境');
        if(body.folder!==undefined&&(typeof body.folder!=='string'||body.folder.length>2048||body.folder&&!path.isAbsolute(body.folder)))throw Error('请填写已有程序或环境的完整目录');
        send(202,{job:start('scan',(job,signal)=>scan(job,signal,body))});return true;
      }
      if(url.pathname==='/api/components/reuse'){
        const candidate=candidates.get(body.candidateId);if(!candidate)throw Error('环境未经过本次扫描，请先扫描');
        send(202,{job:start('reuse',async(job,signal)=>{job.stage='校验已有组件与模型';const checked=await inspect(root,candidate.id,candidate.location,{deep:true,signal});if(!checked.ready)throw Error(checked.reason||'组件校验失败');const config=await componentConfig(root);config.bindings||={};config.bindings[candidate.id]=candidate.location;await saveComponentConfig(root,config);job.result={component:candidate.id};})});return true;
      }
      if(url.pathname==='/api/components/install'){
        const ids=orderedComponents(body.components);
        const mu=body.muscriptor;
        const spec=ids.includes('muscriptor')?muModel(mu?.variant):null;
        if(spec){
          if(mu?.acceptTerms!==true)throw Error('请先阅读并确认 '+spec.name+' 的许可条款');
          mu.variant=spec.variant;
          if(typeof mu.modelFile==='string')mu.modelFile=mu.modelFile.trim().replace(/^"(.*)"$/,'$1');
          if(mu.modelFile&&(typeof mu.modelFile!=='string'||mu.modelFile.length>2048||!path.isAbsolute(mu.modelFile)))throw Error('模型文件路径无效');
          if(mu.token&&(typeof mu.token!=='string'||mu.token.length>512||!/^hf_[a-zA-Z0-9]+$/.test(mu.token)))throw Error('Hugging Face 只读令牌格式无效');
        }
        const whereFor=(id,localOnly=false)=>location(root,id,{localOnly,...(id==='muscriptor'?{variant:spec.variant}:{})});
        const region=['auto','cn','global'].includes(body.region)?body.region:'auto';
        send(202,{job:start('install',async(job,signal)=>{
          if(spec)job.variant=spec.variant;
          try{
          let free=Infinity;try{const value=await statfs(root);free=Number(value.bavail)*Number(value.bsize);}catch{}
          const steps=[];for(const id of ids){const where=await whereFor(id),checked=await inspect(root,id,where,{signal});if(checked.ready){log(job,COMPONENTS.find(c=>c.id===id).name+' 已可用，直接复用');continue;}steps.push(id);}
          if(spec&&steps.includes('muscriptor')){
            if(mu.modelFile){
              const file=await stat(mu.modelFile).catch(()=>null);
              if(!file?.isFile())throw Error('找不到本机权重文件。请复制完整的 model.safetensors 文件路径');
              if(file.size!==spec.size)throw Error(spec.name+' 权重大小不匹配。请核对型号或重新下载完整文件');
            }else if(!mu.token)throw Error('请导入 '+spec.name+' 权重或填写官方下载令牌');
          }
          const required=steps.reduce((sum,id)=>sum+(id==='muscriptor'?spec.space:COMPONENTS.find(c=>c.id===id).space)*1024**3,0);if(free<required)throw Error('程序所在磁盘空间不足，请换到空间充足的磁盘');
          await mkdir(path.join(root,'runtime','downloads','temp'),{recursive:true});
          for(let i=0;i<steps.length;i++){
            const id=steps[i];signal.throwIfAborted();
            if((await inspect(root,id,await whereFor(id),{signal})).ready)continue;
            job.stage='安装 '+(id==='muscriptor'?spec.name:COMPONENTS.find(c=>c.id===id).name);
            job.progress=i/steps.length;job.component=id;job.unitProgress=null;
            try{await execute(job,id,signal,region,mu);}finally{if(id==='muscriptor')delete mu.token;}
            signal.throwIfAborted();
            const checked=await inspect(root,id,await whereFor(id,true),{deep:true,signal});
            if(!checked.ready)throw Error('安装后检查失败：'+checked.reason);
            const config=await componentConfig(root);
            if(config.bindings?.[id]&&(id!=='muscriptor'||spec.variant==='large')){
              delete config.bindings[id];await saveComponentConfig(root,config);
            }
            job.progress=(i+1)/steps.length;
          }
          if(spec)job.result={component:'muscriptor',variant:spec.variant};
          }finally{if(mu&&typeof mu==='object')delete mu.token;}
        })});return true;
      }
      if(url.pathname==='/api/components/cancel'){if(controller){current.state='cancelling';controller.abort();await terminateProcess(child);}send(200,{ok:true});return true;}
      if(url.pathname==='/api/components/finish'){
        await mkdir(path.join(root,'runtime'),{recursive:true});await writeFile(path.join(root,'runtime','first-run.json'),JSON.stringify({version:1,completed:true}));send(200,{url:'/'});return true;
      }
      if(url.pathname==='/api/components/unlink'){
        if(current&&['running','cancelling'].includes(current.state)||pending||!canStart())throw Error('请等待任务结束');
        abortWarming();
        if(body.component!=='python'&&!COMPONENTS.some(item=>item.id===body.component))throw Error('无效组件');await beforeStart();const config=await componentConfig(root);delete config.bindings?.[body.component];await saveComponentConfig(root,config);cached=null;cacheTime=0;await removeSnapshot();send(200,{ok:true});return true;
      }
      send(404,{error:'接口不存在'});
    }catch(error){send(400,{error:error.message});}return true;
  };
  handler.busy=()=>Boolean(pending||current&&['running','cancelling'].includes(current.state));handler.close=()=>{abortWarming();controller?.abort();return terminateProcess(child);};handler.status=status;return handler;
}
