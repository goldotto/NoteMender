import {spawn} from 'node:child_process';
import {access,mkdir,readFile,statfs,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {COMPONENTS,orderedComponents,DOWNLOAD_SOURCES} from '../public/component-catalog.mjs';
import {componentConfig,saveComponentConfig} from './component-config.mjs';
import {componentLocation,inspectComponent,discoverPython,knownModelHomes,knownQwenPaths} from './component-discovery.mjs';
import {terminateProcess} from './process-control.mjs';

export function installerCommand(root,id,node=process.execPath){
  const script=path.join(root,'scripts');
  const commands={audio:['powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'setup-runtime.ps1'),'-ProjectOnly']],six:[node,[path.join(script,'install-candidates.mjs'),'--six']],lyrics:[node,[path.join(script,'install-lyrics.mjs')]],gpu:[node,[path.join(script,'install-acceleration.mjs'),'--gpu']],cpu:[node,[path.join(script,'install-acceleration.mjs')]],singing:[node,[path.join(script,'install-candidates.mjs'),'--singing']]};
  if(!Object.hasOwn(commands,id))throw Error('不支持的组件');return commands[id];
}
async function has(file){try{await access(file);return true;}catch{return false;}}
export function componentsService(root,{canStart=()=>true,beforeStart=async()=>{},spawnImpl=spawn,inspect=inspectComponent,discover=discoverPython,location=componentLocation}={}){
  let current=null,controller=null,child=null,cached=null,cacheTime=0,pending=null;const candidates=new Map();
  async function status(refresh=false){
    if(!refresh&&cached&&Date.now()-cacheTime<180000)return {...cached,job:current};
    if(current&&['running','cancelling'].includes(current.state)||!canStart())return {...cached,components:cached?.components||COMPONENTS.map(item=>({...item,ready:item.id==='base',checking:item.id!=='base'})),job:current,busy:true};
    if(pending)return pending;
    pending=(async()=>{
      const components=[];
      for(const item of COMPONENTS){
        let result=item.id==='base'?{ready:true}:null,where;
        if(!result){where=await location(root,item.id);const missing=(!where.external&&['gpu','cpu','lyrics','singing'].includes(item.id)&&!await has(path.join(where.directory,'ready.json')));
          result=missing?{ready:false,reason:'组件尚未安装'}:await inspect(root,item.id,where);
        }
        components.push({...item,...result,external:Boolean(where?.external),location:where?.external?where.directory||where.python:null});
      }
      let freeBytes=null;try{const info=await statfs(root);freeBytes=Number(info.bavail)*Number(info.bsize);}catch{}
      cached={components,freeBytes,installDirectory:path.join(root,'runtime'),sources:DOWNLOAD_SOURCES};cacheTime=Date.now();return {...cached,job:current};
    })();try{return await pending;}finally{pending=null;}
  }
  function start(kind,work){
    if(current&&['running','cancelling'].includes(current.state)||pending||!canStart())throw Error('请等待当前分析、检查或组件任务结束');
    controller=new AbortController();current={id:randomUUID(),kind,state:'running',progress:0,stage:'准备',logs:[],candidates:[]};const job=current,signal=controller.signal;
    // Reserve the task before returning. All stages run sequentially.
    Promise.resolve().then(async()=>{await beforeStart();signal.throwIfAborted();await work(job,signal);signal.throwIfAborted();job.state='done';job.progress=1;job.stage='完成';}).catch(error=>{job.state=signal.aborted?'cancelled':'failed';job.stage=signal.aborted?'已取消':error.message;}).finally(()=>{child=null;cached=null;cacheTime=0;controller=null;});
    return {...job};
  }
  function log(job,value){const text=String(value).replace(/\x1b\[[0-9;]*m/g,'').trim();if(text){job.logs.push(text.slice(-1200));job.logs=job.logs.slice(-30);}}
  async function execute(job,id,signal,region){
    const [command,args]=installerCommand(root,id);signal.throwIfAborted();
    // Installer subprocesses always use owned interpreter/targets. Reused environments stay read-only.
    await new Promise((resolve,reject)=>{let tail='',buffer='';child=spawnImpl(command,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NOTEMENDER_INSTALL_MANAGED:'1',NOTEMENDER_DOWNLOAD_REGION:region,PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1',PIP_CACHE_DIR:path.join(root,'runtime','downloads','pip'),TEMP:path.join(root,'runtime','downloads','temp'),TMP:path.join(root,'runtime','downloads','temp')}});
      const output=chunk=>{buffer+=chunk.toString();const lines=buffer.split(/[\r\n]+/);buffer=lines.pop();for(const line of lines){log(job,line);tail=(tail+'\n'+line).slice(-2000);try{const data=JSON.parse(line);if(data.stage)job.stage=data.stage;if(Number.isFinite(data.progress))job.unitProgress=Math.max(0,Math.min(1,data.progress));}catch{}}};child.stdout.on('data',output);child.stderr.on('data',output);
      const abort=()=>terminateProcess(child).catch(()=>{});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();const finish=()=>{signal.removeEventListener('abort',abort);if(buffer)log(job,buffer);};
      child.once('error',error=>{finish();reject(error);});child.once('close',code=>{finish();child=null;signal.aborted?reject(new DOMException('已取消','AbortError')):code===0?resolve():reject(Error(tail.trim()||'组件安装失败，退出码 '+code));});
    });
  }
  async function scan(job,signal,body){
    candidates.clear();const files=await discover({consent:body.consent,folder:body.folder||null});const homes=await knownModelHomes(root,body.folder),qwen=await knownQwenPaths(root,body.folder);
    let index=0;for(const python of files){
      signal.throwIfAborted();job.stage='检查已有环境 '+(++index)+' / '+files.length;job.progress=(index-1)/Math.max(1,files.length);
      const basic=await inspect(root,'python',{python},{signal});if(!basic.ready)continue;
      const basicId=randomUUID();candidates.set(basicId,{id:'python',location:{python,validatedAt:new Date().toISOString()}});job.candidates.push({candidateId:basicId,component:'python',name:'Python 3.11 基础解释器',python,location:python});
      const projectRoot=body.folder?path.resolve(body.folder):null;
      for(const [step,id] of ['audio','six','gpu','cpu','lyrics'].entries()){
        job.stage='检查 '+COMPONENTS.find(item=>item.id===id).name+' · 环境 '+index+' / '+files.length;job.progress=(index-1+step/5)/Math.max(1,files.length);
        let locations=[];
        if(id==='audio'||id==='six')locations=homes.map(modelHome=>({python,modelHome}));
        else if(id==='gpu'||id==='cpu')locations=[...(projectRoot?[{python,directory:path.join(projectRoot,'runtime','acceleration',id)}]:[]),{python,directory:null}];
        else locations=[{python,...qwen,dependencies:projectRoot?path.join(qwen.directory,'dependencies'):null}];
        for(const where of locations){signal.throwIfAborted();const checked=await inspect(root,id,where,{signal});if(!checked.ready)continue;
          const candidateId=randomUUID(),binding={...where,directory:where.directory||checked.directory,validatedAt:new Date().toISOString()};
          if(id==='lyrics'){const models=JSON.parse(await readFile(path.join(root,'scripts','qwen-download-manifest.json'),'utf8'));binding.metadata={version:1,engine:'qwen3-asr',model:models.asr.folder,aligner:models.aligner.folder,precision:'fp32',fingerprint:createHash('sha256').update(JSON.stringify({models,python,versions:checked.torchVersion})).digest('hex')};}
          candidates.set(candidateId,{id,location:binding});job.candidates.push({candidateId,component:id,name:COMPONENTS.find(c=>c.id===id).name,python,location:where.modelHome||where.directory||python,gpuName:checked.gpuName||null});break;
        }
      }
    }
    if(!files.length)job.stage='未找到可检查的 Python 3.11；可指定已有程序或环境目录';
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
        const ids=orderedComponents(body.components),region=['auto','cn','global'].includes(body.region)?body.region:'auto';
        send(202,{job:start('install',async(job,signal)=>{
          let free=Infinity;try{const value=await statfs(root);free=Number(value.bavail)*Number(value.bsize);}catch{}
          const existing=await componentConfig(root),steps=[];for(const id of ids){const where=await location(root,id),checked=await inspect(root,id,where,{signal});if(checked.ready){log(job,COMPONENTS.find(c=>c.id===id).name+' 已可用，直接复用');continue;}steps.push(id);}
          const required=steps.reduce((sum,id)=>sum+COMPONENTS.find(c=>c.id===id).space*1024**3,0);if(free<required)throw Error('程序所在磁盘空间不足，请换到空间充足的磁盘');
          await mkdir(path.join(root,'runtime','downloads','temp'),{recursive:true});
          for(let i=0;i<steps.length;i++){const id=steps[i];signal.throwIfAborted();job.stage='安装 '+COMPONENTS.find(c=>c.id===id).name;job.progress=i/steps.length;job.component=id;job.unitProgress=null;await execute(job,id,signal,region);signal.throwIfAborted();const checked=await inspect(root,id,await location(root,id,{localOnly:true}),{deep:true,signal});if(!checked.ready)throw Error('安装后检查失败：'+checked.reason);const config=await componentConfig(root);if(config.bindings?.[id]){delete config.bindings[id];await saveComponentConfig(root,config);}job.progress=(i+1)/steps.length;}
        })});return true;
      }
      if(url.pathname==='/api/components/cancel'){if(controller){current.state='cancelling';controller.abort();await terminateProcess(child);}send(200,{ok:true});return true;}
      if(url.pathname==='/api/components/finish'){
        await mkdir(path.join(root,'runtime'),{recursive:true});await writeFile(path.join(root,'runtime','first-run.json'),JSON.stringify({version:1,completed:true}));send(200,{url:'/'});return true;
      }
      if(url.pathname==='/api/components/unlink'){
        if(current&&['running','cancelling'].includes(current.state)||pending||!canStart())throw Error('请等待任务结束');
        if(body.component!=='python'&&!COMPONENTS.some(item=>item.id===body.component))throw Error('无效组件');await beforeStart();const config=await componentConfig(root);delete config.bindings?.[body.component];await saveComponentConfig(root,config);cached=null;send(200,{ok:true});return true;
      }
      send(404,{error:'接口不存在'});
    }catch(error){send(400,{error:error.message});}return true;
  };
  handler.busy=()=>Boolean(pending||current&&['running','cancelling'].includes(current.state));handler.close=()=>{controller?.abort();return terminateProcess(child);};handler.status=status;return handler;
}
