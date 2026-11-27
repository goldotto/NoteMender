import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,open,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {isWave,writeAudioInput} from './audio-io.mjs';
import path from 'node:path';
import {muscriptorRuntime,inspectMuscriptor} from './muscriptor-runtime.mjs';
import {runProbe} from './component-discovery.mjs';
import {requestCompute} from './compute-runtime.mjs';
import {terminateProcess} from './process-control.mjs';
import {MU_MODEL_IDS,MUSCRIPTOR_PRECISIONS,muModel,muPrecisionPlan,muVariantFromModel} from '../public/muscriptor-spec.mjs';

export function validateMuResult(value,duration){
  if(!value||!Array.isArray(value.notes)||value.notes.length>150000||!['cpu','cuda'].includes(value.device)||!['fp32','fp16','bf16'].includes(value.precision)||(value.device==='cpu'&&value.precision!=='fp32'))throw Error('MuScriptor 返回结果无效');
  const ids=new Set();for(const n of value.notes){if(!/^[a-zA-Z0-9-]{1,80}$/.test(n.id)||ids.has(n.id)||!Number.isInteger(n.midi)||n.midi<0||n.midi>127||!Number.isFinite(n.start)||!Number.isFinite(n.end)||n.start<0||n.end<=n.start||n.end>duration+.05||typeof n.instrument!=='string'||n.instrument.length>80)throw Error('MuScriptor 音符证据无效');ids.add(n.id);}
  return value;
}
export async function muWavDuration(file,size,header){
  if(size<44||!isWave(header))throw Error('需要 16000Hz 单声道 WAV');
  const handle=await open(file,'r'),chunk=Buffer.alloc(16);
  let format=null,length=null;
  try{
    // Scan chunk headers and skip sample data and ancillary chunks on disk.
    for(let position=12;position+8<=size;){
      if((await handle.read(chunk,0,8,position)).bytesRead!==8)throw Error('WAV 数据不完整');
      const id=chunk.toString('ascii',0,4),bytes=chunk.readUInt32LE(4),start=position+8;
      if(start+bytes>size)throw Error('WAV 数据不完整');
      if(id==='fmt '&&bytes>=16){
        if((await handle.read(chunk,0,16,start)).bytesRead!==16)throw Error('WAV 数据不完整');
        format={pcm:chunk.readUInt16LE(0),channels:chunk.readUInt16LE(2),rate:chunk.readUInt32LE(4),bits:chunk.readUInt16LE(14)};
      }
      if(id==='data')length=bytes;
      position=start+bytes+bytes%2;
    }
  }finally{await handle.close();}
  if(!format||format.pcm!==1||format.channels!==1||format.rate!==16000||format.bits!==16||!length||length%2)throw Error('需要 16000Hz 单声道 PCM16 WAV');
  const duration=length/32000;if(duration>3600)throw Error('MuScriptor 一次最多 60 分钟');return duration;
}
export function muscriptorService(root,{spawnImpl=spawn,beforeStart=async()=>{},inspect=inspectMuscriptor,runtimeFor=muscriptorRuntime,probe=runProbe}={}){
  let current=null,child=null;const cache=path.join(root,'runtime','muscriptor','cache');
  const handler=async(req,res,url,send,token)=>{
    if(!url.pathname.startsWith('/api/muscriptor/'))return false;
    if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
    if(url.pathname==='/api/muscriptor/status'&&req.method==='GET'){send(200,{variant:current?.variant??'large',variants:MU_MODEL_IDS,job:current});return true;}
    const saved=/^\/api\/muscriptor\/result\/([a-f0-9]{64})\/(midi|json)$/.exec(url.pathname);
    if(saved&&['GET','HEAD'].includes(req.method)){
      const midi=saved[2]==='midi',file=path.join(cache,saved[1]+(midi?'.mid':'.json'));
      try{
        let body;
        if(req.method==='HEAD'){
          const info=await stat(file);
          if(!info.isFile()||!info.size)throw Error('缓存文件为空或无效');
          body='';
        }else body=await readFile(file);
        send(200,body,midi?'audio/midi':'application/json; charset=utf-8');
      }catch{send(404,{error:'原始结果已清理，请重新分析；已保存的简谱候选不受影响'});}
      return true;
    }
    if(url.pathname!=='/api/muscriptor/analyse'||req.method!=='POST'){send(404,{error:'接口不存在'});return true;}
    if(current){send(409,{error:'已有 MuScriptor 分析运行中'});return true;}
    let spec;try{spec=muModel(url.searchParams.get('variant')??undefined);}catch(error){send(400,{error:error.message});return true;}
    const {variant,name}=spec;
    const controller=new AbortController(),signal=controller.signal;let temp;current={variant,stage:'准备 '+name,progress:0};
    const close=()=>{if(!res.writableEnded){controller.abort();terminateProcess(child).catch(()=>{});}};res.on('close',close);
    try{
      const requestedPrecision=url.searchParams.get('precision')||'auto';
      if(!MUSCRIPTOR_PRECISIONS.includes(requestedPrecision))throw Error('MuScriptor 精度选项无效');
      await beforeStart();signal.throwIfAborted();
      const config=requestCompute(url),runtime=await runtimeFor(root,{device:config.device,variant}),checked=await inspect(root,runtime,{run:probe,signal});
      if(!checked.ready)throw Error(checked.reason||'请在组件管理安装 '+name);
      await mkdir(cache,{recursive:true});temp=await mkdtemp(path.join(cache,'task-'));const input=path.join(temp,'input.wav'),output=path.join(temp,'result.json');
      const {hash,size,header}=await writeAudioInput(req,input,{signal,limit:116*1024*1024,tooLarge:'MuScriptor 音频过大，请缩短范围'});
      const duration=await muWavDuration(input,size,header);
      const device=config.device==='cpu'||config.mode!=='performance'?'cpu':'cuda';let fallbackReason=null,result,skipCuda=false;
      for(const {device:actual,precision} of muPrecisionPlan(device,requestedPrecision)){
        if(skipCuda&&actual==='cuda')continue;
        signal.throwIfAborted();const key=hash.copy().update(JSON.stringify({model:spec.sha256,version:spec.version,adapter:spec.adapterVersion,torch:checked.torchVersion,device:actual,precision,threads:config.threads})).digest('hex'),file=path.join(cache,key+'.json');
        try{const value=validateMuResult(JSON.parse(await readFile(file,'utf8')),duration);if(value.device!==actual||value.precision!==precision||((value.variant??muVariantFromModel(value.model))??'large')!==variant)throw Error('结果后端、精度或模型不匹配');await stat(path.join(cache,key+'.mid'));result={...value,model:name,variant,analysisId:key,cacheHit:true,fallbackReason,requestedPrecision};break;}catch(error){if(error.code!=='ENOENT')await rm(file,{force:true});}
        current={variant,stage:'加载 '+name+' · '+precision.toUpperCase()+' · '+actual,progress:.01};
        const exit=await new Promise((resolve,reject)=>{
          child=spawnImpl(runtime.python,[path.join(root,'scripts','muscriptor_analysis.py'),'--input',input,'--output',output,'--variant',variant,'--model',path.join(runtime.directory,'model.safetensors'),'--device',actual,'--precision',precision,'--threads',String(config.threads)],{cwd:root,windowsHide:true,env:runtime.env,stdio:['ignore','pipe','pipe']});let error='',lines='';
          child.stderr.on('data',c=>error=(error+c).slice(-1800));child.stdout.on('data',c=>{lines+=c;const parts=lines.split('\n');lines=parts.pop();for(const line of parts)try{const value=JSON.parse(line);if(typeof value.stage==='string'&&Number.isFinite(value.progress))current={variant,stage:value.stage.slice(0,160),progress:Math.max(0,Math.min(1,value.progress))};}catch{}});
          child.once('error',reject);child.once('close',code=>{child=null;resolve({code,error});});
        });signal.throwIfAborted();
        if(exit.code===42&&actual==='cuda'){skipCuda=true;fallbackReason=[fallbackReason,'NVIDIA 显卡不可用或显存不足，已改用 CPU 运行同一 '+variant+' 模型'].filter(Boolean).join('；');current={variant,stage:fallbackReason,progress:0};continue;}
        if(exit.code===43&&actual==='cuda'&&precision!=='fp32'){fallbackReason=precision.toUpperCase()+' 不受支持或数值计算失败，已改用 FP32 运行同一 '+variant+' 模型';current={variant,stage:fallbackReason,progress:0};continue;}
        if(exit.code!==0)throw Error(exit.error||'MuScriptor 分析失败');
        const value=validateMuResult(JSON.parse(await readFile(output,'utf8')),duration);if(value.device!==actual||value.precision!==precision)throw Error('MuScriptor 实际设备或精度与请求不一致');
        if((value.variant??muVariantFromModel(value.model)??'large')!==variant)throw Error('MuScriptor 实际模型与请求不一致');
        value.variant=variant;value.model=name;
        await rename(output.replace(/\.json$/,'.mid'),path.join(cache,key+'.mid'));await writeFile(file,JSON.stringify(value));result={...value,model:name,variant,analysisId:key,cacheHit:false,fallbackReason,requestedPrecision};break;
      }
      if(!result)throw Error('MuScriptor 无可用结果');send(200,result);
    }catch(error){if(!res.destroyed)send(signal.aborted?499:400,{error:signal.aborted?'MuScriptor 已取消':error.message});}
    finally{
      await terminateProcess(child);
      child=null;
      if(temp)await rm(temp,{recursive:true,force:true}).catch(()=>{});
      current=null;
      res.off('close',close);
    }
    return true;
  };
  handler.busy=()=>Boolean(current);handler.close=()=>terminateProcess(child);return handler;
}
