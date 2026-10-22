import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {muscriptorRuntime,inspectMuscriptor} from './muscriptor-runtime.mjs';
import {runProbe} from './component-discovery.mjs';
import {requestCompute} from './compute-runtime.mjs';
import {terminateProcess} from './process-control.mjs';
import {MUSCRIPTOR,MUSCRIPTOR_PRECISIONS,muPrecisionPlan} from '../public/muscriptor-spec.mjs';

export function validateMuResult(value,duration){
  if(!value||!Array.isArray(value.notes)||value.notes.length>150000||!['cpu','cuda'].includes(value.device)||!['fp32','fp16','bf16'].includes(value.precision)||(value.device==='cpu'&&value.precision!=='fp32'))throw Error('MuScriptor 返回结果无效');
  const ids=new Set();for(const n of value.notes){if(!/^[a-zA-Z0-9-]{1,80}$/.test(n.id)||ids.has(n.id)||!Number.isInteger(n.midi)||n.midi<0||n.midi>127||!Number.isFinite(n.start)||!Number.isFinite(n.end)||n.start<0||n.end<=n.start||n.end>duration+.05||typeof n.instrument!=='string'||n.instrument.length>80)throw Error('MuScriptor 音符证据无效');ids.add(n.id);}
  return value;
}
export function muWavDuration(bytes){
  if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('需要 16000Hz 单声道 WAV');
  let p=12,format=null,length=null;while(p+8<=bytes.length){const id=bytes.toString('ascii',p,p+4),size=bytes.readUInt32LE(p+4);if(p+8+size>bytes.length)throw Error('WAV 数据不完整');if(id==='fmt '&&size>=16)format={pcm:bytes.readUInt16LE(p+8),channels:bytes.readUInt16LE(p+10),rate:bytes.readUInt32LE(p+12),bits:bytes.readUInt16LE(p+22)};if(id==='data')length=size;p+=8+size+(size%2);}
  if(!format||format.pcm!==1||format.channels!==1||format.rate!==16000||format.bits!==16||!length||length%2)throw Error('需要 16000Hz 单声道 PCM16 WAV');
  const duration=length/32000;if(duration>3600)throw Error('MuScriptor 一次最多 60 分钟');return duration;
}
export function muscriptorService(root,{spawnImpl=spawn,beforeStart=async()=>{},inspect=inspectMuscriptor,runtimeFor=muscriptorRuntime,probe=runProbe}={}){
  let current=null,child=null;const cache=path.join(root,'runtime','muscriptor','cache');
  const handler=async(req,res,url,send,token)=>{
    if(!url.pathname.startsWith('/api/muscriptor/'))return false;
    if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
    if(url.pathname==='/api/muscriptor/status'&&req.method==='GET'){send(200,{variant:'large',job:current});return true;}
    const saved=/^\/api\/muscriptor\/result\/([a-f0-9]{64})\/(midi|json)$/.exec(url.pathname);
    if(saved&&req.method==='GET'){try{send(200,await readFile(path.join(cache,saved[1]+(saved[2]==='midi'?'.mid':'.json'))),saved[2]==='midi'?'audio/midi':'application/json; charset=utf-8');}catch{send(404,{error:'原始结果已清理，请重新分析；已保存的简谱候选不受影响'});}return true;}
    if(url.pathname!=='/api/muscriptor/analyse'||req.method!=='POST'){send(404,{error:'接口不存在'});return true;}
    if(current){send(409,{error:'已有 MuScriptor 分析运行中'});return true;}
    const controller=new AbortController(),signal=controller.signal;let temp;current={stage:'准备 MuScriptor large',progress:0};
    const close=()=>{if(!res.writableEnded){controller.abort();terminateProcess(child).catch(()=>{});}};res.on('close',close);
    try{
      const requestedPrecision=url.searchParams.get('precision')||'auto';
      if(!MUSCRIPTOR_PRECISIONS.includes(requestedPrecision))throw Error('MuScriptor 精度选项无效');
      await beforeStart();signal.throwIfAborted();
      const config=requestCompute(url),runtime=await runtimeFor(root,{device:config.device}),checked=await inspect(root,runtime,{run:probe,signal});
      if(!checked.ready)throw Error(checked.reason||'请在组件管理安装 MuScriptor large');
      let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>116*1024*1024)throw Error('MuScriptor 音频过大，请缩短范围');chunks.push(c);}const bytes=Buffer.concat(chunks),duration=muWavDuration(bytes);
      await mkdir(cache,{recursive:true});temp=await mkdtemp(path.join(cache,'task-'));const input=path.join(temp,'input.wav'),output=path.join(temp,'result.json');await writeFile(input,bytes);
      const device=config.device==='cpu'||config.mode!=='performance'?'cpu':'cuda';let fallbackReason=null,result,skipCuda=false;
      for(const {device:actual,precision} of muPrecisionPlan(device,requestedPrecision)){
        if(skipCuda&&actual==='cuda')continue;
        signal.throwIfAborted();const key=createHash('sha256').update(bytes).update(JSON.stringify({model:MUSCRIPTOR.sha256,version:MUSCRIPTOR.version,adapter:MUSCRIPTOR.adapterVersion,torch:checked.torchVersion,device:actual,precision,threads:config.threads})).digest('hex'),file=path.join(cache,key+'.json');
        try{const value=validateMuResult(JSON.parse(await readFile(file,'utf8')),duration);if(value.device!==actual||value.precision!==precision)throw Error('结果后端或精度不匹配');await stat(path.join(cache,key+'.mid'));result={...value,analysisId:key,cacheHit:true,fallbackReason,requestedPrecision};break;}catch(error){if(error.code!=='ENOENT')await rm(file,{force:true});}
        current={stage:'加载 MuScriptor large · '+precision.toUpperCase()+' · '+actual,progress:.01};
        const exit=await new Promise((resolve,reject)=>{
          child=spawnImpl(runtime.python,[path.join(root,'scripts','muscriptor_analysis.py'),'--input',input,'--output',output,'--model',path.join(runtime.directory,'model.safetensors'),'--device',actual,'--precision',precision,'--threads',String(config.threads)],{cwd:root,windowsHide:true,env:runtime.env,stdio:['ignore','pipe','pipe']});let error='',lines='';
          child.stderr.on('data',c=>error=(error+c).slice(-1800));child.stdout.on('data',c=>{lines+=c;const parts=lines.split('\n');lines=parts.pop();for(const line of parts)try{const value=JSON.parse(line);if(typeof value.stage==='string'&&Number.isFinite(value.progress))current={stage:value.stage.slice(0,160),progress:Math.max(0,Math.min(1,value.progress))};}catch{}});
          child.once('error',reject);child.once('close',code=>{child=null;resolve({code,error});});
        });signal.throwIfAborted();
        if(exit.code===42&&actual==='cuda'){skipCuda=true;fallbackReason=[fallbackReason,'NVIDIA 显卡不可用或显存不足，已改用 CPU 运行同一 large 模型'].filter(Boolean).join('；');current={stage:fallbackReason,progress:0};continue;}
        if(exit.code===43&&actual==='cuda'&&precision!=='fp32'){fallbackReason=precision.toUpperCase()+' 不受支持或数值计算失败，已改用 FP32 运行同一 large 模型';current={stage:fallbackReason,progress:0};continue;}
        if(exit.code!==0)throw Error(exit.error||'MuScriptor 分析失败');
        const value=validateMuResult(JSON.parse(await readFile(output,'utf8')),duration);if(value.device!==actual||value.precision!==precision)throw Error('MuScriptor 实际设备或精度与请求不一致');
        await rename(output.replace(/\.json$/,'.mid'),path.join(cache,key+'.mid'));await writeFile(file,JSON.stringify(value));result={...value,analysisId:key,cacheHit:false,fallbackReason,requestedPrecision};break;
      }
      if(!result)throw Error('MuScriptor 无可用结果');send(200,result);
    }catch(error){if(!res.destroyed)send(signal.aborted?499:400,{error:signal.aborted?'MuScriptor 已取消':error.message});}
    finally{await terminateProcess(child);child=null;if(temp)await rm(temp,{recursive:true,force:true});current=null;res.off('close',close);}return true;
  };
  handler.busy=()=>Boolean(current);handler.close=()=>terminateProcess(child);return handler;
}
