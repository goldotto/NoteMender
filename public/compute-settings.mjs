export const DEFAULT_COMPUTE=Object.freeze({mode:'standard',device:'auto',threads:0});
export function normalizeCompute(value={},limit=1024){
  const mode=value.mode==='performance'?'performance':'standard';
  const device=['auto','cpu','cuda'].includes(value.device)?value.device:'auto';
  const threads=Number(value.threads??0);
  if(!Number.isInteger(threads)||threads<0||threads>limit)throw Error(`CPU 线程数应为 0（自动）至 ${limit}`);
  return {mode,device,threads:mode==='standard'?0:threads};
}
export function resolveCompute(settings,status={}){
  const value=normalizeCompute(settings,status.logicalCores||1024);
  if(value.mode==='standard')return {...value,basicBackend:'tfjs-cpu',basicFingerprint:status.legacyFingerprint||'legacy',pitchBackend:'cpu',separationBackend:'cpu',reasons:[]};
  const wantsGPU=value.device!=='cpu',cuda=status.backends?.cuda,cpu=status.backends?.cpu;
  const basic=wantsGPU&&cuda?.qualified?'cuda':cpu?.qualified?'cpu':null;
  const reasons=[];
  if(wantsGPU&&!cuda?.qualified)reasons.push('Basic Pitch 显卡推理：'+(cuda?.reason||'尚未通过一致性验证'));
  if(!basic)reasons.push(cpu?.reason||'原生 CPU 推理未就绪，Basic Pitch 使用当前后端');
  return {...value,basicBackend:basic?`onnx-${basic}`:'tfjs-cpu',basicFingerprint:(basic?status.backends[basic]?.fingerprint:status.legacyFingerprint)||'legacy',pitchBackend:wantsGPU&&status.crepeCUDA?'cuda':'cpu',separationBackend:wantsGPU&&status.demucsCUDA?'cuda':'cpu',reasons};
}
export function computeQuery(execution={}){
  return new URLSearchParams({compute:execution.mode||'standard',device:execution.device||'auto',threads:String(execution.threads||0)}).toString();
}
