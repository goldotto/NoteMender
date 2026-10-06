import os from 'node:os';
import {NativeAnalysis} from './native-analysis.mjs';
import {requestCompute,qualification,modelFingerprint,torchQualifications} from './compute-runtime.mjs';

async function body(req,limit){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('原生分析输入过大');chunks.push(chunk);}return Buffer.concat(chunks);}
export function computeService(root,{runner=new NativeAnalysis(root),canStart=()=>true}={}){
  let busy=false,statusCache=null,statusPromise=null;
  async function status(signal,refresh=false){
    if(!refresh&&statusCache)return statusCache;
    let probe={},error=null;
    try{probe=await runner.request({kind:'probe'},{device:'auto',threads:0},signal);}catch(e){if(signal?.aborted)throw e;error=e.message;}
    let cpuProbe=probe;
    if(probe.providers?.includes('CUDAExecutionProvider'))try{cpuProbe=await runner.request({kind:'probe'},{device:'cpu',threads:0},signal);}catch(e){if(signal?.aborted)throw e;cpuProbe={};}
    const gate=await qualification(root,probe,cpuProbe);
    let legacyFingerprint='legacy';try{legacyFingerprint=await modelFingerprint(root);}catch{}
    const backends={};for(const device of ['cpu','cuda']){
      const actual=device==='cpu'?cpuProbe:probe,provider=device==='cpu'?'CPUExecutionProvider':'CUDAExecutionProvider',installed=(actual.providers||[]).includes(provider);
      backends[device]={installed,qualified:installed&&Boolean(gate[device]),fingerprint:`${gate.onnx||'missing'}:${actual.ortVersion||'missing'}:${device}:fp32`,reason:!installed?(device==='cuda'?'可选显卡组件未就绪，当前使用原生 CPU':actual.ortError||error||'请安装可选 CPU 加速组件'):!gate[device]?'尚未通过与当前模型的一致性验证':null};
    }
    backends.cuda.cpuFallbackQualified=Boolean(gate.cudaCPU||(probe.ortVersion===cpuProbe.ortVersion&&gate.cpu));
    if(backends.cuda.qualified&&!backends.cuda.cpuFallbackQualified){backends.cuda.qualified=false;backends.cuda.reason='显卡组件中的 CPU 回退后端尚未通过一致性验证';}
    const torchGate=await torchQualifications(root,probe);
    return statusCache={logicalCores:os.availableParallelism(),legacyFingerprint,backends,torchCUDA:Boolean(probe.torchCUDA),demucsCUDA:Boolean(probe.torchCUDA&&torchGate.demucs),crepeCUDA:Boolean(probe.torchCUDA&&torchGate.crepe),torchThreads:probe.torchThreads||null,gpuName:probe.gpuName||null,gpuMemory:probe.gpuMemory||null,torchVersion:probe.torchVersion||null,cudaReason:probe.cudaReason||probe.torchError||null};
  }
  const handler=async(req,res,url,send,token)=>{
    if(!url.pathname.startsWith('/api/compute/')&&url.pathname!=='/api/analysis/basic-pitch')return false;
    if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
    const controller=new AbortController(),close=()=>{if(!res.writableEnded)controller.abort();};res.on('close',close);
    try{
      if(url.pathname==='/api/compute/status'&&req.method==='GET'){
        if(!canStart()){send(200,statusCache||{busy:true,backends:{},reason:'正在进行分轨或演唱分析，稍后刷新设备状态'});return true;}
        if(statusPromise){send(200,await statusPromise);return true;}
        if(busy){send(200,statusCache||{logicalCores:os.availableParallelism(),busy:true,backends:{}});return true;}
        busy=true;statusPromise=status(controller.signal,url.searchParams.get('refresh')==='1');try{send(200,await statusPromise);}finally{statusPromise=null;busy=false;}return true;
      }
      if(url.pathname==='/api/analysis/basic-pitch'&&req.method==='POST'){
        if(!canStart()){send(409,{error:'请等待当前分轨或演唱分析完成'});return true;}
        if(busy){send(409,{error:'已有原生分析运行中'});return true;}
        busy=true;
        try{
          const config=requestCompute(url);if(config.mode!=='performance')throw Error('此接口仅用于高性能模式');
          const bytes=await body(req,22050*21*4);if(!bytes.length||bytes.length%4)throw Error('需要 Float32 单声道输入');
          const caps=await status(controller.signal),requested=config.device==='auto'?(caps.backends.cuda.qualified?'cuda':'cpu'):config.device;
          if(!caps.backends[requested]?.qualified)throw Error(caps.backends[requested]?.reason||'后端未通过验证');
          // CPU must also be qualified before permitting automatic CUDA fallback.
          if(requested==='cuda'&&!caps.backends.cuda.cpuFallbackQualified)throw Error('请先验证显卡组件中的 CPU 回退后端');
          const result=await runner.analyse(bytes,'basic',{...config,device:requested,actualDevice:requested},{},controller.signal);
          result.metadata.backend=`onnx-${result.metadata.device}`;
          const fingerprint=caps.backends[result.metadata.device].fingerprint.split(':');
          fingerprint[1]=result.metadata.runtimeVersion;
          result.metadata.fingerprint=fingerprint.join(':');
          res.setHeader('X-Analysis-Metadata',encodeURIComponent(JSON.stringify(result.metadata)));send(200,result.bytes,'application/octet-stream');
        }finally{busy=false;}return true;
      }
      send(404,{error:'计算接口不存在'});return true;
    }catch(e){if(!res.destroyed)send(e.name==='AbortError'?499:400,{error:e.message});return true;}
    finally{res.off('close',close);}
  };
  handler.runner=runner;handler.status=status;handler.close=()=>runner.stop();handler.busy=()=>busy;
  return handler;
}
